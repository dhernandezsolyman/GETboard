import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// Compact stateless preview/execute tokens.
//
// Layout (12 bytes, base64url -> 16 chars):
//   [ 4 bytes big-endian expiry, unix seconds ][ 8 bytes truncated HMAC ]
//   mac = HMAC-SHA256(SERVER_SECRET, `${wid}|${seq}|${symbol}|${exp}`)[0..8]
//
// Nothing is stored when a token is minted. Single use is enforced by the DB
// unique(session_id, sequence) constraint at execute time, not by the token.
//
// A 64-bit truncated HMAC is sufficient here: forging one still requires the
// server secret, tokens expire in 10 minutes, and the sequence gate plus the
// unique constraint mean a valid signature only ever records one operation.

const TEN_MINUTES_S = 10 * 60;
const MAC_BYTES = 8;
const TOKEN_BYTES = 4 + MAC_BYTES;

function serverSecret(): string {
  const s = process.env.SERVER_SECRET;
  if (!s) throw new Error('SERVER_SECRET is not set');
  return s;
}

function macFor(
  wid: string,
  seq: number,
  symbol: string,
  expSec: number,
): Buffer {
  return createHmac('sha256', serverSecret())
    .update(`${wid}|${seq}|${symbol}|${expSec}`)
    .digest()
    .subarray(0, MAC_BYTES);
}

/** Mint a token valid for 10 minutes. Pure; writes nothing. */
export function makeToken(
  wid: string,
  seq: number,
  symbol: string,
  now = Date.now(),
): string {
  const expSec = Math.floor(now / 1000) + TEN_MINUTES_S;
  const buf = Buffer.alloc(TOKEN_BYTES);
  buf.writeUInt32BE(expSec, 0);
  macFor(wid, seq, symbol, expSec).copy(buf, 4);
  return buf.toString('base64url');
}

export type TokenCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' };

/** Validate signature, expiry, and that wid/seq/symbol match the path. */
export function verifyToken(
  token: string,
  wid: string,
  seq: number,
  symbol: string,
  now = Date.now(),
): TokenCheck {
  let buf: Buffer;
  try {
    buf = Buffer.from(token, 'base64url');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (buf.length !== TOKEN_BYTES) return { ok: false, reason: 'invalid' };

  const expSec = buf.readUInt32BE(0);
  const mac = buf.subarray(4);
  const expected = macFor(wid, seq, symbol, expSec);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    return { ok: false, reason: 'invalid' };
  }
  if (expSec <= Math.floor(now / 1000)) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** sha256 of the raw token string, stored on the operation row for diagnostics. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
