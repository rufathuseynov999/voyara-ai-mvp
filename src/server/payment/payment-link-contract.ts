import { z } from 'zod';

/**
 * Phase 4B — payment-link contract.
 *
 * Every field the founder locked is its own required field here, not folded
 * into a blob: customer, originating brand/account, proposal version,
 * supplier-contract reference, service description, transaction type,
 * amount/currency, merchant authority, expiry, payment purpose, approver,
 * content hash. `requiresHumanApproval` on the draft is the literal `true`
 * type, matching every other HAG boundary in this project — no code path can
 * construct a payment-link draft that skips human review.
 *
 * `merchantAuthority` is never hardcoded to a literal brand string in this
 * file — it is supplied by the caller (ultimately sourced from configured
 * integration settings), so R-Travel's status as legal merchant authority
 * stays a configuration fact, not something wired into application logic
 * that would need a code change to correct.
 */

export const paymentLinkTransactionTypes = [
  'SUBSCRIPTION', 'HOTEL', 'TOUR_PACKAGE', 'AIR_TICKET', 'TRANSFER',
  'INSURANCE', 'VISA', 'CONCIERGE', 'BALANCE_PAYMENT'
] as const;
export type PaymentLinkTransactionType = (typeof paymentLinkTransactionTypes)[number];

export const paymentLinkStatuses = [
  'DRAFTED', 'APPROVED', 'LINK_CREATED', 'SENT', 'EXPIRED', 'CANCELLED', 'INVALIDATED', 'VERIFIED', 'MISMATCHED'
] as const;
export type PaymentLinkStatus = (typeof paymentLinkStatuses)[number];

export const customerFacingBrands = ['RTRAVEL', 'VOYARA'] as const;
export type CustomerFacingBrand = (typeof customerFacingBrands)[number];

export const draftPaymentLinkRequestSchema = z.object({
  contactId: z.uuid(),
  originatingConversationId: z.uuid(),
  originatingBrand: z.enum(customerFacingBrands),
  proposalVersionId: z.uuid().nullable(),
  supplierContractReference: z.string().trim().max(200).nullable(),
  serviceDescription: z.string().trim().min(1).max(1_000),
  transactionType: z.enum(paymentLinkTransactionTypes),
  amountMinor: z.number().int().positive(),
  currency: z.enum(['AZN', 'USD', 'EUR', 'TRY', 'AED']),
  merchantAuthority: z.string().trim().min(1).max(200),
  expiresAt: z.iso.datetime(),
  paymentPurpose: z.string().trim().min(1).max(500),
  correlationId: z.string().min(1).max(128),
  requiresHumanApproval: z.literal(true)
}).strict();
export type DraftPaymentLinkRequest = z.infer<typeof draftPaymentLinkRequestSchema>;

export const paymentLinkRequestSchema = z.object({
  paymentLinkId: z.uuid(),
  orderReference: z.string().min(1).max(64),
  correlationId: z.string().min(1).max(128),
  contactId: z.uuid(),
  originatingConversationId: z.uuid(),
  originatingBrand: z.enum(customerFacingBrands),
  proposalVersionId: z.uuid().nullable(),
  supplierContractReference: z.string().nullable(),
  serviceDescription: z.string(),
  transactionType: z.enum(paymentLinkTransactionTypes),
  amountMinor: z.number().int().positive(),
  currency: z.enum(['AZN', 'USD', 'EUR', 'TRY', 'AED']),
  merchantAuthority: z.string(),
  expiresAt: z.iso.datetime(),
  paymentPurpose: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(paymentLinkStatuses),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  hostedUrl: z.url().nullable(),
  createdAt: z.iso.datetime()
}).strict().refine(
  (link) => !['LINK_CREATED', 'SENT'].includes(link.status) || (link.approvedBy !== null && link.approvedAt !== null),
  { message: 'a link cannot be created or sent without a human approver' }
);
export type PaymentLinkRequest = z.infer<typeof paymentLinkRequestSchema>;

/** Provider-neutral hosted-checkout webhook payload for payment links. Same
 *  honesty posture as the Phase 3C Part 3 generic hosted-checkout adapter:
 *  this is VOYARA's own reference shape, not any named provider's real API. */
export const paymentLinkWebhookPayloadSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  orderReference: z.string(),
  status: z.enum(['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED']),
  amountMinor: z.number().int(),
  currency: z.string(),
  providerTransactionReference: z.string().nullable()
}).strict();
export type PaymentLinkWebhookPayload = z.infer<typeof paymentLinkWebhookPayloadSchema>;

export class PaymentLinkAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'NOT_FOUND' | 'ALREADY_APPROVED' | 'STALE_CONTENT_HASH' | 'NOT_APPROVED' | 'EXPIRED' | 'ALREADY_TERMINAL'
  ) {
    super(message);
    this.name = 'PaymentLinkAuthorityError';
  }
}
