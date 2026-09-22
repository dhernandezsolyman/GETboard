import { randomBytes } from 'node:crypto';

// base62 alphabet.
const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a non-enumerable random ID with at least `bits` of entropy,
 * encoded in base62. Default 160 bits (> 128 as required).
 */
export function randomId(bits = 160): string {
  const nBytes = Math.ceil(bits / 8);
  const buf = randomBytes(nBytes);
  // Convert bytes to a big integer, then to base62.
  let value = 0n;
  for (const b of buf) value = (value << 8n) | BigInt(b);
  if (value === 0n) return '0';
  let out = '';
  const base = 62n;
  while (value > 0n) {
    const rem = Number(value % base);
    out = ALPHABET[rem] + out;
    value = value / base;
  }
  return out;
}
