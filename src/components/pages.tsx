import React from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import {
  execute,
  getSessionByWid,
  getState,
  logRequest,
} from '@/lib/session';
import {
  StatusBlock,
  PreviewKeyboard,
  ExecuteKeyboard,
  ReadLinks,
} from '@/components/ui';
import { displayBuffer } from '@/lib/format';
import { isValidSymbol, keyLabel } from '@/lib/symbols';
import { makeToken, verifyToken } from '@/lib/token';
import { previewPath, executePath, keyboardPath } from '@/lib/paths';

// ---------------------------------------------------------------------------
// Preview view (STRICTLY NON-MUTATING). Shared by /key and /k.
// ---------------------------------------------------------------------------

export async function PreviewView({
  params,
}: {
  params: { wid: string; seq: string; symbol: string };
}) {
  const session = await getSessionByWid(params.wid);
  if (!session) notFound();

  const seq = Number(params.seq);
  const { symbol } = params;
  const state = await getState(session.id);

  if (!isValidSymbol(symbol)) {
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
        <p className="warn">Unknown symbol. Return to the keyboard.</p>
        <p>
          <a rel="nofollow" href={keyboardPath(params.wid, state.nextSequence)}>
            Current keyboard (sequence {state.nextSequence})
          </a>
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  if (!Number.isInteger(seq) || seq !== state.nextSequence) {
    return (
      <div>
        <StatusBlock
          lines={[
            ['STATUS', 'STALE'],
            ['REQUESTED_SEQUENCE', String(params.seq)],
            ['CURRENT_SEQUENCE', String(state.nextSequence)],
            ['BUFFER', displayBuffer(state.buffer)],
          ]}
        />
        <p>
          This preview is stale. Go to the{' '}
          <a rel="nofollow" href={keyboardPath(params.wid, state.nextSequence)}>
            current keyboard (sequence {state.nextSequence})
          </a>
          .
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  const token = makeToken(params.wid, seq, symbol);
  const executeHref = executePath(params.wid, seq, symbol, token);

  return (
    <div>
      <StatusBlock
        lines={[
          ['STATUS', 'PREVIEW'],
          ['PROPOSED_SYMBOL', keyLabel(symbol)],
          ['SEQUENCE', String(seq)],
          ['CURRENT_BUFFER', displayBuffer(state.buffer)],
        ]}
      />
      <p className="note">
        Follow the single EXECUTE link below to record this keystroke. This is
        the only action that changes state.
      </p>
      <p>
        <a rel="nofollow" className="execute-link" href={executeHref}>
          EXECUTE: record {keyLabel(symbol)} at sequence {seq}
        </a>
      </p>
      <p>
        <a rel="nofollow" href={keyboardPath(params.wid, state.nextSequence)}>
          Back to keyboard (sequence {state.nextSequence})
        </a>
      </p>
      <ReadLinks rid={session.read_id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execute view (the only mutating route). Shared by /execute and /x.
// ---------------------------------------------------------------------------

export async function ExecuteView({
  params,
}: {
  params: { wid: string; seq: string; symbol: string; token: string };
}) {
  const session = await getSessionByWid(params.wid);
  if (!session) notFound();

  const seq = Number(params.seq);
  const { symbol, token, wid } = params;
  const ua = headers().get('user-agent');

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
          <a rel="nofollow" href={keyboardPath(wid, state.nextSequence)}>
            Current keyboard (sequence {state.nextSequence})
          </a>
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

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
            [
              'REASON',
              check.reason === 'expired' ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN',
            ],
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
            <a rel="nofollow" href={previewPath(wid, seq, symbol)}>
              Get a fresh preview for {keyLabel(symbol)} at sequence {seq}
            </a>
          </p>
        )}
        <p>
          <a rel="nofollow" href={keyboardPath(wid, state.nextSequence)}>
            Current keyboard (sequence {state.nextSequence})
          </a>
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  const result = await execute(session.id, seq, symbol, token);

  if (result.kind === 'invalid_symbol') {
    const state = await getState(session.id);
    return (
      <div>
        <StatusBlock lines={[['STATUS', 'ERROR'], ['REASON', 'UNKNOWN_SYMBOL']]} />
        <p>
          <a rel="nofollow" href={keyboardPath(wid, state.nextSequence)}>
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
        <StatusBlock
          lines={[['NEXT_SEQUENCE', String(result.expectedSequence)]]}
        />
        {/* Recovery uses the strict preview keyboard (SAFE MODE fallback). */}
        <PreviewKeyboard wid={wid} seq={result.expectedSequence} />
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  const isDuplicate = result.kind === 'duplicate';
  await logRequest({
    route: '/execute',
    sessionId: session.id,
    sequence: seq,
    symbol,
    outcome: isDuplicate ? 'duplicate' : 'recorded',
    userAgent: ua,
  });

  const ackLines: [string, string][] = [['RECORDED', 'TRUE']];
  if (isDuplicate) ackLines.push(['DUPLICATE', 'TRUE']);
  ackLines.push(
    ['SESSION_READ_ID', session.read_id],
    ['SEQUENCE', String(result.sequence)],
    ['SYMBOL', keyLabel(result.symbol)],
    ['BUFFER', displayBuffer(result.buffer)],
    ['NEXT_SEQUENCE', String(result.nextSequence)],
  );

  // COMMIT always resets BUFFER to "", which looks identical whether or not a
  // message was actually saved. Make the outcome explicit so an empty-buffer
  // COMMIT (a documented no-op that still consumes its sequence) is never
  // mistaken for a message vanishing.
  const isCommit = result.symbol === 'COMMIT';
  if (isCommit) {
    ackLines.push([
      'COMMITTED',
      result.committed ? displayBuffer(result.committed) : 'NONE (buffer was empty)',
    ]);
  }

  return (
    <div>
      <StatusBlock lines={ackLines} />
      {isDuplicate && (
        <p className="note">
          This keystroke was already recorded. State is unchanged.
        </p>
      )}
      {isCommit && !result.committed && (
        <p className="warn">
          Nothing was saved: the buffer was already empty when COMMIT was
          followed, so this COMMIT created no committed message. Type
          characters before COMMIT to save a message.
        </p>
      )}
      {isCommit && result.committed && (
        <p className="note">
          Saved to the OUTPUT page&rsquo;s committed messages. See the OUTPUT
          link below.
        </p>
      )}
      {/* ACK keyboard: direct execute links with inline tokens (one fetch). */}
      <ExecuteKeyboard wid={wid} seq={result.nextSequence} />
      <ReadLinks rid={session.read_id} />
    </div>
  );
}
