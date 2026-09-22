import React from 'react';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getSessionByWid, getState } from '@/lib/session';
import { displayTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// /debug/[wid]?key=ADMIN_KEY — dev diagnostics. 404 if ADMIN_KEY unset or wrong.
export default async function DebugPage({
  params,
  searchParams,
}: {
  params: { wid: string };
  searchParams: { key?: string };
}) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || searchParams.key !== adminKey) notFound();

  const session = await getSessionByWid(params.wid);
  if (!session) notFound();

  const db = getDb();
  const state = await getState(session.id);

  const { rows: ops } = await db.query(
    `SELECT sequence, symbol, token_hash, created_at
     FROM operations WHERE session_id = $1 ORDER BY sequence ASC`,
    [session.id],
  );
  const { rows: log } = await db.query(
    `SELECT route, sequence, symbol, outcome, user_agent, created_at
     FROM request_log WHERE session_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [session.id],
  );
  const { rows: commits } = await db.query(
    `SELECT sequence, text, created_at
     FROM commits WHERE session_id = $1 ORDER BY created_at DESC`,
    [session.id],
  );

  return (
    <div>
      <h1>DEBUG</h1>
      <pre className="status">
        {[
          `SESSION_ID: ${session.id}`,
          `READ_ID: ${session.read_id}`,
          `NEXT_SEQUENCE: ${state.nextSequence}`,
          `BUFFER: "${state.buffer.replace(/\n/g, '⏎')}"`,
          `OPERATIONS: ${ops.length}`,
          `COMMITS: ${commits.length}`,
          `LOG_ROWS: ${log.length}`,
        ].join('\n')}
      </pre>

      <h2>Operations</h2>
      <table className="debug">
        <thead>
          <tr>
            <th>seq</th>
            <th>symbol</th>
            <th>token_hash</th>
            <th>created_at</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((o: any) => (
            <tr key={o.sequence}>
              <td>{o.sequence}</td>
              <td>{o.symbol}</td>
              <td>{o.token_hash}</td>
              <td>{displayTime(o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Commits</h2>
      <table className="debug">
        <thead>
          <tr>
            <th>seq</th>
            <th>text</th>
            <th>created_at</th>
          </tr>
        </thead>
        <tbody>
          {commits.map((c: any, i: number) => (
            <tr key={i}>
              <td>{c.sequence}</td>
              <td>{c.text}</td>
              <td>{displayTime(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Request log (newest first)</h2>
      <table className="debug">
        <thead>
          <tr>
            <th>time</th>
            <th>route</th>
            <th>seq</th>
            <th>symbol</th>
            <th>outcome</th>
            <th>user agent</th>
          </tr>
        </thead>
        <tbody>
          {log.map((r: any, i: number) => (
            <tr key={i}>
              <td>{displayTime(r.created_at)}</td>
              <td>{r.route}</td>
              <td>{r.sequence ?? ''}</td>
              <td>{r.symbol ?? ''}</td>
              <td>{r.outcome}</td>
              <td>{r.user_agent ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
