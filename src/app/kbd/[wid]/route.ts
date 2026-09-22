import { NextRequest, NextResponse } from 'next/server';
import { getSessionByWid, getState } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /kbd/[wid] -> 302 redirect to /kbd/[wid]/[currentSeq]
export async function GET(
  req: NextRequest,
  { params }: { params: { wid: string } },
) {
  const session = await getSessionByWid(params.wid);
  if (!session) {
    return new NextResponse('Unknown write id', {
      status: 404,
      headers: { 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  const state = await getState(session.id);
  const url = new URL(
    `/kbd/${params.wid}/${state.nextSequence}`,
    req.nextUrl.origin,
  );
  return NextResponse.redirect(url, 302);
}
