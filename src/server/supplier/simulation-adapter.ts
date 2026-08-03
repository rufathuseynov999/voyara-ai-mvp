import { createHash } from 'node:crypto';
import {
  bookingPreparationRequestSchema,
  finaliseOffer,
  hotelAvailabilityRequestSchema,
  hotelSearchRequestSchema,
  offerRevalidationRequestSchema,
  type BookingPreparationPayload,
  type BookingPreparationRequest,
  type HotelAvailabilityRequest,
  type HotelSearchRequest,
  type NormalizedHotelOffer,
  type NormalizedHotelOfferBody,
  type OfferRevalidationRequest,
  type SupplierAdapter,
  type SupplierHealth,
  type SupplierResult
} from './adapter';
import {
  commercialSourceForMode,
  normalizeSupplierError,
  type BoardBasis,
  type SupplierOperation
} from './contract';

/**
 * Deterministic simulation supplier adapter.
 *
 * Fully offline: no network is ever contacted. Every value is derived from a
 * seeded pseudo-random stream keyed on the request, so identical valid requests
 * return byte-identical offers (stable content hashes). All output is labelled
 * `simulated: true` with commercial source SIMULATED and clearly simulated
 * supplier/property references. Deterministic scenarios (unavailable,
 * price-changed) are triggered by reserved reference/property tokens so tests
 * can exercise normalization without any real supplier.
 */

const SUPPLIER_ID = 'sim-supplier';
/** Default clock for offer validity windows. Commercial values (prices, refs,
 *  policies) stay fully seed-deterministic regardless of the clock; only
 *  createdAt/expiresAt move with it so sandbox offers are actually bookable.
 *  Tests inject a fixed clock for byte-exact determinism assertions. */
const defaultClock = () => new Date();

/** Deterministic 32-bit stream seeded from a stable string. */
function seededStream(seed: string): () => number {
  const digest = createHash('sha256').update(seed).digest();
  let index = 0;
  return () => {
    // Pull 4 bytes at a time, wrapping around the 32-byte digest.
    const offset = (index * 4) % 28;
    index += 1;
    const value = digest.readUInt32BE(offset);
    return value / 0xffffffff;
  };
}

function pick<T>(stream: () => number, list: readonly T[]): T {
  return list[Math.floor(stream() * list.length) % list.length];
}

const ROOM_TYPES = ['Deluxe Room', 'Overwater Villa', 'Garden Suite', 'Beach Bungalow', 'Premier Suite'] as const;
const BOARDS: readonly BoardBasis[] = ['ROOM_ONLY', 'BED_AND_BREAKFAST', 'HALF_BOARD', 'FULL_BOARD', 'ALL_INCLUSIVE'];
const PROPERTY_NAMES = ['Azure Lagoon Resort', 'Coral Sands Hotel', 'Palm Horizon Retreat', 'Marina Bay Suites'] as const;

/** Reserved tokens that force deterministic scenarios in tests. */
const UNAVAILABLE_TOKEN = 'SIM-UNAVAILABLE';
const PRICE_CHANGED_TOKEN = 'SIM-PRICECHANGED';

function nights(checkIn: string, checkOut: string): number {
  return Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000));
}

function buildOffer(clock: () => Date, params: {
  seed: string;
  index: number;
  destination: string;
  checkIn: string;
  checkOut: string;
  occupancy: { adults: number; children: number; rooms: number };
  currency: NormalizedHotelOfferBody['currency'];
  priceBumpMinor?: number;
}): NormalizedHotelOffer {
  const stream = seededStream(`${params.seed}#${params.index}`);
  const propertyName = pick(stream, PROPERTY_NAMES);
  const roomType = pick(stream, ROOM_TYPES);
  const boardBasis = pick(stream, BOARDS);
  const stayNights = nights(params.checkIn, params.checkOut);

  // Deterministic pricing components. These are illustrative simulation values,
  // NOT a markup/commission formula: supplier net + taxes + mandatory fees are
  // reported as-is; no customer total is fabricated (left null).
  const baseNightlyMinor = 40_000 + Math.floor(stream() * 60_000);
  const supplierNetMinor = baseNightlyMinor * stayNights * params.occupancy.rooms + (params.priceBumpMinor ?? 0);
  const taxesMinor = Math.floor(supplierNetMinor * 0.12);
  const mandatoryFeesMinor = 2_000 + Math.floor(stream() * 8_000);

  const nowMs = clock().getTime();
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + 30 * 60_000).toISOString();
  const reference = `SIM-OFFER-${params.index}-${createHash('sha256').update(params.seed).digest('hex').slice(0, 10)}`;

  const cancellationPolicy = stream() > 0.5
    ? { kind: 'FREE_UNTIL' as const, freeUntil: params.checkIn }
    : { kind: 'NON_REFUNDABLE' as const };

  const body: NormalizedHotelOfferBody = {
    supplierId: SUPPLIER_ID,
    supplierPropertyId: `SIM-PROP-${params.index}`,
    internalPropertyId: null,
    propertyName: `[SIMULATED] ${propertyName}`,
    destination: params.destination,
    roomType,
    boardBasis,
    occupancy: params.occupancy,
    cancellationPolicy,
    supplierNetMinor,
    taxesMinor,
    mandatoryFeesMinor,
    currency: params.currency,
    customerTotalMinor: null,
    supplierOfferReference: reference,
    createdAt,
    expiresAt,
    supplierTraceId: `SIM-TRACE-${params.index}`,
    commercialSource: commercialSourceForMode('SIMULATION'),
    simulated: true
  };
  return finaliseOffer(body);
}

export class SimulationSupplierAdapter implements SupplierAdapter {
  readonly supplierId = SUPPLIER_ID;
  readonly mode = 'SIMULATION' as const;
  readonly simulated = true;

  constructor(private readonly clock: () => Date = defaultClock) {}

  supports(operation: SupplierOperation): boolean {
    const supported: readonly SupplierOperation[] = ['SEARCH', 'AVAILABILITY', 'REVALIDATION', 'BOOKING_PREPARATION'];
    return supported.includes(operation);
  }

  async search(request: HotelSearchRequest): Promise<SupplierResult<NormalizedHotelOffer[]>> {
    const parsed = hotelSearchRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { destination, checkIn, checkOut, occupancy, currency } = parsed.data;

    if (destination.toUpperCase().includes(UNAVAILABLE_TOKEN)) {
      return { ok: false, error: normalizeSupplierError('UNAVAILABLE') };
    }

    const seed = `${destination}|${checkIn}|${checkOut}|${occupancy.adults}|${occupancy.children}|${occupancy.rooms}|${currency}`;
    const count = 4;
    const offers = Array.from({ length: count }, (_unused, index) =>
      buildOffer(this.clock, { seed, index, destination, checkIn, checkOut, occupancy, currency }));
    return { ok: true, value: offers };
  }

  async availability(request: HotelAvailabilityRequest): Promise<SupplierResult<NormalizedHotelOffer[]>> {
    const parsed = hotelAvailabilityRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { supplierPropertyId, checkIn, checkOut, occupancy, currency } = parsed.data;

    if (supplierPropertyId.toUpperCase().includes(UNAVAILABLE_TOKEN)) {
      return { ok: false, error: normalizeSupplierError('UNAVAILABLE') };
    }

    const seed = `${supplierPropertyId}|${checkIn}|${checkOut}|${occupancy.adults}|${occupancy.children}|${occupancy.rooms}|${currency}`;
    const offers = Array.from({ length: 2 }, (_unused, index) =>
      buildOffer(this.clock, { seed, index, destination: supplierPropertyId, checkIn, checkOut, occupancy, currency }));
    return { ok: true, value: offers };
  }

  async revalidate(request: OfferRevalidationRequest): Promise<SupplierResult<NormalizedHotelOffer>> {
    const parsed = offerRevalidationRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { supplierOfferReference } = parsed.data;

    if (supplierOfferReference.toUpperCase().includes(UNAVAILABLE_TOKEN)) {
      return { ok: false, error: normalizeSupplierError('UNAVAILABLE') };
    }
    const priceBumpMinor = supplierOfferReference.toUpperCase().includes(PRICE_CHANGED_TOKEN) ? 25_000 : 0;
    if (priceBumpMinor > 0) {
      // Signal a material price change explicitly.
      return { ok: false, error: normalizeSupplierError('PRICE_CHANGED') };
    }

    // Deterministic single re-priced offer for the reference.
    const offer = buildOffer(this.clock, {
      seed: supplierOfferReference,
      index: 0,
      destination: 'Revalidated stay',
      checkIn: '2026-08-12',
      checkOut: '2026-08-19',
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'AZN'
    });
    return { ok: true, value: offer };
  }

  async prepareBooking(request: BookingPreparationRequest): Promise<SupplierResult<BookingPreparationPayload>> {
    const parsed = bookingPreparationRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { supplierOfferReference, correlationId } = parsed.data;

    if (supplierOfferReference.toUpperCase().includes(UNAVAILABLE_TOKEN)) {
      return { ok: false, error: normalizeSupplierError('UNAVAILABLE') };
    }

    const offer = buildOffer(this.clock, {
      seed: supplierOfferReference,
      index: 0,
      destination: 'Prepared stay',
      checkIn: '2026-08-12',
      checkOut: '2026-08-19',
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'AZN'
    });

    // Preparation produces a human-reviewable payload only; it never books.
    const payload: BookingPreparationPayload = {
      supplierId: SUPPLIER_ID,
      supplierOfferReference,
      offerContentHash: offer.contentHash,
      commercialSource: commercialSourceForMode('SIMULATION'),
      simulated: true,
      preparedAt: this.clock().toISOString(),
      correlationId,
      requiresHumanApproval: true
    };
    return { ok: true, value: payload };
  }

  async health(): Promise<SupplierHealth> {
    return {
      supplierId: SUPPLIER_ID,
      mode: 'SIMULATION',
      simulated: true,
      healthy: true,
      checkedAt: this.clock().toISOString()
    };
  }
}
