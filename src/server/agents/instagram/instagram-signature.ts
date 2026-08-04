import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Phase 4H — Instagram/Meta webhook verification. Both mechanisms below are
 * Meta's own stable, publicly documented schemes, identical across every
 * Meta Graph API product (WhatsApp, Instagram, Messenger) — implemented
 * with full confidence independent of live access, same posture as
 * whatsapp-signature.ts and hotelbeds-signature.ts. The logic here is
 * intentionally byte-for-byte the same algorithm as whatsapp-signature.ts;
 * it is kept as its own file (rather than imported from the WhatsApp
 * module) so the Instagram adapter has no dependency on WhatsApp-specific
 * code, matching this project's existing rule that each channel adapter
 * stands alone.
 */

/** Meta's webhook setup GET request: ?hub.mode=subscribe&hub.verify_token=X
 *  &hub.challenge=Y. Returns the challenge string to echo back on success,
 *  or null if the mode/token don't match (caller should respond 403). */
export function verifyInstagramWebhookChallenge(params: {
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
 *  before JSON parsing, on the exact bytes Meta signed. The app secret is
 *  the single Meta App's secret, shared by both brands' Instagram accounts
 *  (one Meta App can own multiple Pages/IG accounts) — brand is resolved
 *  separately, from the verified payload's account/page id, never from the
 *  signature itself. */
export function verifyInstagramWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
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
