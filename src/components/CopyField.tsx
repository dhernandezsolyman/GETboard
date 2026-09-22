'use client';

import React, { useState } from 'react';

export function CopyField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <label>
        {label}
        {secret ? ' — SECRET, do not share' : ''}
      </label>
      <code>{value}</code>
      <button
        type="button"
        className="copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard may be unavailable; the value is visible above */
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
