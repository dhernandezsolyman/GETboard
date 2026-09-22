import React from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { execute, getSessionByWid, getState, logRequest } from '@/lib/session';
import { StatusBlock, Keyboard, ReadLinks } from '@/components/ui';
import { displayBuffer } from '@/lib/format';
import { isValidSymbol, keyLabel } from '@/lib/symbols';
import { verifyToken } from '@/lib/token';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ExecutePage({
  params,
}: {
  params: { wid: string; seq: string; symbol: string; token: string };
}) {
  const session = await getSessionByWid(params.wid);
  if (!session) notFound();

  const seq = Number(params.seq);
  const { symbol, token, wid } = params;
  const ua = headers().get('user-agent');

  // Unknown symbol -> error page linking back to the current keyboard.
  if (!isValidSymbol(symbol)) {
    const state = await getState(session.id);
    return (
      <div>
        <StatusBlock
          lines={[
            ['STATUS', 'ERROR'],
            ['REASON', 'UNKNOWN_SYMBOL'],
            ['RECEIVED_SYMBOL', symbol],
            ['CURRENT_SEQUENCE', String(state.nextSequence)],
          ]}
        />
        <p>
          <a rel="nofollow" href={`/kbd/${wid}/${state.nextSequence}`}>
            Current keyboard (sequence {state.nextSequence})
          </a>
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  // Validate the stateless token.
  const check = verifyToken(token, wid, seq, symbol);
  if (!check.ok) {
    const state = await getState(session.id);
    const outcome = check.reason === 'expired' ? 'expired' : 'invalid_token';
    await logRequest({
      route: '/execute',
      sessionId: session.id,
      sequence: Number.isFinite(seq) ? seq : null,
      symbol,
      outcome,
      userAgent: ua,
    });
    const seqIsCurrent = Number.isInteger(seq) && seq === state.nextSequence;
    return (
      <div>
        <StatusBlock
          lines={[
            ['STATUS', 'REJECTED'],
            ['REASON', check.reason === 'expired' ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN'],
            ['SEQUENCE', String(params.seq)],
            ['CURRENT_SEQUENCE', String(state.nextSequence)],
            ['BUFFER', displayBuffer(state.buffer)],
          ]}
        />
        <p className="warn">
          The execute token was {check.reason}. Nothing was recorded.
        </p>
        {seqIsCurrent && (
          <p>
            <a rel="nofollow" href={`/key/${wid}/${seq}/${symbol}`}>
              Get a fresh preview for {keyLabel(symbol)} at sequence {seq}
            </a>
          </p>
        )}
        <p>
          <a rel="nofollow" href={`/kbd/${wid}/${state.nextSequence}`}>
            Current keyboard (sequence {state.nextSequence})
          </a>
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  // Perform the (idempotent, race-safe) write.
  const result = await execute(session.id, seq, symbol, token);

  if (result.kind === 'invalid_symbol') {
    // Should not happen (checked above), but stay safe.
    const state = await getState(session.id);
    return (
      <div>
        <StatusBlock lines={[['STATUS', 'ERROR'], ['REASON', 'UNKNOWN_SYMBOL']]} />
        <p>
          <a rel="nofollow" href={`/kbd/${wid}/${state.nextSequence}`}>
            Current keyboard
          </a>
        </p>
      </div>
    );
  }

  if (result.kind === 'conflict') {
    await logRequest({
      route: '/execute',
      sessionId: session.id,
      sequence: seq,
      symbol,
      outcome: 'conflict',
      userAgent: ua,
    });
    return (
      <div>
        <StatusBlock
          lines={[
            ['STATUS', 'CONFLICT'],
            ['EXPECTED_SEQUENCE', String(result.expectedSequence)],
            ['RECEIVED_SEQUENCE', String(result.receivedSequence)],
            ['BUFFER', displayBuffer(result.buffer)],
            ['SESSION_READ_ID', session.read_id],
          ]}
        />
        <p className="warn">
          This sequence is no longer current. Nothing was changed. Use the
          keyboard below for the current sequence.
        </p>
        <StatusBlock lines={[['NEXT_SEQUENCE', String(result.expectedSequence)]]} />
        <Keyboard wid={wid} seq={result.expectedSequence} />
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  // SUCCESS or DUPLICATE -> ACK page, which IS the next keyboard.
  const isDuplicate = result.kind === 'duplicate';
  await logRequest({
    route: '/execute',
    sessionId: session.id,
    sequence: seq,
    symbol,
    outcome: isDuplicate ? 'duplicate' : 'recorded',
    userAgent: ua,
  });

  const ackLines: [string, string][] = [
    ['RECORDED', 'TRUE'],
  ];
  if (isDuplicate) ackLines.push(['DUPLICATE', 'TRUE']);
  ackLines.push(
    ['SESSION_READ_ID', session.read_id],
    ['SEQUENCE', String(result.sequence)],
    ['SYMBOL', keyLabel(result.symbol)],
    ['BUFFER', displayBuffer(result.buffer)],
    ['NEXT_SEQUENCE', String(result.nextSequence)],
  );

  return (
    <div>
      <StatusBlock lines={ackLines} />
      {isDuplicate && (
        <p className="note">
          This keystroke was already recorded. State is unchanged.
        </p>
      )}
      <Keyboard wid={wid} seq={result.nextSequence} />
      <ReadLinks rid={session.read_id} />
    </div>
  );
}
