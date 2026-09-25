import type { Db, Queryable } from './db';
import { getDb, isUniqueViolation } from './db';
import { randomId } from './ids';
import { applySymbol, isValidSymbol } from './symbols';
import { tokenHash as hashToken } from './token';

export interface SessionRow {
  id: string;
  write_id: string;
  read_id: string;
  created_at: string;
  updated_at: string;
}

export interface OperationRow {
  sequence: number;
  symbol: string;
  created_at: string;
}

export interface CommitRow {
  id: string;
  text: string;
  created_at: string;
}

export interface SessionState {
  buffer: string;
  nextSequence: number;
  lastOperation: OperationRow | null;
  commits: CommitRow[];
}

export type RequestOutcome =
  | 'recorded'
  | 'duplicate'
  | 'conflict'
  | 'stale'
  | 'invalid_token'
  | 'expired'
  | 'view';

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function createSession(db: Db = getDb()): Promise<SessionRow> {
  const writeId = randomId();
  const readId = randomId();
  const { rows } = await db.query(
    `INSERT INTO sessions (write_id, read_id)
     VALUES ($1, $2)
     RETURNING id, write_id, read_id, created_at, updated_at`,
    [writeId, readId],
  );
  return rows[0] as SessionRow;
}

export async function getSessionByWid(
  wid: string,
  db: Db = getDb(),
): Promise<SessionRow | null> {
  const { rows } = await db.query(
    `SELECT id, write_id, read_id, created_at, updated_at
     FROM sessions WHERE write_id = $1`,
    [wid],
  );
  return (rows[0] as SessionRow) ?? null;
}

export async function getSessionByRid(
  rid: string,
  db: Db = getDb(),
): Promise<SessionRow | null> {
  const { rows } = await db.query(
    `SELECT id, write_id, read_id, created_at, updated_at
     FROM sessions WHERE read_id = $1`,
    [rid],
  );
  return (rows[0] as SessionRow) ?? null;
}

// ---------------------------------------------------------------------------
// State reconstruction (buffer is always replayed, never stored)
// ---------------------------------------------------------------------------

async function allOperations(
  q: Queryable,
  sessionId: string,
): Promise<OperationRow[]> {
  const { rows } = await q.query(
    `SELECT sequence, symbol, created_at
     FROM operations WHERE session_id = $1
     ORDER BY sequence ASC`,
    [sessionId],
  );
  return rows as OperationRow[];
}

/** Replay operations to derive the current working buffer + nextSequence. */
export function replay(ops: OperationRow[]): {
  buffer: string;
  nextSequence: number;
  lastOperation: OperationRow | null;
} {
  let buffer = '';
  let maxSeq = 0;
  let lastOperation: OperationRow | null = null;
  for (const op of ops) {
    if (op.sequence > maxSeq) {
      maxSeq = op.sequence;
      lastOperation = op;
    }
    if (op.symbol === 'COMMIT') {
      // COMMIT resets the working buffer.
      buffer = '';
    } else {
      buffer = applySymbol(buffer, op.symbol);
    }
  }
  return { buffer, nextSequence: maxSeq + 1, lastOperation };
}

/** Look up the commit text recorded at a specific sequence, if any. */
async function commitAtSequence(
  q: Queryable,
  sessionId: string,
  sequence: number,
): Promise<string | null> {
  const { rows } = await q.query(
    `SELECT text FROM commits WHERE session_id = $1 AND sequence = $2`,
    [sessionId, sequence],
  );
  return rows[0]?.text ?? null;
}

export async function getState(
  sessionId: string,
  db: Db = getDb(),
): Promise<SessionState> {
  const ops = await allOperations(db, sessionId);
  const { buffer, nextSequence, lastOperation } = replay(ops);
  const { rows: commitRows } = await db.query(
    `SELECT id, text, created_at
     FROM commits WHERE session_id = $1
     ORDER BY created_at DESC, sequence DESC`,
    [sessionId],
  );
  return {
    buffer,
    nextSequence,
    lastOperation,
    commits: commitRows as CommitRow[],
  };
}

// ---------------------------------------------------------------------------
// Execute (the only mutating operation)
// ---------------------------------------------------------------------------

export type ExecuteResult =
  | { kind: 'invalid_symbol' }
  | {
      kind: 'success';
      sequence: number;
      symbol: string;
      buffer: string;
      nextSequence: number;
      // Set only when symbol === 'COMMIT': the text that was actually saved to
      // the commits table, or null if the buffer was empty (no record created).
      committed?: string | null;
    }
  | {
      kind: 'duplicate';
      sequence: number;
      symbol: string;
      buffer: string;
      nextSequence: number;
      committed?: string | null;
    }
  | {
      kind: 'conflict';
      expectedSequence: number;
      receivedSequence: number;
      buffer: string;
    };

/**
 * Attempt to record `symbol` at `seq` for the session. Only seq == nextSequence
 * is accepted. Idempotency and race-safety come from unique(session_id, sequence).
 */
export async function execute(
  sessionId: string,
  seq: number,
  symbol: string,
  token: string,
  db: Db = getDb(),
): Promise<ExecuteResult> {
  if (!isValidSymbol(symbol)) return { kind: 'invalid_symbol' };

  const th = hashToken(token);

  try {
    return await db.transaction(async (tx) => {
      const ops = await allOperations(tx, sessionId);
      const existing = ops.find((o) => o.sequence === seq);

      if (existing) {
        // Sequence already used.
        const state = replay(ops);
        if (existing.symbol === symbol) {
          const committed =
            symbol === 'COMMIT'
              ? await commitAtSequence(tx, sessionId, seq)
              : undefined;
          return {
            kind: 'duplicate' as const,
            sequence: seq,
            symbol,
            buffer: state.buffer,
            nextSequence: state.nextSequence,
            committed,
          };
        }
        return {
          kind: 'conflict' as const,
          expectedSequence: state.nextSequence,
          receivedSequence: seq,
          buffer: state.buffer,
        };
      }

      const state = replay(ops);
      if (seq !== state.nextSequence) {
        return {
          kind: 'conflict' as const,
          expectedSequence: state.nextSequence,
          receivedSequence: seq,
          buffer: state.buffer,
        };
      }

      // Insert the operation. Unique constraint guards against races.
      await tx.query(
        `INSERT INTO operations (session_id, sequence, symbol, token_hash)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, seq, symbol, th],
      );

      // Compute the new buffer with this symbol applied.
      const newOps = [...ops, { sequence: seq, symbol, created_at: '' }];
      const after = replay(newOps);

      // Set only when symbol === 'COMMIT': the text saved (if any), so the ACK
      // page can say plainly whether a message was actually recorded.
      let committed: string | null | undefined;
      if (symbol === 'COMMIT') {
        // COMMIT: record the text committed (the buffer *before* this op),
        // unless the buffer was empty (then no commit record is created).
        const committedText = state.buffer;
        if (committedText.length > 0) {
          await tx.query(
            `INSERT INTO commits (session_id, sequence, text)
             VALUES ($1, $2, $3)`,
            [sessionId, seq, committedText],
          );
          committed = committedText;
        } else {
          committed = null;
        }
      }

      await tx.query(`UPDATE sessions SET updated_at = now() WHERE id = $1`, [
        sessionId,
      ]);

      return {
        kind: 'success' as const,
        sequence: seq,
        symbol,
        buffer: after.buffer,
        nextSequence: after.nextSequence,
        committed,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost a race: someone else recorded this sequence first. Re-read and
      // report duplicate (same symbol) or conflict (different symbol).
      const ops = await allOperations(db, sessionId);
      const existing = ops.find((o) => o.sequence === seq);
      const state = replay(ops);
      if (existing && existing.symbol === symbol) {
        const committed =
          symbol === 'COMMIT'
            ? await commitAtSequence(db, sessionId, seq)
            : undefined;
        return {
          kind: 'duplicate',
          sequence: seq,
          symbol,
          buffer: state.buffer,
          nextSequence: state.nextSequence,
          committed,
        };
      }
      return {
        kind: 'conflict',
        expectedSequence: state.nextSequence,
        receivedSequence: seq,
        buffer: state.buffer,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Request logging (best-effort; never throws into the request path)
// ---------------------------------------------------------------------------

export async function logRequest(
  params: {
    route: string;
    sessionId?: string | null;
    sequence?: number | null;
    symbol?: string | null;
    outcome: RequestOutcome;
    userAgent?: string | null;
  },
  db: Db = getDb(),
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO request_log (route, session_id, sequence, symbol, outcome, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.route,
        params.sessionId ?? null,
        params.sequence ?? null,
        params.symbol ?? null,
        params.outcome,
        params.userAgent ?? null,
      ],
    );
  } catch {
    // Diagnostics must never break the user-facing flow.
  }
}
