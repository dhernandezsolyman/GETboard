import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from '@/lib/db';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * A PGlite-backed Db for tests. PGlite is a single connection, so we serialize
 * all access behind a simple mutex — this both avoids "command already in
 * progress" errors and faithfully models a single database connection when we
 * exercise concurrent executes.
 */
export async function makePgliteDb(): Promise<Db & { close(): Promise<void> }> {
  const pg = new PGlite();

  // Load schema (drop the pgcrypto extension line; gen_random_uuid is built in
  // to the Postgres core PGlite ships).
  const schema = readFileSync(
    join(__dirname, '..', '..', 'db', 'schema.sql'),
    'utf8',
  )
    .split('\n')
    .filter((line) => !/CREATE EXTENSION/i.test(line))
    .join('\n');
  await pg.exec(schema);

  let chain: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    // Keep the chain going but swallow errors so one failure doesn't poison it.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const rawQuery = (text: string, params?: unknown[]) =>
    pg.query(text, params as unknown[]).then((r) => ({ rows: r.rows as any[] }));

  const db: Db & { close(): Promise<void> } = {
    query: (text, params) => serialize(() => rawQuery(text, params)),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return serialize(async () => {
        await rawQuery('BEGIN');
        try {
          // Inside the mutex-held section, use raw (already serialized) queries.
          const tx: Queryable = { query: (t, p) => rawQuery(t, p) };
          const result = await fn(tx);
          await rawQuery('COMMIT');
          return result;
        } catch (err) {
          try {
            await rawQuery('ROLLBACK');
          } catch {
            /* ignore */
          }
          throw err;
        }
      });
    },
    async close() {
      await pg.close();
    },
  };

  return db;
}
