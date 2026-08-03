import type { CommercialSource } from './contract';
import type { QuoteStatus, QuoteAuditEventKind } from './quote-lifecycle';
import type { Quote } from './quote';
import type {
  PaymentRecord,
  ReconciliationStatus,
  WebhookReceipt
} from '@/server/payment/integration-contract';
import type { BookingPreparationContract } from './booking-preparation';

/**
 * Phase 3B Part 1 — persistence port for supplier/quote/payment orchestration.
 *
 * The orchestrator depends only on this interface, so the authority and
 * idempotency logic is fully unit-testable with an in-memory store while
 * production uses a Supabase-backed implementation (same method contract).
 * Every record carries tenant/customer ownership, actor, correlation id, source
 * and timestamps; the store never relaxes those requirements.
 */

export type Actor = {
  id: string;
  kind: 'human' | 'ai_agent' | 'system';
};

export type OwnershipScope = {
  tenantId: string;
  customerId: string;
};

/** A stored idempotency record: a command key mapped to its prior result id. */
export type IdempotencyRecord = {
  key: string;
  resultId: string;
  createdAt: string;
};

export type StoredAuditEvent = {
  eventId: string;
  kind: QuoteAuditEventKind | 'PAYMENT_INTENT_CREATED' | 'PAYMENT_WEBHOOK_RECEIVED'
    | 'PAYMENT_RECONCILED' | 'BOOKING_PREPARED';
  quoteId: string;
  actorId: string;
  actorKind: Actor['kind'];
  correlationId: string;
  occurredAt: string;
  reasonCode?: string;
  contentHash?: string;
};

export interface QuoteStore {
  /**
   * Idempotency (reserve-first): atomically claim `key` for `resultId`.
   * Exactly one caller wins (PostgreSQL PRIMARY KEY decides under real
   * concurrency); losers receive the winner's resultId and must NOT execute
   * the command's work. `releaseIdempotent` frees a reservation whose work
   * failed so a retry can succeed.
   */
  reserveIdempotent(record: IdempotencyRecord): Promise<{ winner: boolean; resultId: string }>;
  releaseIdempotent(key: string): Promise<void>;

  saveQuote(quote: Quote, ownership: OwnershipScope, source: CommercialSource): Promise<void>;
  loadQuote(quoteId: string, requester: OwnershipScope & { isStaff: boolean }): Promise<Quote | null>;

  savePayment(payment: PaymentRecord): Promise<void>;
  loadPaymentByQuote(quoteId: string): Promise<PaymentRecord | null>;

  saveWebhookReceipt(receipt: WebhookReceipt): Promise<void>;
  hasProcessedEvent(eventId: string): Promise<boolean>;

  saveBookingPreparation(preparation: BookingPreparationContract, ownership: OwnershipScope): Promise<void>;

  appendAudit(event: StoredAuditEvent): Promise<void>;
  auditForQuote(quoteId: string): Promise<StoredAuditEvent[]>;
}

/** Reconciliation status re-exported for orchestrator return typing. */
export type { ReconciliationStatus, QuoteStatus };
