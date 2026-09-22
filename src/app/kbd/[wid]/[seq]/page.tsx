import React from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getSessionByWid, getState, logRequest } from '@/lib/session';
import { StatusBlock, Keyboard, ReadLinks } from '@/components/ui';
import { displayBuffer } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function KeyboardPage({
  params,
}: {
  params: { wid: string; seq: string };
}) {
  const session = await getSessionByWid(params.wid);
  if (!session) notFound();

  const seq = Number(params.seq);
  const state = await getState(session.id);
  const ua = headers().get('user-agent');

  // STALE: the requested sequence is not the current one.
  if (!Number.isInteger(seq) || seq !== state.nextSequence) {
    await logRequest({
      route: '/kbd/[wid]/[seq]',
      sessionId: session.id,
      sequence: Number.isFinite(seq) ? seq : null,
      outcome: 'stale',
      userAgent: ua,
    });
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
          This keyboard is stale. Go to the{' '}
          <a rel="nofollow" href={`/kbd/${params.wid}/${state.nextSequence}`}>
            current keyboard (sequence {state.nextSequence})
          </a>
          .
        </p>
        <ReadLinks rid={session.read_id} />
      </div>
    );
  }

  await logRequest({
    route: '/kbd/[wid]/[seq]',
    sessionId: session.id,
    sequence: seq,
    outcome: 'view',
    userAgent: ua,
  });

  return (
    <div>
      <StatusBlock
        lines={[
          ['STATUS', 'READY'],
          ['SEQUENCE', String(seq)],
          ['NEXT_SEQUENCE', String(state.nextSequence)],
          ['BUFFER', displayBuffer(state.buffer)],
          ['LAST_SYMBOL', state.lastOperation?.symbol ?? '(none)'],
          ['SESSION_READ_ID', session.read_id],
        ]}
      />
      <Keyboard wid={params.wid} seq={seq} />
      <ReadLinks rid={session.read_id} />
    </div>
  );
}
