import { z } from 'zod';
import { sha256 } from '@/server/bos/canonical-json';
import {
  boardBases,
  cancellationPolicyKinds,
  commercialSources,
  integrationModes,
  type CommercialSource,
  type IntegrationMode,
  type NormalizedSupplierError,
  type SupplierOperation
} from './contract';

/**
 * Phase 3A Part 2 — provider-neutral supplier adapter interface and the
 * normalized hotel-offer contract.
 *
 * Still no payments, no booking execution, and no bypass of the Human Approval
 * Gate: booking preparation produces a payload for human review only. No
 * markup, commission or pricing formula is invented here — the adapter reports
 * supplier net, taxes and mandatory fees; a customer total is carried only when
 * an offer already presents one under existing commercial rules.
 */

/* --------------------------- Request contracts --------------------------- */

const currencySchema = z.enum(['AZN', 'USD', 'EUR', 'TRY', 'AED']);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const correlationIdSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

const occupancyRequestSchema = z.object({
  adults: z.number().int().min(1).max(16),
  children: z.number().int().min(0).max(16),
  rooms: z.number().int().min(1).max(16)
}).strict();

/** Base fields common to search/availability/revalidation requests. */
const stayRequestBase = {
  checkIn: isoDateSchema,
  checkOut: isoDateSchema,
  occupancy: occupancyRequestSchema,
  currency: currencySchema,
  /** Required by some suppliers for correct pricing/eligibility. */
  nationality: z.string().trim().length(2).regex(/^[A-Z]{2}$/).optional(),
  residency: z.string().trim().length(2).regex(/^[A-Z]{2}$/).optional(),
  correlationId: correlationIdSchema
};

const datesAfterCheck = (value: { checkIn: string; checkOut: string }) =>
  Date.parse(value.checkOut) > Date.parse(value.checkIn);

export const hotelSearchRequestSchema = z.object({
  destination: z.string().trim().min(2).max(120),
  ...stayRequestBase
}).strict().refine(datesAfterCheck, { message: 'checkOut must be after checkIn' });
export type HotelSearchRequest = z.infer<typeof hotelSearchRequestSchema>;

export const hotelAvailabilityRequestSchema = z.object({
  supplierPropertyId: z.string().trim().min(1).max(128),
  ...stayRequestBase
}).strict().refine(datesAfterCheck, { message: 'checkOut must be after checkIn' });
export type HotelAvailabilityRequest = z.infer<typeof hotelAvailabilityRequestSchema>;

export const offerRevalidationRequestSchema = z.object({
  supplierOfferReference: z.string().trim().min(1).max(128),
  correlationId: correlationIdSchema
}).strict();
export type OfferRevalidationRequest = z.infer<typeof offerRevalidationRequestSchema>;

export const bookingPreparationRequestSchema = z.object({
  supplierOfferReference: z.string().trim().min(1).max(128),
  correlationId: correlationIdSchema
}).strict();
export type BookingPreparationRequest = z.infer<typeof bookingPreparationRequestSchema>;

/* ----------------------- Normalized hotel-offer contract ----------------- */

const minorAmountSchema = z.number().int().min(0).max(10_000_000_000);
const isoDateTimeSchema = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && value.includes('T');
}, 'expected an ISO-8601 datetime');

const offerCancellationPolicySchema = z.object({
  kind: z.enum(cancellationPolicyKinds),
  freeUntil: isoDateSchema.optional(),
  penaltyMinor: minorAmountSchema.optional()
}).strict();

const offerOccupancySchema = occupancyRequestSchema;

/** The normalized hotel offer. `contentHash` is excluded from the hashed body
 *  and computed over the remaining canonical fields, so it is stable and
 *  self-verifying. `customerTotalMinor` is nullable and only set when the
 *  supplier already presents an authorized customer-facing total. */
export const normalizedHotelOfferBodySchema = z.object({
  supplierId: z.string().trim().min(1).max(64),
  supplierPropertyId: z.string().trim().min(1).max(128),
  internalPropertyId: z.string().uuid().nullable(),
  propertyName: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(120),
  roomType: z.string().trim().min(1).max(120),
  boardBasis: z.enum(boardBases),
  occupancy: offerOccupancySchema,
  cancellationPolicy: offerCancellationPolicySchema,
  supplierNetMinor: minorAmountSchema,
  taxesMinor: minorAmountSchema,
  mandatoryFeesMinor: minorAmountSchema,
  currency: currencySchema,
  customerTotalMinor: minorAmountSchema.nullable(),
  supplierOfferReference: z.string().trim().min(1).max(128),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  supplierTraceId: z.string().trim().min(1).max(128),
  commercialSource: z.enum(commercialSources),
  simulated: z.boolean()
}).strict().refine(
  (offer) => Date.parse(offer.expiresAt) > Date.parse(offer.createdAt),
  { message: 'expiresAt must be after createdAt' }
).refine(
  // Simulated offers must be labelled as such and never claim a LIVE source.
  (offer) => (offer.simulated ? offer.commercialSource !== 'LIVE' : true),
  { message: 'a simulated offer cannot carry a LIVE commercial source' }
);
export type NormalizedHotelOfferBody = z.infer<typeof normalizedHotelOfferBodySchema>;

export const normalizedHotelOfferSchema = normalizedHotelOfferBodySchema.and(
  z.object({ contentHash: z.string().regex(/^[0-9a-f]{64}$/) })
);
export type NormalizedHotelOffer = NormalizedHotelOfferBody & { contentHash: string };

/** Deterministically finalise an offer body by attaching its content hash.
 *  The hash is computed over the validated canonical body (excluding the hash
 *  itself), so identical bodies always yield the same hash. */
export function finaliseOffer(body: NormalizedHotelOfferBody): NormalizedHotelOffer {
  const validated = normalizedHotelOfferBodySchema.parse(body);
  return { ...validated, contentHash: sha256(validated) };
}

export function verifyOfferHash(offer: NormalizedHotelOffer): boolean {
  const { contentHash, ...body } = offer;
  return sha256(normalizedHotelOfferBodySchema.parse(body)) === contentHash;
}

/* ------------------------- Booking-preparation payload -------------------- */

/** A prepared, human-reviewable booking payload. Preparation never executes a
 *  booking; execution remains under the existing booking authority + HAG. */
export const bookingPreparationPayloadSchema = z.object({
  supplierId: z.string().trim().min(1).max(64),
  supplierOfferReference: z.string().trim().min(1).max(128),
  offerContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  commercialSource: z.enum(commercialSources),
  simulated: z.boolean(),
  preparedAt: isoDateTimeSchema,
  correlationId: correlationIdSchema,
  requiresHumanApproval: z.literal(true)
}).strict();
export type BookingPreparationPayload = z.infer<typeof bookingPreparationPayloadSchema>;

/* ----------------------------- Adapter results --------------------------- */

export type SupplierResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NormalizedSupplierError };

export type SupplierHealth = {
  supplierId: string;
  mode: IntegrationMode;
  simulated: boolean;
  healthy: boolean;
  checkedAt: string;
};

/* --------------------------- Adapter interface --------------------------- */

export interface SupplierAdapter {
  readonly supplierId: string;
  readonly mode: IntegrationMode;
  readonly simulated: boolean;
  supports(operation: SupplierOperation): boolean;
  search(request: HotelSearchRequest): Promise<SupplierResult<NormalizedHotelOffer[]>>;
  availability(request: HotelAvailabilityRequest): Promise<SupplierResult<NormalizedHotelOffer[]>>;
  revalidate(request: OfferRevalidationRequest): Promise<SupplierResult<NormalizedHotelOffer>>;
  prepareBooking(request: BookingPreparationRequest): Promise<SupplierResult<BookingPreparationPayload>>;
  health(): Promise<SupplierHealth>;
}

export function commercialSourceLabel(source: CommercialSource): string {
  return source === 'LIVE' ? 'Live' : source === 'SANDBOX' ? 'Sandbox' : source === 'MANUAL' ? 'Manual' : 'Simulated';
}

export { integrationModes };
