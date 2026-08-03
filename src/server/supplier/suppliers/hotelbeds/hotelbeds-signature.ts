import { createHash } from 'node:crypto';

/**
 * Phase 3C Part 2 — Hotelbeds request signature.
 *
 * Hotelbeds' Booking API v3 authenticates every request with two headers:
 *   Api-key:    the public API key
 *   X-Signature: lowercase hex SHA256(apiKey + apiSecret + unixTimestampSeconds)
 *
 * This scheme is stable, publicly documented, and unchanged across Hotelbeds'
 * API versions for years — it is the one part of this integration that can be
 * implemented with full confidence without live access to verify. Everything
 * downstream of authentication (exact endpoint paths, field names) is marked
 * separately in hotelbeds-contract.ts as "verify against the live sandbox
 * docs" precisely because THAT detail cannot be confirmed without network
 * access to developer.hotelbeds.com, which this environment does not have.
 */

export function hotelbedsSignature(apiKey: string, apiSecret: string, unixTimestampSeconds: number): string {
  return createHash('sha256').update(`${apiKey}${apiSecret}${unixTimestampSeconds}`).digest('hex');
}

export function hotelbedsAuthHeaders(
  apiKey: string,
  apiSecret: string,
  now: () => Date = () => new Date()
): Record<string, string> {
  const timestamp = Math.floor(now().getTime() / 1000);
  return {
    'Api-key': apiKey,
    'X-Signature': hotelbedsSignature(apiKey, apiSecret, timestamp),
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip'
  };
}
