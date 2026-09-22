import { NextRequest, NextResponse } from 'next/server';
import { getSessionByRid, getState, logRequest } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

// GET /api/session/[rid] -> read-only JSON. Any query string is ignored.
export async function GET(
  req: NextRequest,
  { params }: { params: { rid: string } },
) {
  const session = await getSessionByRid(params.rid);
  if (!session) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  const state = await getState(session.id);

  await logRequest({
    route: '/api/session/[rid]',
    sessionId: session.id,
    outcome: 'view',
    userAgent: req.headers.get('user-agent'),
  });

  // Never expose the write id.
  const body = {
    session: session.read_id,
    buffer: state.buffer,
    nextSequence: state.nextSequence,
    lastOperation: state.lastOperation
      ? {
          sequence: state.lastOperation.sequence,
          symbol: state.lastOperation.symbol,
          createdAt: state.lastOperation.created_at,
        }
      : null,
    commits: state.commits.map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.created_at,
    })),
  };

  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}
