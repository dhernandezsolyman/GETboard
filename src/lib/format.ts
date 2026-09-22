// Display helpers for agent-facing pages.

/** Render a buffer with visible markers: wrapped in quotes, newlines as ⏎. */
export function displayBuffer(buffer: string): string {
  return `"${buffer.replace(/\n/g, '⏎')}"`;
}

/** ISO timestamp -> readable UTC string; tolerant of already-formatted input. */
export function displayTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString();
}
