import type { NormalizedHotelOfferBody } from '../../adapter';
import { commercialSourceForMode, type SupplierErrorKind } from '../../contract';
import { HOTELBEDS_BOARD_CODE_MAP, type HotelbedsRate } from './hotelbeds-contract';

/**
 * Phase 3C Part 2 — Hotelbeds → normalized-offer mapping.
 *
 * Every mapping decision here is deliberately conservative: an unrecognized
 * board code degrades to ROOM_ONLY (never throws), a cancellation policy the
 * mapper can't parse degrades to NON_REFUNDABLE (the safest assumption — it
 * never overstates what a customer is entitled to), and money is always
 * parsed from Hotelbeds' decimal-string amounts into integer minor units
 * with explicit rounding, never left as a float.
 */

export function mapBoardCode(code: string): NormalizedHotelOfferBody['boardBasis'] {
  return HOTELBEDS_BOARD_CODE_MAP[code.toUpperCase()] ?? 'ROOM_ONLY';
}

/** Hotelbeds amounts are decimal strings, e.g. "123.45". Converts to integer
 *  minor units (cents), never silently truncating a real fractional cent. */
export function decimalStringToMinorUnits(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid Hotelbeds decimal amount: ${value}`);
  }
  return Math.round(parsed * 100);
}

export function mapCancellationPolicy(
  policies: ReadonlyArray<{ amount: string; from: string }> | undefined
): NormalizedHotelOfferBody['cancellationPolicy'] {
  if (!policies || policies.length === 0) {
    return { kind: 'NON_REFUNDABLE' };
  }
  // Hotelbeds lists penalty tiers with an effective "from" date; the nearest
  // (earliest) tier is what currently applies. A tier with a zero penalty
  // effectively means "still free" until that date.
  const sorted = [...policies].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const nearest = sorted[0];
  const penaltyMinor = decimalStringToMinorUnits(nearest.amount);
  if (penaltyMinor === 0) {
    return { kind: 'FREE_UNTIL', freeUntil: nearest.from.slice(0, 10) };
  }
  return { kind: 'PARTIAL', penaltyMinor };
}

export type MapRateToOfferParams = {
  mode: 'SANDBOX' | 'LIVE';
  supplierId: string;
  supplierPropertyId: string;
  propertyName: string;
  destination: string;
  roomCode: string;
  roomName: string;
  rate: HotelbedsRate;
  occupancy: { adults: number; children: number; rooms: number };
  currency: NormalizedHotelOfferBody['currency'];
  createdAt: Date;
  offerTtlMs: number;
  supplierTraceId: string;
};

export function mapRateToOfferBody(params: MapRateToOfferParams): NormalizedHotelOfferBody {
  const netMinor = decimalStringToMinorUnits(params.rate.net);
  const sellMinor = params.rate.sellingRate ? decimalStringToMinorUnits(params.rate.sellingRate) : null;
  // sellingRate, when present, already includes Hotelbeds' own markup and is
  // treated as the closest thing to a supplier-presented customer total; net
  // is always the supplier-net figure regardless. Neither is a VOYARA markup
  // — none is invented here.
  const createdAt = params.createdAt;
  const expiresAt = new Date(createdAt.getTime() + params.offerTtlMs);

  return {
    supplierId: params.supplierId,
    supplierPropertyId: params.supplierPropertyId,
    internalPropertyId: null,
    propertyName: params.propertyName,
    destination: params.destination,
    roomType: params.roomName || params.roomCode,
    boardBasis: mapBoardCode(params.rate.boardCode),
    occupancy: params.occupancy,
    cancellationPolicy: mapCancellationPolicy(params.rate.cancellationPolicies),
    supplierNetMinor: netMinor,
    taxesMinor: 0,
    mandatoryFeesMinor: 0,
    currency: params.currency,
    customerTotalMinor: sellMinor,
    supplierOfferReference: params.rate.rateKey,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    supplierTraceId: params.supplierTraceId,
    commercialSource: commercialSourceForMode(params.mode),
    simulated: false
  };
}

/** Maps an HTTP-level failure (status + optional parsed body) onto the shared
 *  normalized error taxonomy. Deliberately status-code-first: HTTP semantics
 *  (401/403/429/5xx/timeout) are universal and don't require live
 *  Hotelbeds-specific verification, unlike fine-grained error-code enums. */
export function mapHttpFailureToErrorKind(status: number | 'TIMEOUT'): SupplierErrorKind {
  if (status === 'TIMEOUT') return 'TIMEOUT';
  if (status === 401 || status === 403) return 'TERMINAL_FAILURE';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 400 || status === 422) return 'VALIDATION';
  if (status >= 500) return 'UNAVAILABLE';
  return 'TERMINAL_FAILURE';
}
