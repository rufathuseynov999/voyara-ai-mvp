import type {
  IdempotencyRecord,
  OwnershipScope,
  QuoteStore,
  StoredAuditEvent
} from './orchestration-store';
import type { CommercialSource } from './contract';
import type { Quote } from './quote';
import type { PaymentRecord, WebhookReceipt } from '@/server/payment/integration-contract';
import type { BookingPreparationContract } from './booking-preparation';

/**
 * In-memory QuoteStore for orchestration unit tests. Enforces the same
 * ownership boundary the database RLS enforces: a customer requester may only
 * load their own quote; staff (AAL2) may load any. This lets the cross-customer
 * access-rejection test run without a live database.
 */
export class InMemoryQuoteStore implements QuoteStore {
  private idempotency = new Map<string, IdempotencyRecord>();
  private quotes = new Map<string, { quote: Quote; ownership: OwnershipScope; source: CommercialSource }>();
  private payments = new Map<string, PaymentRecord>();
  private receipts = new Map<string, WebhookReceipt>();
  private preparations: BookingPreparationContract[] = [];
  private audit: StoredAuditEvent[] = [];

  async reserveIdempotent(record: IdempotencyRecord): Promise<{ winner: boolean; resultId: string }> {
    const existing = this.idempotency.get(record.key);
    if (existing) return { winner: false, resultId: existing.resultId };
    this.idempotency.set(record.key, record);
    return { winner: true, resultId: record.resultId };
  }

  async releaseIdempotent(key: string): Promise<void> {
    this.idempotency.delete(key);
  }

  async saveQuote(quote: Quote, ownership: OwnershipScope, source: CommercialSource): Promise<void> {
    this.quotes.set(quote.quoteId, { quote, ownership, source });
  }

  async loadQuote(
    quoteId: string,
    requester: OwnershipScope & { isStaff: boolean }
  ): Promise<Quote | null> {
    const entry = this.quotes.get(quoteId);
    if (!entry) return null;
    // RLS-equivalent: owner (same customer) or AAL2 staff only.
    const isOwner = entry.ownership.customerId === requester.customerId;
    if (!isOwner && !requester.isStaff) return null;
    return entry.quote;
  }

  async savePayment(payment: PaymentRecord): Promise<void> {
    this.payments.set(payment.quoteId, payment);
  }

  async loadPaymentByQuote(quoteId: string): Promise<PaymentRecord | null> {
    return this.payments.get(quoteId) ?? null;
  }

  async saveWebhookReceipt(receipt: WebhookReceipt): Promise<void> {
    this.receipts.set(receipt.eventId, receipt);
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return this.receipts.has(eventId);
  }

  async saveBookingPreparation(preparation: BookingPreparationContract): Promise<void> {
    this.preparations.push(preparation);
  }

  async appendAudit(event: StoredAuditEvent): Promise<void> {
    this.audit.push(event);
  }

  async auditForQuote(quoteId: string): Promise<StoredAuditEvent[]> {
    return this.audit.filter((event) => event.quoteId === quoteId);
  }

  /** Test helpers. */
  countQuotes(): number {
    return this.quotes.size;
  }

  countBookingPreparations(): number {
    return this.preparations.length;
  }

  allAudit(): StoredAuditEvent[] {
    return [...this.audit];
  }
}
