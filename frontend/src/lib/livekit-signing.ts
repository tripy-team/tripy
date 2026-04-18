/**
 * HMAC-signed LiveKit join links.
 *
 * The advisor's token-mint endpoint signs (roomName, clientId, expiresAt)
 * with the server's secret. The client's `/join` page forwards sig+exp+clientId
 * to the token endpoint which verifies before minting a client-scoped token.
 *
 * Stateless — no DB round-trip — and short-lived (default 1 hour).
 */

import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || process.env.LIVEKIT_API_SECRET || '';

function hmac(payload: string): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('base64url');
}

function payloadString(roomName: string, clientId: string, exp: number): string {
  return `${roomName}:${clientId}:${exp}`;
}

export interface SignedJoinParts {
  clientId: string;
  exp: number;
  sig: string;
}

export function signJoinLink(
  roomName: string,
  clientId: string,
  ttlSeconds: number = 60 * 60,
): SignedJoinParts {
  if (!SECRET) {
    throw new Error(
      'Server signing secret missing: set JWT_SECRET or LIVEKIT_API_SECRET',
    );
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(payloadString(roomName, clientId, exp));
  return { clientId, exp, sig };
}

export function verifyJoinLink(
  roomName: string,
  clientId: string,
  exp: number,
  sig: string,
): { ok: true } | { ok: false; reason: string } {
  if (!SECRET) return { ok: false, reason: 'server_secret_missing' };
  if (!roomName || !clientId || !exp || !sig) {
    return { ok: false, reason: 'missing_fields' };
  }
  if (exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }

  const expected = hmac(payloadString(roomName, clientId, exp));
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}
