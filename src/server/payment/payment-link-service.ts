import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import { reportError } from '@/server/observability/error-reporter';
import { processWebhook } from './reconciliation';
import { reconcilePaymentLink } from './payment-link-reconciliation';
import type { PaymentLinkStore } from './payment-link-store';
import type { ConversationStore } from '@/server/agents/conversation-store';
import { SimulationPaymentLinkAdapter } from './simulation-payment-link-adapter';
import {
  draftPaymentLinkRequestSchema,
  PaymentLinkAuthorityError,
  type DraftPaymentLinkRequest,
  type PaymentLinkRequest
} from './payment-link-contract';
import type { InboundWebhook } from './integration-contract';

/**
 * Phase 4B — payment-link service. Enforces the founder's exact required
 * sequence:
 *
 *   AI drafts payment request
 *   → exact human approval (by content hash)
 *   → provider creates hosted checkout
 *   → approved link is sent only into the originating conversation
 *   → signed webhook is verified
 *   → payment is reconciled
 *   → CRM/proposal/audit/operational status updated
 *
 * `sendApprovedLink` reuses the Phase 4A `ConversationStore.saveMessage`
 * directly — the payment link's own approval is the single human-approval
 * event for this whole request; delivering the resulting URL into the
 * conversation is recorded as a STAFF-authored, already-approved message
 * (attributed to the same human who approved the link), not a second
 * independent AI draft requiring its own separate review. This satisfies
 * "sent only into the originating conversation" using the exact
 * infrastructure already built and tested in Phase 4A rather than a new
 * delivery path.
 */

export type PaymentLinkContext = {
  store: PaymentLinkStore;
  conversationStore: ConversationStore;
  adapter: SimulationPaymentLinkAdapter;
  actor: { id: string; kind: 'human' | 'agent' | 'system'; assuranceLevel?: 'aal1' | 'aal2' };
  correlationId: string;
  now: () => Date;
};

function orderReference(now: Date): string {
  return `VOY-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function audit(ctx: PaymentLinkContext, paymentLinkId: string, kind: string, reasonCode?: string, contentHash?: string): Promise<void> {
  await ctx.store.recordLinkEvent({
    eventId: randomUUID(), paymentLinkId, kind,
    actorId: ctx.actor.id, actorKind: ctx.actor.kind, correlationId: ctx.correlationId,
    reasonCode: reasonCode ?? null, contentHash: contentHash ?? null
  });
}

export async function draftPaymentLink(ctx: PaymentLinkContext, input: DraftPaymentLinkRequest): Promise<{ paymentLinkId: string }> {
  const parsed = draftPaymentLinkRequestSchema.safeParse(input);
  if (!parsed.success) throw new PaymentLinkAuthorityError('Invalid payment-link draft.', 'VALIDATION');
  if (Date.parse(parsed.data.expiresAt) <= ctx.now().getTime()) {
    throw new PaymentLinkAuthorityError('expiresAt must be in the future.', 'VALIDATION');
  }

  const paymentLinkId = randomUUID();
  const createdAt = ctx.now().toISOString();
  const contentHash = sha256({
    contactId: parsed.data.contactId,
    transactionType: parsed.data.transactionType,
    amountMinor: parsed.data.amountMinor,
    currency: parsed.data.currency,
    serviceDescription: parsed.data.serviceDescription,
    merchantAuthority: parsed.data.merchantAuthority
  });

  const link: PaymentLinkRequest = {
    paymentLinkId,
    orderReference: orderReference(ctx.now()),
    correlationId: parsed.data.correlationId,
    contactId: parsed.data.contactId,
    originatingConversationId: parsed.data.originatingConversationId,
    originatingBrand: parsed.data.originatingBrand,
    proposalVersionId: parsed.data.proposalVersionId,
    supplierContractReference: parsed.data.supplierContractReference,
    serviceDescription: parsed.data.serviceDescription,
    transactionType: parsed.data.transactionType,
    amountMinor: parsed.data.amountMinor,
    currency: parsed.data.currency,
    merchantAuthority: parsed.data.merchantAuthority,
    expiresAt: parsed.data.expiresAt,
    paymentPurpose: parsed.data.paymentPurpose,
    contentHash,
    status: 'DRAFTED',
    approvedBy: null,
    approvedAt: null,
    hostedUrl: null,
    createdAt
  };
  await ctx.store.saveLink(link);
  await audit(ctx, paymentLinkId, 'PAYMENT_LINK_DRAFTED', undefined, contentHash);
  return { paymentLinkId };
}

export async function approvePaymentLink(ctx: PaymentLinkContext, paymentLinkId: string, expectedContentHash: string): Promise<void> {
  if (ctx.actor.kind !== 'human') throw new PaymentLinkAuthorityError('Only a human actor may approve a payment link.', 'VALIDATION');
  if (ctx.actor.assuranceLevel !== 'aal2') throw new PaymentLinkAuthorityError('Payment-link approval requires an AAL2 actor.', 'VALIDATION');

  const link = await ctx.store.loadLink(paymentLinkId);
  if (!link) throw new PaymentLinkAuthorityError('Payment link not found.', 'NOT_FOUND');
  if (link.status !== 'DRAFTED') throw new PaymentLinkAuthorityError(`Link is not DRAFTED (currently ${link.status}).`, 'ALREADY_APPROVED');
  if (link.contentHash !== expectedContentHash) throw new PaymentLinkAuthorityError('Stale content hash — the draft changed since it was reviewed.', 'STALE_CONTENT_HASH');
  if (Date.parse(link.expiresAt) <= ctx.now().getTime()) throw new PaymentLinkAuthorityError('This payment link has already expired.', 'EXPIRED');

  await ctx.store.saveLink({ ...link, status: 'APPROVED', approvedBy: ctx.actor.id, approvedAt: ctx.now().toISOString() });
  await audit(ctx, paymentLinkId, 'PAYMENT_LINK_APPROVED', undefined, link.contentHash);
}

/** Creates the hosted checkout AND delivers it into the originating
 *  conversation in one step — both require the link to already be APPROVED;
 *  neither can happen otherwise. */
export async function createAndSendPaymentLink(ctx: PaymentLinkContext, paymentLinkId: string): Promise<{ hostedUrl: string; messageId: string }> {
  const link = await ctx.store.loadLink(paymentLinkId);
  if (!link) throw new PaymentLinkAuthorityError('Payment link not found.', 'NOT_FOUND');
  if (link.status !== 'APPROVED') throw new PaymentLinkAuthorityError(`Link must be APPROVED before a checkout can be created (currently ${link.status}).`, 'NOT_APPROVED');
  if (Date.parse(link.expiresAt) <= ctx.now().getTime()) throw new PaymentLinkAuthorityError('This payment link has already expired.', 'EXPIRED');

  const checkout = await ctx.adapter.createHostedCheckout({ orderReference: link.orderReference, amountMinor: link.amountMinor, currency: link.currency });
  const created = { ...link, status: 'LINK_CREATED' as const, hostedUrl: checkout.hostedUrl };
  await ctx.store.saveLink(created);
  await audit(ctx, paymentLinkId, 'PAYMENT_LINK_CHECKOUT_CREATED');

  // Deliver into the originating conversation ONLY — never any other
  // conversation, and never a channel outside that conversation's own.
  const messageId = randomUUID();
  const sentAt = ctx.now().toISOString();
  const body = `${link.paymentPurpose}\n${checkout.hostedUrl}`;
  await ctx.conversationStore.saveMessage({
    messageId,
    conversationId: link.originatingConversationId,
    direction: 'OUTBOUND',
    senderKind: 'STAFF',
    agentRole: null,
    body,
    contentHash: sha256({ paymentLinkId, body }),
    status: 'SENT',
    requiresHumanApproval: false,
    approvedBy: link.approvedBy,
    approvedAt: link.approvedAt,
    sentAt,
    correlationId: ctx.correlationId,
    createdAt: sentAt,
    riskClass: 'HUMAN_APPROVAL_REQUIRED',
    policyId: null,
    policyHash: null,
    knowledgeVersion: null,
    model: null,
    agentRunId: null,
    messageType: 'TEXT'
  });
  await ctx.store.saveLink({ ...created, status: 'SENT' });
  await audit(ctx, paymentLinkId, 'PAYMENT_LINK_SENT', undefined, link.contentHash);

  return { hostedUrl: checkout.hostedUrl, messageId };
}

export async function cancelPaymentLink(ctx: PaymentLinkContext, paymentLinkId: string, reasonCode: string): Promise<void> {
  const link = await ctx.store.loadLink(paymentLinkId);
  if (!link) throw new PaymentLinkAuthorityError('Payment link not found.', 'NOT_FOUND');
  if (['VERIFIED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'].includes(link.status)) {
    throw new PaymentLinkAuthorityError(`Link is already terminal (${link.status}).`, 'ALREADY_TERMINAL');
  }
  await ctx.store.saveLink({ ...link, status: 'CANCELLED' });
  await audit(ctx, paymentLinkId, 'PAYMENT_LINK_CANCELLED', reasonCode);
}

/** Processes an inbound webhook (reusing `processWebhook` unchanged), then
 *  reconciles against the specific payment link the webhook's order
 *  reference identifies. Duplicate events are idempotent no-ops. */
export async function processPaymentLinkWebhook(
  ctx: PaymentLinkContext,
  webhook: InboundWebhook,
  secret: string,
  payload: { orderReference: string; status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'EXPIRED'; amountMinor: number; currency: string; providerTransactionReference: string | null }
): Promise<{ accepted: boolean; verified: boolean; reasonCode: string }> {
  const reservation = await ctx.store.reserveWebhookReceipt({
    eventId: webhook.eventId, paymentLinkId: null, eventType: webhook.eventType,
    accepted: true, reasonCode: null, correlationId: ctx.correlationId
  });
  if (!reservation.winner) {
    return { accepted: true, verified: false, reasonCode: 'DUPLICATE_EVENT' };
  }

  const result = processWebhook({
    webhook, secret, adapter: ctx.adapter, knownEventTypes: ['payment.paid', 'payment.failed', 'payment.cancelled'],
    processedEventIds: new Set(), correlationId: ctx.correlationId, now: ctx.now()
  });
  if (!result.accepted) {
    reportError(new Error(`payment-link webhook rejected: ${result.reasonCode}`), { code: 'PAYMENT_LINK_WEBHOOK_REJECTED' });
    return { accepted: false, verified: false, reasonCode: result.reasonCode };
  }

  const link = await ctx.store.loadLinkByOrderReference(payload.orderReference);
  if (!link) return { accepted: true, verified: false, reasonCode: 'LINK_NOT_FOUND' };

  const reconciliation = reconcilePaymentLink({
    expectedAmountMinor: link.amountMinor,
    receivedAmountMinor: payload.amountMinor,
    expectedCurrency: link.currency,
    receivedCurrency: payload.currency,
    expectedOrderReference: link.orderReference,
    receivedOrderReference: payload.orderReference,
    providerTransactionReference: payload.providerTransactionReference,
    providerStatus: payload.status,
    linkExpiresAt: link.expiresAt,
    receivedAt: ctx.now().toISOString(),
    seenProviderReferences: []
  });

  await ctx.store.saveLink({ ...link, status: reconciliation.verified ? 'VERIFIED' : 'MISMATCHED' });
  await audit(ctx, link.paymentLinkId, reconciliation.verified ? 'PAYMENT_LINK_VERIFIED' : 'PAYMENT_LINK_MISMATCHED', reconciliation.reasonCode);

  return { accepted: true, verified: reconciliation.verified, reasonCode: reconciliation.reasonCode };
}
