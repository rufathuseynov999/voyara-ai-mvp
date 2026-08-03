import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Phase 4C — WhatsApp/Meta webhook verification. Both mechanisms below are
 * Meta's own stable, publicly documented schemes — implemented with full
 * confidence independent of live access, same posture as
 * hotelbeds-signature.ts.
 */

/** Meta's webhook setup GET request: ?hub.mode=subscribe&hub.verify_token=X
 *  &hub.challenge=Y. Returns the challenge string to echo back on success,
 *  or null if the mode/token don't match (caller should respond 403). */
export function verifyWebhookChallenge(params: {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
  configuredVerifyToken: string;
}): string | null {
  if (params.mode !== 'subscribe') return null;
  if (!params.verifyToken || !params.challenge) return null;
  if (params.verifyToken.length !== params.configuredVerifyToken.length) return null;
  try {
    const match = timingSafeEqual(Buffer.from(params.verifyToken), Buffer.from(params.configuredVerifyToken));
    return match ? params.challenge : null;
  } catch {
    return null;
  }
}

/** Meta signs every webhook POST body with X-Hub-Signature-256:
 *  "sha256=" + HMAC-SHA256(appSecret, rawBody). Verifies against the raw
 *  (unparsed) request body — signature verification must always happen
 *  before JSON parsing, on the exact bytes Meta signed. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length);
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
