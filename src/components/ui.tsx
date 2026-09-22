import React from 'react';
import { KEYBOARD_LAYOUT, keyLabel } from '@/lib/symbols';

export const PROTOCOL_NOTE =
  'Follow a key link, then follow the single EXECUTE link. The ACK page shows ' +
  'the new BUFFER and the next keyboard. Verify BUFFER after every keystroke. ' +
  'On CONFLICT or STALE, use the links provided.';

/** A <pre> block of plain KEY: VALUE lines. */
export function StatusBlock({ lines }: { lines: [string, string][] }) {
  const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  return <pre className="status">{text}</pre>;
}

/**
 * The keyboard: one plain <a> per symbol, pointing at the preview route.
 * Uses rel="nofollow" and raw anchors (no client JS / prefetch).
 */
export function Keyboard({ wid, seq }: { wid: string; seq: number }) {
  return (
    <div className="keyboard">
      <p className="note">{PROTOCOL_NOTE}</p>
      <ul className="keys">
        {KEYBOARD_LAYOUT.map((symbol) => (
          <li key={symbol}>
            <a rel="nofollow" href={`/key/${wid}/${seq}/${symbol}`}>
              {`KEY: ${keyLabel(symbol)}`}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small footer with links to STATE (JSON) and OUTPUT pages. */
export function ReadLinks({ rid }: { rid: string }) {
  return (
    <ul className="readlinks">
      <li>
        <a rel="nofollow" href={`/api/session/${rid}`}>
          STATE (JSON)
        </a>
      </li>
      <li>
        <a rel="nofollow" href={`/out/${rid}`}>
          OUTPUT
        </a>
      </li>
    </ul>
  );
}
