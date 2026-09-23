import React from 'react';
import { KEYBOARD_LAYOUT, keyLabel } from '@/lib/symbols';
import { previewPath, executePath } from '@/lib/paths';
import { makeToken } from '@/lib/token';

export const PROTOCOL_NOTE_PREVIEW =
  'Follow a key link, then follow the single EXECUTE link. The ACK page shows ' +
  'the new BUFFER and the next keyboard. Verify BUFFER after every keystroke. ' +
  'On CONFLICT or STALE, use the links provided.';

export const PROTOCOL_NOTE_EXECUTE =
  'Each key link records that symbol directly (one fetch). The ACK page shows ' +
  'the new BUFFER and the next keyboard. Verify BUFFER after every keystroke. ' +
  'On CONFLICT or STALE, follow the links provided.';

/** A <pre> block of plain KEY: VALUE lines. */
export function StatusBlock({ lines }: { lines: [string, string][] }) {
  const text = lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  return <pre className="status">{text}</pre>;
}

/**
 * Entry / recovery keyboard: one <a> per symbol to the (non-mutating) preview
 * route. This is the strict SAFE MODE path (preview -> execute).
 */
export function PreviewKeyboard({ wid, seq }: { wid: string; seq: number }) {
  return (
    <div className="keyboard">
      <p className="note">{PROTOCOL_NOTE_PREVIEW}</p>
      <ul className="keys">
        {KEYBOARD_LAYOUT.map((symbol) => (
          <li key={symbol}>
            <a rel="nofollow" href={previewPath(wid, seq, symbol)}>
              {`KEY: ${keyLabel(symbol)}`}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ACK keyboard: one <a> per symbol pointing directly at the execute route with
 * an inline single-use token, so a keystroke costs one fetch instead of two.
 * Only rendered on ACK pages, which are reachable solely via a one-time execute
 * URL (so prefetchers/crawlers never land here).
 */
export function ExecuteKeyboard({ wid, seq }: { wid: string; seq: number }) {
  return (
    <div className="keyboard">
      <p className="note">{PROTOCOL_NOTE_EXECUTE}</p>
      <ul className="keys">
        {KEYBOARD_LAYOUT.map((symbol) => (
          <li key={symbol}>
            <a
              rel="nofollow"
              href={executePath(wid, seq, symbol, makeToken(wid, seq, symbol))}
            >
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
