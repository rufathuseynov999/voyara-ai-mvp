import { randomUUID } from 'node:crypto';
import type { HotelbedsCredentials } from '@/config/env-core';
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
  type OfferRevalidationRequest,
  type SupplierAdapter,
  type SupplierHealth,
  type SupplierResult
} from '../../adapter';
import { commercialSourceForMode, normalizeSupplierError, type SupplierOperation } from '../../contract';
import { recordSupplierRequest, recordSupplierResponse } from '../../supplier-audit-store';
import { hotelbedsAuthHeaders } from './hotelbeds-signature';
import { mapHttpFailureToErrorKind, mapRateToOfferBody } from './hotelbeds-mapper';
import {
  hotelbedsCheckRateResponseSchema,
  hotelbedsSearchResponseSchema,
  type HotelbedsHotel,
  type HotelbedsSearchRequest as HotelbedsWireSearchRequest
} from './hotelbeds-contract';

/**
 * Phase 3C Part 2 — Hotelbeds supplier adapter (SANDBOX only).
 *
 * Controlled single-supplier activation. This adapter can ONLY be
 * constructed in SANDBOX mode (see registry.ts) — LIVE remains unavailable,
 * matching Phase 3A/3B's fail-closed rule that no live supplier capability is
 * claimed. There is no reference anywhere in this file to Hotelbeds' booking
 * confirmation endpoint (`/hotel-api/1.0/bookings`, POST) — `prepareBooking`
 * revalidates pricing and returns a payload for HUMAN review only
 * (`requiresHumanApproval: true`, enforced by the schema itself as a literal
 * type, not just a runtime check). No code path in this adapter can execute a
 * real booking, charge, or cancellation.
 *
 * No live network calls have been made from this environment — there is no
 * network path to api.test.hotelbeds.com from here and no credentials exist
 * anywhere in this project (see the Part 2 checkpoint for the credential
 * search performed). This adapter is complete and ready to certify the
 * moment real sandbox credentials are supplied; until then,
 * scripts/certify-hotelbeds-sandbox.mjs exercises it against the documented
 * fixtures in hotelbeds-fixtures.ts instead of a live endpoint.
 */

const SUPPLIER_ID = 'hotelbeds';
const SEARCH_PATH = '/hotel-api/1.0/hotels';
const CHECKRATE_PATH = '/hotel-api/1.0/checkrates';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_OFFER_TTL_MS = 15 * 60_000; // Hotelbeds rateKeys are short-lived; 15 minutes is conservative.

export type HotelbedsAdapterOptions = {
  /** The actor attributed to server-initiated calls this adapter instance
   *  makes. The SupplierAdapter interface itself carries no per-call actor
   *  parameter (shared with SimulationSupplierAdapter and every other
   *  adapter), so this is supplied once at construction — see registry.ts
   *  for how it is threaded from the orchestration context. */
  actorId: string;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
  offerTtlMs?: number;
};

type HttpOutcome =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number | 'TIMEOUT'; body: unknown };

export class HotelbedsSupplierAdapter implements SupplierAdapter {
  readonly supplierId = SUPPLIER_ID;
  readonly mode = 'SANDBOX' as const;
  readonly simulated = false;

  private readonly actorId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeoutMs: number;
  private readonly offerTtlMs: number;

  constructor(private readonly credentials: HotelbedsCredentials, options: HotelbedsAdapterOptions) {
    this.actorId = options.actorId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.offerTtlMs = options.offerTtlMs ?? DEFAULT_OFFER_TTL_MS;
  }

  supports(operation: SupplierOperation): boolean {
    return operation === 'SEARCH' || operation === 'AVAILABILITY' || operation === 'REVALIDATION' || operation === 'BOOKING_PREPARATION';
  }

  private async post(path: string, body: unknown): Promise<HttpOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.credentials.baseUrl}${path}`, {
        method: 'POST',
        headers: hotelbedsAuthHeaders(this.credentials.apiKey, this.credentials.apiSecret, this.clock),
        body: JSON.stringify(body),
        signal: controller.signal
      });
      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }
      if (!response.ok) return { ok: false, status: response.status, body: parsedBody };
      return { ok: true, status: response.status, body: parsedBody };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return { ok: false, status: isAbort ? 'TIMEOUT' : 500, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  private async audited<T>(
    operation: SupplierOperation,
    correlationId: string,
    work: (requestId: string) => Promise<SupplierResult<T>>
  ): Promise<SupplierResult<T>> {
    const requestId = randomUUID();
    await recordSupplierRequest({
      requestId,
      operation,
      mode: this.mode,
      supplierId: this.supplierId,
      correlationId,
      actorId: this.actorId
    }).catch(() => {
      // Audit persistence is best-effort in environments without a
      // configured database (e.g. hermetic unit tests): recordSupplierRequest
      // itself already no-ops when Supabase isn't configured, and any other
      // failure here must never block the underlying supplier call.
    });

    const result = await work(requestId);

    await recordSupplierResponse({
      requestId,
      ok: result.ok,
      errorKind: result.ok ? null : result.error.kind,
      supplierTraceId: result.ok ? null : null,
      source: commercialSourceForMode(this.mode),
      simulated: this.simulated
    }).catch(() => {});

    return result;
  }

  private offersFromHotel(
    hotel: HotelbedsHotel,
    destination: string,
    occupancy: { adults: number; children: number; rooms: number },
    currency: NormalizedHotelOffer['currency']
  ): NormalizedHotelOffer[] {
    const createdAt = this.clock();
    const offers: NormalizedHotelOffer[] = [];
    for (const room of hotel.rooms) {
      for (const rate of room.rates) {
        offers.push(finaliseOffer(mapRateToOfferBody({
          mode: this.mode,
          supplierId: this.supplierId,
          supplierPropertyId: String(hotel.code),
          propertyName: hotel.name,
          destination,
          roomCode: room.code,
          roomName: room.name,
          rate,
          occupancy,
          currency,
          createdAt,
          offerTtlMs: this.offerTtlMs,
          supplierTraceId: `hb-${hotel.code}-${room.code}`
        })));
      }
    }
    return offers;
  }

  async search(request: HotelSearchRequest): Promise<SupplierResult<NormalizedHotelOffer[]>> {
    const parsed = hotelSearchRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { destination, checkIn, checkOut, occupancy, currency, correlationId } = parsed.data;

    return this.audited('SEARCH', correlationId, async () => {
      const wireRequest: HotelbedsWireSearchRequest = {
        stay: { checkIn, checkOut },
        occupancies: [{ rooms: occupancy.rooms, adults: occupancy.adults, children: occupancy.children }],
        destination: { code: destination }
      };
      const outcome = await this.post(SEARCH_PATH, wireRequest);
      if (!outcome.ok) return { ok: false, error: normalizeSupplierError(mapHttpFailureToErrorKind(outcome.status)) };

      const body = hotelbedsSearchResponseSchema.safeParse(outcome.body);
      if (!body.success) return { ok: false, error: normalizeSupplierError('TERMINAL_FAILURE') };

      const offers = body.data.hotels.hotels.flatMap((hotel) =>
        this.offersFromHotel(hotel, destination, occupancy, currency)
      );
      return { ok: true, value: offers };
    });
  }

  async availability(request: HotelAvailabilityRequest): Promise<SupplierResult<NormalizedHotelOffer[]>> {
    const parsed = hotelAvailabilityRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { supplierPropertyId, checkIn, checkOut, occupancy, currency, correlationId } = parsed.data;
    const hotelCode = Number.parseInt(supplierPropertyId, 10);
    if (!Number.isFinite(hotelCode)) return { ok: false, error: normalizeSupplierError('VALIDATION') };

    return this.audited('AVAILABILITY', correlationId, async () => {
      const wireRequest: HotelbedsWireSearchRequest = {
        stay: { checkIn, checkOut },
        occupancies: [{ rooms: occupancy.rooms, adults: occupancy.adults, children: occupancy.children }],
        hotels: { hotel: [hotelCode] }
      };
      const outcome = await this.post(SEARCH_PATH, wireRequest);
      if (!outcome.ok) return { ok: false, error: normalizeSupplierError(mapHttpFailureToErrorKind(outcome.status)) };

      const body = hotelbedsSearchResponseSchema.safeParse(outcome.body);
      if (!body.success) return { ok: false, error: normalizeSupplierError('TERMINAL_FAILURE') };
      if (body.data.hotels.hotels.length === 0) return { ok: false, error: normalizeSupplierError('UNAVAILABLE') };

      const offers = body.data.hotels.hotels.flatMap((hotel) =>
        this.offersFromHotel(hotel, supplierPropertyId, occupancy, currency)
      );
      return { ok: true, value: offers };
    });
  }

  async revalidate(request: OfferRevalidationRequest): Promise<SupplierResult<NormalizedHotelOffer>> {
    const parsed = offerRevalidationRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { supplierOfferReference, correlationId } = parsed.data;

    return this.audited('REVALIDATION', correlationId, async () => {
      const outcome = await this.post(CHECKRATE_PATH, { rooms: [{ rateKey: supplierOfferReference }] });
      if (!outcome.ok) return { ok: false, error: normalizeSupplierError(mapHttpFailureToErrorKind(outcome.status)) };

      const body = hotelbedsCheckRateResponseSchema.safeParse(outcome.body);
      if (!body.success) return { ok: false, error: normalizeSupplierError('TERMINAL_FAILURE') };

      const hotel = body.data.hotel;
      const room = hotel.rooms[0];
      const rate = room?.rates[0];
      if (!room || !rate) return { ok: false, error: normalizeSupplierError('UNAVAILABLE') };

      // Hotelbeds' rateKey is a stateful opaque token that encodes the quoted
      // conditions; the supplier reissuing a DIFFERENT key for the same
      // check-rate call is the supplier's own signal that price/terms
      // changed. There is no "expected price" available to this adapter to
      // compare against directly — the interface (shared with every other
      // adapter) intentionally does not carry one; that comparison against a
      // previously-stored quote version happens one layer up, in
      // orchestrator.ts's revalidateQuote(). This check catches the case
      // where the supplier itself flags a reissue.
      if (rate.rateKey !== supplierOfferReference) {
        return { ok: false, error: normalizeSupplierError('PRICE_CHANGED') };
      }

      const offer = finaliseOffer(mapRateToOfferBody({
        mode: this.mode,
        supplierId: this.supplierId,
        supplierPropertyId: String(hotel.code),
        propertyName: hotel.name,
        destination: hotel.destinationName ?? hotel.name,
        roomCode: room.code,
        roomName: room.name,
        rate,
        occupancy: { adults: 1, children: 0, rooms: 1 }, // Hotelbeds' checkrate response does not echo occupancy.
        currency: 'AZN',
        createdAt: this.clock(),
        offerTtlMs: this.offerTtlMs,
        supplierTraceId: `hb-${hotel.code}-${room.code}`
      }));
      return { ok: true, value: offer };
    });
  }

  async prepareBooking(request: BookingPreparationRequest): Promise<SupplierResult<BookingPreparationPayload>> {
    const parsed = bookingPreparationRequestSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: normalizeSupplierError('VALIDATION') };
    const { supplierOfferReference, correlationId } = parsed.data;

    return this.audited('BOOKING_PREPARATION', correlationId, async () => {
      // Preparation revalidates the offer one final time immediately before
      // human review — it NEVER calls Hotelbeds' booking-confirmation
      // endpoint. There is no code anywhere in this adapter that constructs
      // a request to `/hotel-api/1.0/bookings`.
      const outcome = await this.post(CHECKRATE_PATH, { rooms: [{ rateKey: supplierOfferReference }] });
      if (!outcome.ok) return { ok: false, error: normalizeSupplierError(mapHttpFailureToErrorKind(outcome.status)) };

      const body = hotelbedsCheckRateResponseSchema.safeParse(outcome.body);
      if (!body.success) return { ok: false, error: normalizeSupplierError('TERMINAL_FAILURE') };

      const rate = body.data.hotel.rooms[0]?.rates[0];
      if (!rate) return { ok: false, error: normalizeSupplierError('UNAVAILABLE') };
      if (rate.rateKey !== supplierOfferReference) return { ok: false, error: normalizeSupplierError('PRICE_CHANGED') };

      const offer = finaliseOffer(mapRateToOfferBody({
        mode: this.mode,
        supplierId: this.supplierId,
        supplierPropertyId: String(body.data.hotel.code),
        propertyName: body.data.hotel.name,
        destination: body.data.hotel.destinationName ?? body.data.hotel.name,
        roomCode: body.data.hotel.rooms[0].code,
        roomName: body.data.hotel.rooms[0].name,
        rate,
        occupancy: { adults: 1, children: 0, rooms: 1 },
        currency: 'AZN',
        createdAt: this.clock(),
        offerTtlMs: this.offerTtlMs,
        supplierTraceId: `hb-${body.data.hotel.code}`
      }));

      const payload: BookingPreparationPayload = {
        supplierId: this.supplierId,
        supplierOfferReference,
        offerContentHash: offer.contentHash,
        commercialSource: commercialSourceForMode(this.mode),
        simulated: false,
        preparedAt: this.clock().toISOString(),
        correlationId,
        requiresHumanApproval: true
      };
      return { ok: true, value: payload };
    });
  }

  async health(): Promise<SupplierHealth> {
    // A real health probe would call a lightweight Hotelbeds status/ping
    // endpoint; without live credentials or network access this cannot be
    // exercised, so health reports unhealthy rather than fabricating success
    // — consistent with "never fabricate a successful live connection".
    const outcome = await this.post(SEARCH_PATH, {
      stay: { checkIn: '2099-01-01', checkOut: '2099-01-02' },
      occupancies: [{ rooms: 1, adults: 1, children: 0 }],
      hotels: { hotel: [1] }
    }).catch(() => ({ ok: false as const, status: 500 as const, body: null }));
    return {
      supplierId: this.supplierId,
      mode: this.mode,
      simulated: false,
      healthy: outcome.ok,
      checkedAt: this.clock().toISOString()
    };
  }
}
