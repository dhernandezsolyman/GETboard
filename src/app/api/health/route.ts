import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Diagnostic endpoint. Reports ONLY whether each env var is present (never its
// value) and whether a trivial DB query succeeds. Safe to expose; leaks nothing.
export async function GET() {
  const env = {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    SERVER_SECRET: Boolean(process.env.SERVER_SECRET),
    ADMIN_KEY: Boolean(process.env.ADMIN_KEY),
  };

  let db: { ok: boolean; error?: string } = { ok: false };
  try {
    // Import lazily so a missing DATABASE_URL surfaces as a clean message here
    // rather than crashing the whole route.
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

  return NextResponse.json(
    { env, db },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}
