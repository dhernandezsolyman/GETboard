import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// Stateless single-use-preview tokens.
//
// token = base64url( exp || '|' || HMAC-SHA256(SERVER_SECRET, `${wid}|${seq}|${symbol}|${exp}`) )
//
// Nothing is stored when a token is minted. Single use is enforced by the DB
// unique(session_id, sequence) constraint at execute time, not by the token.

const TEN_MINUTES_MS = 10 * 60 * 1000;

function serverSecret(): string {
  const s = process.env.SERVER_SECRET;
  if (!s) throw new Error('SERVER_SECRET is not set');
  return s;
}

function sign(
  wid: string,
  seq: number,
  symbol: string,
  exp: number,
): Buffer {
  return createHmac('sha256', serverSecret())
    .update(`${wid}|${seq}|${symbol}|${exp}`)
    .digest();
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Mint a preview token valid for 10 minutes. Pure; writes nothing. */
export function makeToken(
  wid: string,
  seq: number,
  symbol: string,
  now = Date.now(),
): string {
  const exp = now + TEN_MINUTES_MS;
  const mac = sign(wid, seq, symbol, exp);
  const buf = Buffer.concat([Buffer.from(`${exp}|`, 'utf8'), mac]);
  return base64url(buf);
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
  const sep = buf.indexOf(0x7c); // '|'
  if (sep <= 0) return { ok: false, reason: 'invalid' };
  const expStr = buf.subarray(0, sep).toString('utf8');
  const mac = buf.subarray(sep + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || mac.length !== 32) {
    return { ok: false, reason: 'invalid' };
  }
  const expected = sign(wid, seq, symbol, exp);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    return { ok: false, reason: 'invalid' };
  }
  if (exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** sha256 of the raw token string, stored on the operation row for diagnostics. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
