import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PlanStore } from './plan-store';
import { requireActivePlanAuthority, type PlanServiceContext } from './plan-service';

/**
 * Phase 4F — recurring payments. Reuses the existing hosted-checkout /
 * payment-link architecture's discipline (Phase 4B `payment-link-service.ts`,
 * Phase 4C's HMAC webhook pattern) rather than inventing a parallel one:
 * tokenized references only (never card data, never a CVV, never a raw
 * PAN), reserve-first idempotent webhook receipts, exact amount/currency/
 * plan-version matching before a renewal is ever reconciled.
 *
 * No live payment provider is implemented — this is VOYARA's own
 * fixture/reference contract, exactly the same honest posture already
 * established for every other webhook-verified integration in this
 * project.
 */

export const recurringPaymentTransactionTypes = [
  'INITIAL_PAYMENT', 'RENEWAL', 'UPGRADE', 'DOWNGRADE_ADJUSTMENT', 'FAILED_PAYMENT_RETRY',
  'CORPORATE_SUBSCRIPTION', 'AUTHORISED_BALANCE_PAYMENT'
] as const;
export type RecurringPaymentTransactionType = (typeof recurringPaymentTransactionTypes)[number];

const CARD_NUMBER_PATTERN = /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/;
const CVV_SHAPED_PATTERN = /cvv|cvc/i;

export const recurringPaymentTokenSchema = z.object({
  tokenId: z.uuid(),
  contactId: z.uuid().nullable(),
  corporateAccountId: z.uuid().nullable(),
  providerTokenReference: z.string().min(1).refine((v) => !CARD_NUMBER_PATTERN.test(v), 'token reference must not look like a raw card number')
    .refine((v) => !CVV_SHAPED_PATTERN.test(v), 'token reference must not reference a CVV'),
  maskedDisplay: z.string().nullable(),
  status: z.string(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict().refine((t) => (t.contactId !== null) !== (t.corporateAccountId !== null), 'a token belongs to exactly one of contactId/corporateAccountId');
export type RecurringPaymentToken = z.infer<typeof recurringPaymentTokenSchema>;

export type RenewalEvent = {
  eventId: string;
  externalEventId: string;
  subscriptionId: string | null;
  transactionType: RecurringPaymentTransactionType;
  amountMinorUnits: number | null;
  currency: string | null;
  planVersionId: string | null;
  accepted: boolean;
  reasonCode: string | null;
  correlationId: string;
};

export class RecurringPaymentError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'CARD_DATA_REJECTED' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH' | 'PLAN_MISMATCH' | 'DUPLICATE_EVENT' | 'NOT_FOUND'
  ) {
    super(message);
    this.name = 'RecurringPaymentError';
  }
}

export interface RecurringPaymentStore {
  saveToken(token: RecurringPaymentToken): Promise<void>;
  loadToken(tokenId: string): Promise<RecurringPaymentToken | null>;
  reserveWebhookEvent(externalEventId: string): Promise<{ winner: boolean }>;
  saveRenewalEvent(event: RenewalEvent): Promise<void>;
  cancelFutureRenewals(subscriptionId: string): Promise<void>;
  isFutureRenewalCancelled(subscriptionId: string): Promise<boolean>;
}

export class InMemoryRecurringPaymentStore implements RecurringPaymentStore {
  private readonly tokens = new Map<string, RecurringPaymentToken>();
  private readonly webhookEvents = new Set<string>();
  private readonly renewalEvents: RenewalEvent[] = [];
  private readonly cancelledFutureRenewals = new Set<string>();

  async saveToken(token: RecurringPaymentToken): Promise<void> { this.tokens.set(token.tokenId, token); }
  async loadToken(tokenId: string): Promise<RecurringPaymentToken | null> { return this.tokens.get(tokenId) ?? null; }
  async reserveWebhookEvent(externalEventId: string): Promise<{ winner: boolean }> {
    if (this.webhookEvents.has(externalEventId)) return { winner: false };
    this.webhookEvents.add(externalEventId);
    return { winner: true };
  }
  async saveRenewalEvent(event: RenewalEvent): Promise<void> { this.renewalEvents.push(event); }
  async cancelFutureRenewals(subscriptionId: string): Promise<void> { this.cancelledFutureRenewals.add(subscriptionId); }
  async isFutureRenewalCancelled(subscriptionId: string): Promise<boolean> { return this.cancelledFutureRenewals.has(subscriptionId); }

  eventsFor(subscriptionId: string): RenewalEvent[] {
    return this.renewalEvents.filter((e) => e.subscriptionId === subscriptionId);
  }
}

export type RecurringPaymentContext = { store: RecurringPaymentStore; planStore: PlanStore; correlationId: string; now: () => Date };

export async function registerPaymentToken(
  ctx: RecurringPaymentContext,
  input: Omit<RecurringPaymentToken, 'tokenId' | 'correlationId' | 'createdAt'>
): Promise<{ tokenId: string }> {
  if (CARD_NUMBER_PATTERN.test(input.providerTokenReference)) throw new RecurringPaymentError('Token reference must not contain a raw card number.', 'CARD_DATA_REJECTED');
  if (CVV_SHAPED_PATTERN.test(input.providerTokenReference)) throw new RecurringPaymentError('Token reference must not reference a CVV.', 'CARD_DATA_REJECTED');

  const tokenId = randomUUID();
  const token: RecurringPaymentToken = { ...input, tokenId, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() };
  const parsed = recurringPaymentTokenSchema.safeParse(token);
  if (!parsed.success) throw new RecurringPaymentError('Invalid payment token.', 'VALIDATION');

  await ctx.store.saveToken(token);
  return { tokenId };
}

export async function reconcileRenewalWebhook(
  ctx: RecurringPaymentContext,
  input: {
    externalEventId: string; subscriptionId: string; transactionType: RecurringPaymentTransactionType;
    amountMinorUnits: number; currency: string; planVersionId: string;
  }
): Promise<{ accepted: boolean; renewalEventId: string; reasonCode: string | null }> {
  const reservation = await ctx.store.reserveWebhookEvent(input.externalEventId);
  if (!reservation.winner) {
    throw new RecurringPaymentError(`Duplicate webhook event: ${input.externalEventId} was already processed.`, 'DUPLICATE_EVENT');
  }

  const planCtx: PlanServiceContext = { store: ctx.planStore, correlationId: ctx.correlationId, now: ctx.now };
  const plan = await requireActivePlanAuthority(planCtx, input.planVersionId);

  let accepted = true;
  let reasonCode: string | null = null;
  if (plan.currency !== input.currency) {
    accepted = false; reasonCode = 'CURRENCY_MISMATCH';
  } else if (plan.priceMinorUnits !== input.amountMinorUnits) {
    accepted = false; reasonCode = 'AMOUNT_MISMATCH';
  }

  const renewalEventId = randomUUID();
  await ctx.store.saveRenewalEvent({
    eventId: renewalEventId, externalEventId: input.externalEventId, subscriptionId: input.subscriptionId,
    transactionType: input.transactionType, amountMinorUnits: input.amountMinorUnits, currency: input.currency,
    planVersionId: input.planVersionId, accepted, reasonCode, correlationId: ctx.correlationId
  });

  if (!accepted) {
    const code = reasonCode === 'CURRENCY_MISMATCH' ? 'CURRENCY_MISMATCH' : 'AMOUNT_MISMATCH';
    throw new RecurringPaymentError(`Renewal webhook rejected: ${reasonCode}.`, code);
  }

  return { accepted, renewalEventId, reasonCode };
}

export async function recordFailedPaymentWebhook(
  ctx: RecurringPaymentContext,
  input: { externalEventId: string; subscriptionId: string; reasonCode: string }
): Promise<{ renewalEventId: string }> {
  const reservation = await ctx.store.reserveWebhookEvent(input.externalEventId);
  if (!reservation.winner) throw new RecurringPaymentError(`Duplicate webhook event: ${input.externalEventId} was already processed.`, 'DUPLICATE_EVENT');

  const renewalEventId = randomUUID();
  await ctx.store.saveRenewalEvent({
    eventId: renewalEventId, externalEventId: input.externalEventId, subscriptionId: input.subscriptionId,
    transactionType: 'FAILED_PAYMENT_RETRY', amountMinorUnits: null, currency: null, planVersionId: null,
    accepted: false, reasonCode: input.reasonCode, correlationId: ctx.correlationId
  });
  return { renewalEventId };
}

export async function cancelFutureRenewal(ctx: RecurringPaymentContext, subscriptionId: string): Promise<void> {
  await ctx.store.cancelFutureRenewals(subscriptionId);
}

export function signRenewalWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
export function verifyRenewalWebhookSignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = signRenewalWebhook(secret, timestamp, body);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
