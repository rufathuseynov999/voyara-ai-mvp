import { z } from 'zod';

/**
 * Phase 3A — shared supplier & commercial integration foundation.
 *
 * This module defines ONLY repository-consistent types, schemas and helpers.
 * It contains no supplier adapters, no network calls, and no capability to
 * confirm price, availability, booking or payment. Every value produced here
 * remains subject to the existing Human Approval Gate, content-hash approval,
 * RLS and payment/booking authority — nothing in Phase 3A bypasses them.
 *
 * Conventions mirror the existing contracts (commercial/payment/booking):
 * `as const` string-literal enums with a derived `type`, Zod `.strict()`
 * schemas, sha256 as a 64-char lowercase hex string, and money as validated
 * minor-unit integers.
 */

/* ------------------------------------------------------------------ *
 * Integration modes — supplier & payment. Simulation is the safe
 * default; live is gated and defaults to disabled elsewhere (env).
 * ------------------------------------------------------------------ */

export const integrationModes = ['SIMULATION', 'SANDBOX', 'LIVE'] as const;
export type IntegrationMode = (typeof integrationModes)[number];

export const supplierModes = integrationModes;
export type SupplierMode = IntegrationMode;

export const paymentModes = integrationModes;
export type PaymentMode = IntegrationMode;

/** A mode is "non-authoritative" unless it is LIVE; SIMULATION/SANDBOX output
 *  must always be labelled and may never be treated as a real confirmation. */
export function isAuthoritativeMode(mode: IntegrationMode): boolean {
  return mode === 'LIVE';
}

export function isSimulationMode(mode: IntegrationMode): boolean {
  return mode === 'SIMULATION';
}

/* ------------------------------------------------------------------ *
 * Commercial source — provenance of a commercial offer/figure.
 * ------------------------------------------------------------------ */

export const commercialSources = ['SIMULATED', 'SANDBOX', 'LIVE', 'MANUAL'] as const;
export type CommercialSource = (typeof commercialSources)[number];

/** Map an integration mode to the commercial source it produces. MANUAL is
 *  never produced by an adapter — it denotes a human-entered figure. */
export function commercialSourceForMode(mode: IntegrationMode): Exclude<CommercialSource, 'MANUAL'> {
  return mode === 'LIVE' ? 'LIVE' : mode === 'SANDBOX' ? 'SANDBOX' : 'SIMULATED';
}

/** Only a LIVE source is authoritative; simulated/sandbox/manual figures must
 *  still pass through human approval before reaching a customer. */
export function isAuthoritativeSource(source: CommercialSource): boolean {
  return source === 'LIVE';
}

/* ------------------------------------------------------------------ *
 * Supplier operations — the read/prepare steps an adapter may expose.
 * None of these confirm a booking; booking preparation stops short of
 * execution, which remains under the existing booking authority.
 * ------------------------------------------------------------------ */

export const supplierOperations = [
  'SEARCH',
  'AVAILABILITY',
  'REVALIDATION',
  'BOOKING_PREPARATION'
] as const;
export type SupplierOperation = (typeof supplierOperations)[number];

/* ------------------------------------------------------------------ *
 * Supplier errors — normalized taxonomy. Adapters map provider-native
 * failures onto exactly one of these so downstream handling is uniform.
 * ------------------------------------------------------------------ */

export const supplierErrorKinds = [
  'VALIDATION',
  'TIMEOUT',
  'RATE_LIMIT',
  'UNAVAILABLE',
  'PRICE_CHANGED',
  'TERMINAL_FAILURE'
] as const;
export type SupplierErrorKind = (typeof supplierErrorKinds)[number];

/** Retryability is a property of the normalized kind, not the provider. */
const retryableErrorKinds: ReadonlySet<SupplierErrorKind> = new Set([
  'TIMEOUT',
  'RATE_LIMIT',
  'UNAVAILABLE'
]);

export function isRetryableSupplierError(kind: SupplierErrorKind): boolean {
  return retryableErrorKinds.has(kind);
}

export type NormalizedSupplierError = {
  kind: SupplierErrorKind;
  retryable: boolean;
  /** Stable, non-sensitive code for logs/audit. Never carries secrets. */
  code: string;
};

/** Normalize any thrown/returned adapter failure into the shared taxonomy.
 *  Unknown inputs fail closed to TERMINAL_FAILURE (never retryable). The
 *  returned code is derived only from the kind, so no provider payload,
 *  credential or URL can leak through this path. */
export function normalizeSupplierError(kind: unknown): NormalizedSupplierError {
  const parsed = z.enum(supplierErrorKinds).safeParse(kind);
  const resolved: SupplierErrorKind = parsed.success ? parsed.data : 'TERMINAL_FAILURE';
  return {
    kind: resolved,
    retryable: isRetryableSupplierError(resolved),
    code: `SUPPLIER_${resolved}`
  };
}

/* ------------------------------------------------------------------ *
 * Material commercial fields — the offer terms whose change is
 * "material" and therefore requires re-approval. Money is minor units.
 * ------------------------------------------------------------------ */

const currencySchema = z.enum(['AZN', 'USD', 'EUR', 'TRY', 'AED']);
const minorAmountSchema = z.number().int().min(0).max(10_000_000_000);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const supplierOfferReferenceSchema = z.string().trim().min(1).max(128);
const offerExpirySchema = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && value.includes('T');
}, 'offer expiry must be an ISO-8601 datetime');

export const boardBases = [
  'ROOM_ONLY',
  'BED_AND_BREAKFAST',
  'HALF_BOARD',
  'FULL_BOARD',
  'ALL_INCLUSIVE'
] as const;
export type BoardBasis = (typeof boardBases)[number];

export const cancellationPolicyKinds = [
  'NON_REFUNDABLE',
  'FREE_UNTIL',
  'PARTIAL'
] as const;
export type CancellationPolicyKind = (typeof cancellationPolicyKinds)[number];

const cancellationPolicySchema = z.object({
  kind: z.enum(cancellationPolicyKinds),
  /** Present only for FREE_UNTIL; ISO date the free-cancellation window ends. */
  freeUntil: isoDateSchema.optional(),
  /** Present only for PARTIAL; penalty in minor units of `currency`. */
  penaltyMinor: minorAmountSchema.optional()
}).strict().refine(
  (policy) => (policy.kind === 'FREE_UNTIL' ? policy.freeUntil !== undefined : policy.freeUntil === undefined),
  { message: 'freeUntil is required only for FREE_UNTIL policies' }
).refine(
  (policy) => (policy.kind === 'PARTIAL' ? policy.penaltyMinor !== undefined : policy.penaltyMinor === undefined),
  { message: 'penaltyMinor is required only for PARTIAL policies' }
);
export type CancellationPolicy = z.infer<typeof cancellationPolicySchema>;

const occupancySchema = z.object({
  adults: z.number().int().min(1).max(16),
  children: z.number().int().min(0).max(16),
  rooms: z.number().int().min(1).max(16)
}).strict();
export type Occupancy = z.infer<typeof occupancySchema>;

export const materialCommercialFieldsSchema = z.object({
  supplierNetMinor: minorAmountSchema,
  taxesAndFeesMinor: minorAmountSchema,
  customerTotalMinor: minorAmountSchema,
  currency: currencySchema,
  roomType: z.string().trim().min(1).max(120),
  boardBasis: z.enum(boardBases),
  cancellationPolicy: cancellationPolicySchema,
  checkIn: isoDateSchema,
  checkOut: isoDateSchema,
  occupancy: occupancySchema,
  supplierOfferReference: supplierOfferReferenceSchema,
  offerExpiry: offerExpirySchema
}).strict().refine(
  (fields) => Date.parse(fields.checkOut) > Date.parse(fields.checkIn),
  { message: 'checkOut must be after checkIn' }
);

export type MaterialCommercialFields = z.infer<typeof materialCommercialFieldsSchema>;

/** The exact subset of fields whose change is "material" and therefore forces
 *  re-approval. Kept explicit so a future field addition is a deliberate
 *  decision rather than an accidental omission from comparison. */
export const materialCommercialFieldKeys = [
  'supplierNetMinor',
  'taxesAndFeesMinor',
  'customerTotalMinor',
  'currency',
  'roomType',
  'boardBasis',
  'cancellationPolicy',
  'checkIn',
  'checkOut',
  'occupancy',
  'supplierOfferReference',
  'offerExpiry'
] as const satisfies ReadonlyArray<keyof MaterialCommercialFields>;

/** Structural comparison of two offers over exactly the material fields.
 *  Returns the list of changed field keys (empty when materially identical).
 *  Uses canonical JSON so nested objects (policy, occupancy) compare by value.
 */
export function materialFieldDifferences(
  previous: MaterialCommercialFields,
  next: MaterialCommercialFields
): Array<keyof MaterialCommercialFields> {
  const changed: Array<keyof MaterialCommercialFields> = [];
  for (const key of materialCommercialFieldKeys) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }
  return changed;
}

export function isMateriallyEqual(
  previous: MaterialCommercialFields,
  next: MaterialCommercialFields
): boolean {
  return materialFieldDifferences(previous, next).length === 0;
}
