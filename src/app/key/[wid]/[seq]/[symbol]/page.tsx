import React from 'react';
import { notFound } from 'next/navigation';
import { getSessionByWid, getState } from '@/lib/session';
import { StatusBlock, ReadLinks } from '@/components/ui';
import { displayBuffer } from '@/lib/format';
import { isValidSymbol, keyLabel } from '@/lib/symbols';
import { makeToken } from '@/lib/token';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// STRICTLY NON-MUTATING: this page performs NO database writes of any kind.
export default async function PreviewPage({
  params,
}: {
  params: { wid: string; seq: string; symbol: string };
}) {
  const session = await getSessionByWid(params.wid);
  if (!session) notFound();

  const seq = Number(params.seq);
  const { symbol } = params;
  const state = await getState(session.id);

  // Unknown symbol -> error page linking back to the current keyboard.
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
          <a rel="nofollow" href={`/kbd/${params.wid}/${state.nextSequence}`}>
            Current keyboard (sequence {state.nextSequence})
          </a>
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  // Stale sequence -> STALE + link to the current keyboard.
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
          <a rel="nofollow" href={`/kbd/${params.wid}/${state.nextSequence}`}>
            current keyboard (sequence {state.nextSequence})
          </a>
          .
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  // Mint a stateless token (no storage).
  const token = makeToken(params.wid, seq, symbol);
  const executeHref = `/execute/${params.wid}/${seq}/${symbol}/${token}`;

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
        <a rel="nofollow" href={`/kbd/${params.wid}/${state.nextSequence}`}>
          Back to keyboard (sequence {state.nextSequence})
        </a>
      </p>
      <ReadLinks rid={session.read_id} />
    </div>
  );
}
