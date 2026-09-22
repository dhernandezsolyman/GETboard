import React from 'react';
import { headers } from 'next/headers';
import { createSession, logRequest } from '@/lib/session';
import { CopyField } from '@/components/CopyField';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function baseUrl(): string {
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

export default async function HomePage() {
  const session = await createSession();
  await logRequest({
    route: '/',
    sessionId: session.id,
    outcome: 'view',
    userAgent: headers().get('user-agent'),
  });

  const base = baseUrl();
  const writeUrl = `${base}/kbd/${session.write_id}`;
  const stateUrl = `${base}/api/session/${session.read_id}`;
  const outputUrl = `${base}/out/${session.read_id}`;

  return (
    <div>
      <h1>GETboard</h1>
      <p>
        A link-only navigation channel. A web-reading agent transmits text
        purely by choosing which links to follow. Each deliberate navigation
        becomes one recorded keystroke; a human watches the message appear on
        the clean OUTPUT page.
      </p>

      <p className="warn">
        A new session was just created. The WRITE URL is a secret — anyone who
        has it can type into this session. Share only the READ / OUTPUT URLs.
      </p>

      <CopyField label="WRITE URL (keyboard, secret)" value={writeUrl} secret />
      <CopyField label="STATE URL (JSON, shareable)" value={stateUrl} />
      <CopyField label="OUTPUT URL (public page, shareable)" value={outputUrl} />

      <h2>How to use</h2>
      <ol>
        <li>
          Give the agent the WRITE URL. It reads the keyboard and follows a
          key link, then the single EXECUTE link, once per keystroke.
        </li>
        <li>Each ACK page shows the new BUFFER and the next keyboard.</li>
        <li>
          Share the OUTPUT URL with a human to watch the message, or the STATE
          URL for machine-readable JSON.
        </li>
      </ol>

      <p>
        <a rel="nofollow" href="/">
          Create another session
        </a>
      </p>
    </div>
  );
}
