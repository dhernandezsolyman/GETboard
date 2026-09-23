// URL path builders. Short forms keep agent-facing pages compact (every ACK
// keyboard repeats these ~74 times, so a few saved characters per link matter).
//
// Short routes (/k, /x) are aliases of the descriptive routes (/key, /execute)
// and share the same implementation.

export const keyboardPath = (wid: string, seq: number) => `/kbd/${wid}/${seq}`;

export const previewPath = (wid: string, seq: number, symbol: string) =>
  `/k/${wid}/${seq}/${symbol}`;

export const executePath = (
  wid: string,
  seq: number,
  symbol: string,
  token: string,
) => `/x/${wid}/${seq}/${symbol}/${token}`;
