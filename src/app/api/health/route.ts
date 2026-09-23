import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

// Diagnostic endpoint. Gated behind ADMIN_KEY: /api/health?key=ADMIN_KEY.
// Returns 404 when the key is missing or wrong (does not reveal it exists).
// Reports ONLY whether each env var is present (never its value) and whether a
// trivial DB query succeeds.
export async function GET(req: NextRequest) {
  const adminKey = process.env.ADMIN_KEY;
  const provided = req.nextUrl.searchParams.get('key');
  if (!adminKey || provided !== adminKey) {
    return new NextResponse('Not found', { status: 404, headers: NO_STORE });
  }

  const env = {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    SERVER_SECRET: Boolean(process.env.SERVER_SECRET),
    ADMIN_KEY: Boolean(process.env.ADMIN_KEY),
  };

  let db: { ok: boolean; error?: string } = { ok: false };
  try {
    const { getDb } = await import('@/lib/db');
    const result = await getDb().query('SELECT 1 AS ok');
    db = { ok: result.rows?.[0]?.ok === 1 };
  } catch (err) {
    db = {
      ok: false,
      error: `${(err as { code?: string })?.code ?? ''} ${
        (err as Error)?.message ?? String(err)
      }`.trim(),
    };
  }

  return NextResponse.json({ env, db }, { status: 200, headers: NO_STORE });
}
