import type { Pool as PgPool, PoolClient } from 'pg';

// Minimal database abstraction so the same business logic runs against
// node-postgres (Neon in production) and PGlite (in tests).

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

// Allow tests to inject a Db (e.g. a PGlite adapter) via globalThis.
const GLOBAL_KEY = '__GETBOARD_DB__';

let pgPool: PgPool | null = null;

function makePgDb(pool: PgPool): Db {
  return {
    query: (text, params) => pool.query(text, params as any[]),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params) => client.query(text, params as any[]),
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore rollback errors */
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export function getDb(): Db {
  const injected = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
    | Db
    | undefined;
  if (injected) return injected;

  if (!pgPool) {
    // Lazy require so tests that inject a Db never need `pg` installed/loaded.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg') as typeof import('pg');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pgPool = new Pool({ connectionString });
  }
  return makePgDb(pgPool);
}

/** Test helper: inject a Db implementation. */
export function setDb(db: Db | undefined): void {
  if (db) (globalThis as Record<string, unknown>)[GLOBAL_KEY] = db;
  else delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}

/** Unique-violation detection across pg and PGlite. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === '23505') return true;
  const msg = String((err as { message?: string })?.message ?? '');
  return /unique/i.test(msg) && /constraint|violat/i.test(msg);
}
