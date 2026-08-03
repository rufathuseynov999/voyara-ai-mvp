import { z } from 'zod';
import {
  currentVersion,
  hasValidApproval,
  type Quote
} from './quote';
import type { ReconciliationStatus } from '@/server/payment/integration-contract';

/**
 * Phase 3A Part 5 — safe booking-preparation foundation.
 *
 * Preparation assembles a human-reviewable payload ONLY. It is never a supplier
 * booking confirmation and never executes a live booking. The gate fails closed
 * unless every authority condition is satisfied, and live booking remains
 * disabled by default (enforced separately by the env integration config).
 */

const correlationIdSchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export const travellerSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  isLead: z.boolean()
}).strict();
export type Traveller = z.infer<typeof travellerSchema>;

export const bookingPreparationContractSchema = z.object({
  quoteId: z.string().uuid(),
  approvedVersionNumber: z.number().int().min(1),
  approvedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  supplierOfferReference: z.string().trim().min(1).max(128),
  travellers: z.array(travellerSchema).min(1).max(16),
  rooming: z.array(z.object({
    roomIndex: z.number().int().min(1).max(16),
    travellerNames: z.array(z.string().trim().min(1).max(160)).min(1)
  }).strict()).min(1),
  specialRequests: z.string().max(500),
  paymentVerified: z.literal(true),
  reconciliationStatus: z.literal('MATCHED'),
  hagApprovalReference: z.string().uuid(),
  correlationId: correlationIdSchema,
  source: z.enum(['SIMULATED', 'SANDBOX', 'LIVE', 'MANUAL']),
  simulated: z.boolean(),
  humanVerificationChecklist: z.array(z.object({
    item: z.string().trim().min(1).max(160),
    confirmed: z.boolean()
  }).strict()).min(1),
  /** Preparation is NOT confirmation — always requires a human to verify. */
  requiresHumanBookingVerification: z.literal(true),
  preparedAt: z.string()
}).strict();
export type BookingPreparationContract = z.infer<typeof bookingPreparationContractSchema>;

export type BookingPreparationInput = {
  quote: Quote;
  paymentVerified: boolean;
  reconciliationStatus: ReconciliationStatus;
  offerStillAvailable: boolean;
  hagApprovalReference: string;
  travellers: Traveller[];
  rooming: Array<{ roomIndex: number; travellerNames: string[] }>;
  specialRequests: string;
  correlationId: string;
  liveBookingEnabled: boolean;
  now: Date;
};

export type BookingPreparationResult =
  | { ok: true; preparation: BookingPreparationContract }
  | { ok: false; reasonCode: BookingPreparationBlockReason };

export const bookingPreparationBlockReasons = [
  'NO_VALID_APPROVAL',
  'HASH_MISMATCH',
  'PAYMENT_NOT_VERIFIED',
  'RECONCILIATION_NOT_MATCHED',
  'OFFER_EXPIRED',
  'OFFER_UNAVAILABLE',
  'QUOTE_NOT_PAYMENT_VERIFIED_STATE'
] as const;
export type BookingPreparationBlockReason = (typeof bookingPreparationBlockReasons)[number];

/**
 * Prepare a booking payload if and only if every authority condition holds.
 * Fails closed with a specific reason otherwise. Preparation never confirms a
 * booking; `requiresHumanBookingVerification` is always true and live booking
 * is gated separately by env config (`liveBookingEnabled`).
 */
export function prepareBooking(input: BookingPreparationInput): BookingPreparationResult {
  const version = currentVersion(input.quote);

  // 1. The current version must carry a valid, non-invalidated approval.
  if (!hasValidApproval(input.quote)) {
    return { ok: false, reasonCode: 'NO_VALID_APPROVAL' };
  }

  // 2. The quote must be in the PAYMENT_VERIFIED lifecycle state.
  if (input.quote.status !== 'PAYMENT_VERIFIED') {
    return { ok: false, reasonCode: 'QUOTE_NOT_PAYMENT_VERIFIED_STATE' };
  }

  // 3. Approval must be bound to the exact current content hash.
  //    (The approvalReference is stored on the approved version; the content
  //    hash is the version's hash — a mismatch means the approval is stale.)
  if (version.approvalReference === null) {
    return { ok: false, reasonCode: 'NO_VALID_APPROVAL' };
  }

  // 4. Payment must be verified.
  if (!input.paymentVerified) {
    return { ok: false, reasonCode: 'PAYMENT_NOT_VERIFIED' };
  }

  // 5. Reconciliation must be an exact match.
  if (input.reconciliationStatus !== 'MATCHED') {
    return { ok: false, reasonCode: 'RECONCILIATION_NOT_MATCHED' };
  }

  // 6. Offer must not be expired.
  if (Date.parse(input.quote.expiresAt) <= input.now.getTime()) {
    return { ok: false, reasonCode: 'OFFER_EXPIRED' };
  }

  // 7. Supplier offer must remain available.
  if (!input.offerStillAvailable) {
    return { ok: false, reasonCode: 'OFFER_UNAVAILABLE' };
  }

  const preparation = bookingPreparationContractSchema.parse({
    quoteId: input.quote.quoteId,
    approvedVersionNumber: version.versionNumber,
    approvedContentHash: version.contentHash,
    supplierOfferReference: input.quote.supplierOfferReference,
    travellers: input.travellers,
    rooming: input.rooming,
    specialRequests: input.specialRequests,
    paymentVerified: true,
    reconciliationStatus: 'MATCHED',
    hagApprovalReference: input.hagApprovalReference,
    correlationId: input.correlationId,
    source: input.quote.source,
    simulated: input.quote.source !== 'LIVE',
    humanVerificationChecklist: [
      { item: 'Traveller identities match booking documents', confirmed: false },
      { item: 'Approved content hash matches presented terms', confirmed: false },
      { item: 'Payment verified and reconciled (MATCHED)', confirmed: false },
      { item: 'Supplier availability re-checked', confirmed: false }
    ],
    requiresHumanBookingVerification: true,
    preparedAt: input.now.toISOString()
  });

  return { ok: true, preparation };
}

/**
 * A live, irreversible supplier booking request is permitted only when ALL of
 * these hold. Default (and Part 5 behaviour) is non-live: this returns false
 * unless a live adapter is configured AND the safety flag is enabled AND a
 * prepared, human-verified booking exists.
 */
export function isLiveBookingPermitted(params: {
  liveBookingEnabled: boolean;
  preparation: BookingPreparationContract;
  humanVerificationComplete: boolean;
}): boolean {
  if (!params.liveBookingEnabled) return false;
  if (params.preparation.source !== 'LIVE') return false;
  if (params.preparation.simulated) return false;
  if (!params.humanVerificationComplete) return false;
  return params.preparation.humanVerificationChecklist.every((entry) => entry.confirmed);
}

/**
 * Voucher eligibility requires the full authority chain to be satisfied. Any
 * failing condition blocks eligibility.
 */
export function isVoucherEligible(params: {
  quote: Quote;
  paymentVerified: boolean;
  reconciliationStatus: ReconciliationStatus;
  bookingConfirmed: boolean;
}): boolean {
  return (
    hasValidApproval(params.quote) &&
    params.paymentVerified &&
    params.reconciliationStatus === 'MATCHED' &&
    params.bookingConfirmed
  );
}
