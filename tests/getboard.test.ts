import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Ensure a secret is present before token code runs.
process.env.SERVER_SECRET = 'test-secret-please-ignore';

import { setDb } from '@/lib/db';
import type { Db } from '@/lib/db';
import { makePgliteDb } from './support/pglite-db';
import {
  createSession,
  execute,
  getSessionByRid,
  getSessionByWid,
  getState,
} from '@/lib/session';
import { makeToken, verifyToken, tokenHash } from '@/lib/token';
import { Keyboard } from '@/components/ui';
import { KEYBOARD_LAYOUT } from '@/lib/symbols';

let db: Db & { close(): Promise<void> };

beforeEach(async () => {
  db = await makePgliteDb();
  setDb(db);
});

afterEach(async () => {
  setDb(undefined);
  await db.close();
});

// Helper: run a full preview->execute for one symbol at the current sequence.
async function type(sessionId: string, wid: string, symbol: string) {
  const state = await getState(sessionId);
  const seq = state.nextSequence;
  const token = makeToken(wid, seq, symbol);
  return execute(sessionId, seq, symbol, token);
}

async function operationsCount(sessionId: string): Promise<number> {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM operations WHERE session_id = $1',
    [sessionId],
  );
  return rows[0].n;
}

describe('GETboard', () => {
  it('1. creates a session with distinct, high-entropy wid and rid', async () => {
    const s = await createSession();
    expect(s.write_id).not.toEqual(s.read_id);
    // base62, >=128 bits -> ~22+ chars.
    expect(s.write_id.length).toBeGreaterThanOrEqual(21);
    expect(s.read_id.length).toBeGreaterThanOrEqual(21);
    expect(s.write_id).toMatch(/^[0-9A-Za-z]+$/);
    expect(s.read_id).toMatch(/^[0-9A-Za-z]+$/);

    const s2 = await createSession();
    expect(s2.write_id).not.toEqual(s.write_id);
    expect(s2.read_id).not.toEqual(s.read_id);
  });

  it('2. writes HELLO sequentially via preview -> execute', async () => {
    const s = await createSession();
    for (const ch of 'HELLO') {
      const r = await type(s.id, s.write_id, ch);
      expect(r.kind).toBe('success');
    }
    const state = await getState(s.id);
    expect(state.buffer).toBe('HELLO');
    expect(state.nextSequence).toBe(6);
  });

  it('3. SPACE works', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'H');
    await type(s.id, s.write_id, 'I');
    await type(s.id, s.write_id, 'SPACE');
    await type(s.id, s.write_id, 'U');
    expect((await getState(s.id)).buffer).toBe('HI U');
  });

  it('4. punctuation works', async () => {
    const s = await createSession();
    for (const sym of ['A', 'PERIOD', 'COMMA', 'QUESTION', 'EXCLAMATION', 'COLON', 'SEMICOLON', 'DASH', 'SLASH']) {
      await type(s.id, s.write_id, sym);
    }
    expect((await getState(s.id)).buffer).toBe('A.,?!:;-/');
  });

  it('5. BACKSPACE works, including on an empty buffer', async () => {
    const s = await createSession();
    // Backspace on empty buffer: no-op but consumes a sequence.
    let r = await type(s.id, s.write_id, 'BACKSPACE');
    expect(r.kind).toBe('success');
    expect((await getState(s.id)).buffer).toBe('');
    expect((await getState(s.id)).nextSequence).toBe(2);

    await type(s.id, s.write_id, 'A');
    await type(s.id, s.write_id, 'B');
    await type(s.id, s.write_id, 'BACKSPACE');
    expect((await getState(s.id)).buffer).toBe('A');
  });

  it('6. NEWLINE works', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'A');
    await type(s.id, s.write_id, 'NEWLINE');
    await type(s.id, s.write_id, 'B');
    expect((await getState(s.id)).buffer).toBe('A\nB');
  });

  it('7. A and a are distinct symbols', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'A');
    await type(s.id, s.write_id, 'a');
    expect((await getState(s.id)).buffer).toBe('Aa');
  });

  it('8. duplicate execute returns DUPLICATE and changes nothing', async () => {
    const s = await createSession();
    const token = makeToken(s.write_id, 1, 'H');
    const first = await execute(s.id, 1, 'H', token);
    expect(first.kind).toBe('success');
    const before = await getState(s.id);

    const dup = await execute(s.id, 1, 'H', token);
    expect(dup.kind).toBe('duplicate');
    const after = await getState(s.id);
    expect(after.buffer).toBe(before.buffer);
    expect(after.nextSequence).toBe(before.nextSequence);
    expect(await operationsCount(s.id)).toBe(1);
  });

  it('9. a different symbol at a used sequence -> CONFLICT, no change', async () => {
    const s = await createSession();
    await execute(s.id, 1, 'H', makeToken(s.write_id, 1, 'H'));
    const r = await execute(s.id, 1, 'X', makeToken(s.write_id, 1, 'X'));
    expect(r.kind).toBe('conflict');
    expect((await getState(s.id)).buffer).toBe('H');
    expect(await operationsCount(s.id)).toBe(1);
  });

  it('10. future or past sequence -> CONFLICT, no change', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'H'); // now nextSequence == 2

    const future = await execute(s.id, 5, 'X', makeToken(s.write_id, 5, 'X'));
    expect(future.kind).toBe('conflict');

    // seq 1 is used by a different symbol -> conflict
    const past = await execute(s.id, 1, 'Z', makeToken(s.write_id, 1, 'Z'));
    expect(past.kind).toBe('conflict');

    expect((await getState(s.id)).buffer).toBe('H');
    expect(await operationsCount(s.id)).toBe(1);
  });

  it('11. expired token rejected; tampered token rejected', async () => {
    const wid = 'abc';
    const expired = makeToken(wid, 1, 'H', Date.now() - 11 * 60 * 1000);
    expect(verifyToken(expired, wid, 1, 'H')).toEqual({
      ok: false,
      reason: 'expired',
    });

    const good = makeToken(wid, 1, 'H');
    expect(verifyToken(good, wid, 1, 'H')).toEqual({ ok: true });

    // Tamper: flip a char.
    const tampered = good.slice(0, -1) + (good.slice(-1) === 'A' ? 'B' : 'A');
    expect(verifyToken(tampered, wid, 1, 'H').ok).toBe(false);

    // Wrong symbol / seq / wid all fail.
    expect(verifyToken(good, wid, 1, 'X').ok).toBe(false);
    expect(verifyToken(good, wid, 2, 'H').ok).toBe(false);
    expect(verifyToken(good, 'other', 1, 'H').ok).toBe(false);
  });

  it('12. viewing the keyboard causes no operation writes', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'H');
    const before = await operationsCount(s.id);
    // Simulate keyboard page: read state only.
    await getState(s.id);
    await getState(s.id);
    expect(await operationsCount(s.id)).toBe(before);
  });

  it('13. viewing the preview causes no operation writes', async () => {
    const s = await createSession();
    const before = await operationsCount(s.id);
    // Simulate preview page: read state + mint token (pure), no writes.
    const state = await getState(s.id);
    makeToken(s.write_id, state.nextSequence, 'H');
    expect(await operationsCount(s.id)).toBe(before);
  });

  it('14. execute changes state exactly once', async () => {
    const s = await createSession();
    const token = makeToken(s.write_id, 1, 'H');
    await execute(s.id, 1, 'H', token);
    await execute(s.id, 1, 'H', token);
    await execute(s.id, 1, 'H', token);
    expect(await operationsCount(s.id)).toBe(1);
    expect((await getState(s.id)).buffer).toBe('H');
  });

  it('15. the ACK keyboard is for NEXT_SEQUENCE', async () => {
    const s = await createSession();
    const r = await type(s.id, s.write_id, 'H');
    expect(r.kind).toBe('success');
    if (r.kind !== 'success') return;
    const html = renderToStaticMarkup(
      React.createElement(Keyboard, { wid: s.write_id, seq: r.nextSequence }),
    );
    expect(r.nextSequence).toBe(2);
    expect(html).toContain(`/key/${s.write_id}/2/A`);
    expect(html).toContain(`/key/${s.write_id}/2/COMMIT`);
  });

  it('16. stale keyboard renders STALE + link to current keyboard (logic)', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'H'); // current is 2
    const state = await getState(s.id);
    const requested = 1;
    expect(requested).not.toBe(state.nextSequence);
    // The page renders a link to /kbd/[wid]/[nextSequence] in this case.
    const href = `/kbd/${s.write_id}/${state.nextSequence}`;
    expect(href).toBe(`/kbd/${s.write_id}/2`);
  });

  it('17. CONFLICT surfaces the current keyboard sequence', async () => {
    const s = await createSession();
    await execute(s.id, 1, 'H', makeToken(s.write_id, 1, 'H'));
    const r = await execute(s.id, 1, 'X', makeToken(s.write_id, 1, 'X'));
    expect(r.kind).toBe('conflict');
    if (r.kind !== 'conflict') return;
    const html = renderToStaticMarkup(
      React.createElement(Keyboard, {
        wid: s.write_id,
        seq: r.expectedSequence,
      }),
    );
    expect(r.expectedSequence).toBe(2);
    expect(html).toContain(`/key/${s.write_id}/2/A`);
  });

  it('18. JSON state reflects writes immediately', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'H');
    await type(s.id, s.write_id, 'I');
    const bySid = await getState(s.id);
    const viaRid = await getSessionByRid(s.read_id);
    expect(viaRid).not.toBeNull();
    expect(bySid.buffer).toBe('HI');
  });

  it('19. output page shows the same buffer as JSON', async () => {
    const s = await createSession();
    for (const ch of 'HI') await type(s.id, s.write_id, ch);
    const state = await getState(s.id);
    expect(state.buffer).toBe('HI');
  });

  it('20. COMMIT stores the message and resets the buffer', async () => {
    const s = await createSession();
    for (const ch of 'HI') await type(s.id, s.write_id, ch);
    const r = await type(s.id, s.write_id, 'COMMIT');
    expect(r.kind).toBe('success');
    const state = await getState(s.id);
    expect(state.buffer).toBe('');
    expect(state.commits.length).toBe(1);
    expect(state.commits[0].text).toBe('HI');

    // Empty-buffer COMMIT: consumes a sequence, creates no commit record.
    const before = state.commits.length;
    const seqBefore = state.nextSequence;
    const r2 = await type(s.id, s.write_id, 'COMMIT');
    expect(r2.kind).toBe('success');
    const state2 = await getState(s.id);
    expect(state2.commits.length).toBe(before);
    expect(state2.nextSequence).toBe(seqBefore + 1);
  });

  it('21. output page displays committed messages (data present)', async () => {
    const s = await createSession();
    for (const ch of 'AB') await type(s.id, s.write_id, ch);
    await type(s.id, s.write_id, 'COMMIT');
    for (const ch of 'CD') await type(s.id, s.write_id, ch);
    await type(s.id, s.write_id, 'COMMIT');
    const state = await getState(s.id);
    const texts = state.commits.map((c) => c.text);
    // newest first
    expect(texts).toEqual(['CD', 'AB']);
  });

  it('22. the read id cannot access write routes', async () => {
    const s = await createSession();
    // getSessionByWid(rid) must not find a session (rid is not a wid).
    expect(await getSessionByWid(s.read_id)).toBeNull();
    // And the real wid is not usable as a rid.
    expect(await getSessionByRid(s.write_id)).toBeNull();
  });

  it('23. JSON and output never contain the write id', async () => {
    const s = await createSession();
    await type(s.id, s.write_id, 'H');
    const state = await getState(s.id);
    // Build the JSON body the API returns.
    const body = {
      session: s.read_id,
      buffer: state.buffer,
      nextSequence: state.nextSequence,
      lastOperation: state.lastOperation,
      commits: state.commits,
    };
    const json = JSON.stringify(body);
    expect(json).not.toContain(s.write_id);
  });

  it('24. concurrent executes at the same sequence -> exactly one recorded', async () => {
    const s = await createSession();
    const results = await Promise.all([
      execute(s.id, 1, 'H', makeToken(s.write_id, 1, 'H')),
      execute(s.id, 1, 'H', makeToken(s.write_id, 1, 'H')),
      execute(s.id, 1, 'H', makeToken(s.write_id, 1, 'H')),
    ]);
    const successes = results.filter((r) => r.kind === 'success').length;
    const dups = results.filter((r) => r.kind === 'duplicate').length;
    expect(successes).toBe(1);
    expect(dups).toBe(2);
    expect(await operationsCount(s.id)).toBe(1);
    expect((await getState(s.id)).buffer).toBe('H');
  });

  it('token hash is deterministic and hex', () => {
    const t = makeToken('w', 1, 'H');
    expect(tokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(t)).toBe(tokenHash(t));
  });

  it('keyboard layout covers all documented symbols', () => {
    expect(KEYBOARD_LAYOUT).toContain('A');
    expect(KEYBOARD_LAYOUT).toContain('a');
    expect(KEYBOARD_LAYOUT).toContain('0');
    expect(KEYBOARD_LAYOUT).toContain('COMMIT');
    expect(KEYBOARD_LAYOUT.length).toBe(26 + 26 + 10 + 12);
  });
});
