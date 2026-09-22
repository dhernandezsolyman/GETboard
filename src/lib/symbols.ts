// Symbol vocabulary for the link-only keyboard.
//
// A "symbol" is the path token that appears in /key/... and /execute/... URLs.
// Letters (A-Z, a-z, case-sensitive) and digits (0-9) are used literally.
// Everything else uses an ALL-CAPS name so no raw special character ever
// appears in a URL path.

export const NAMED_SYMBOLS = [
  'SPACE',
  'BACKSPACE',
  'NEWLINE',
  'PERIOD',
  'COMMA',
  'QUESTION',
  'EXCLAMATION',
  'COLON',
  'SEMICOLON',
  'DASH',
  'SLASH',
  'COMMIT',
] as const;

export type NamedSymbol = (typeof NAMED_SYMBOLS)[number];

// Characters that named symbols (other than the special ones) insert.
const NAMED_CHAR: Partial<Record<NamedSymbol, string>> = {
  SPACE: ' ',
  NEWLINE: '\n',
  PERIOD: '.',
  COMMA: ',',
  QUESTION: '?',
  EXCLAMATION: '!',
  COLON: ':',
  SEMICOLON: ';',
  DASH: '-',
  SLASH: '/',
};

const LETTERS_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LETTERS_LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');

// Full ordered keyboard layout. Order is stable so pages render consistently.
export const KEYBOARD_LAYOUT: string[] = [
  ...LETTERS_UPPER,
  ...LETTERS_LOWER,
  ...DIGITS,
  'SPACE',
  'PERIOD',
  'COMMA',
  'QUESTION',
  'EXCLAMATION',
  'COLON',
  'SEMICOLON',
  'DASH',
  'SLASH',
  'NEWLINE',
  'BACKSPACE',
  'COMMIT',
];

const NAMED_SET = new Set<string>(NAMED_SYMBOLS);

/** True if `symbol` is a valid path token (literal alnum or a known name). */
export function isValidSymbol(symbol: string): boolean {
  if (NAMED_SET.has(symbol)) return true;
  return /^[A-Za-z0-9]$/.test(symbol);
}

/** Human-readable key label, e.g. "a", "A", "SPACE". */
export function keyLabel(symbol: string): string {
  return symbol;
}

/**
 * Apply a symbol to a working buffer, returning the new buffer.
 * COMMIT must be handled by the caller (it resets the buffer and creates a
 * commit record); here it is a no-op on the text.
 */
export function applySymbol(buffer: string, symbol: string): string {
  if (symbol === 'COMMIT') return buffer;
  if (symbol === 'BACKSPACE') {
    // Remove the last code point (handles surrogate pairs safely).
    const chars = Array.from(buffer);
    chars.pop();
    return chars.join('');
  }
  if (NAMED_SET.has(symbol)) {
    const ch = NAMED_CHAR[symbol as NamedSymbol];
    return ch !== undefined ? buffer + ch : buffer;
  }
  // Literal alphanumeric.
  return buffer + symbol;
}
