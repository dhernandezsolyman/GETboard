import React from 'react';
import { notFound } from 'next/navigation';
import { getSessionByRid, getState, logRequest } from '@/lib/session';
import { displayTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The public product: a clean page a human watches. Server-rendered so a plain
// refresh always works. React escapes all interpolated text.
export default async function OutputPage({
  params,
}: {
  params: { rid: string };
}) {
  const session = await getSessionByRid(params.rid);
  if (!session) notFound();

  const state = await getState(session.id);
  await logRequest({
    route: '/out/[rid]',
    sessionId: session.id,
    outcome: 'view',
  });

  const lastUpdated = state.lastOperation?.created_at
    ? displayTime(state.lastOperation.created_at)
    : displayTime(session.updated_at);

  const pollScript = `(function(){
    var rid=${JSON.stringify(session.read_id)};
    var buf=document.getElementById('live-buffer');
    var upd=document.getElementById('last-updated');
    function poll(){
      fetch('/api/session/'+encodeURIComponent(rid)+'?at='+Date.now(),{cache:'no-store'})
        .then(function(r){return r.json();})
        .then(function(d){
          if(buf) buf.textContent=(d.buffer&&d.buffer.length)?d.buffer:'\\u00a0';
          if(upd&&d.lastOperation&&d.lastOperation.createdAt) upd.textContent=d.lastOperation.createdAt;
        })
        .catch(function(){});
    }
    setInterval(poll,2000);
  })();`;

  return (
    <div>
      <h1>NAVIGATION CHANNEL</h1>

      <h2>Live message</h2>
      <div id="live-buffer" className="output-buffer">
        {state.buffer || ' '}
      </div>
      <p className="note">
        Last updated <span id="last-updated">{lastUpdated}</span>
      </p>

      <h2>Committed messages</h2>
      {state.commits.length === 0 ? (
        <p className="note">No committed messages yet.</p>
      ) : (
        <ol className="commit-list" reversed>
          {state.commits.map((c, i) => (
            <li key={c.id}>
              <div className="meta">
                #{state.commits.length - i} · {displayTime(c.createdAt)}
              </div>
              {c.text}
            </li>
          ))}
        </ol>
      )}

      {/* Optional progressive enhancement: poll JSON every 2s and update in
          place. The page is fully server-rendered, so this is never required
          to read state. */}
      <script dangerouslySetInnerHTML={{ __html: pollScript }} />
    </div>
  );
}
