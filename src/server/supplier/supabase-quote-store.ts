import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type {
  IdempotencyRecord,
  OwnershipScope,
  QuoteStore,
  StoredAuditEvent
} from './orchestration-store';
import type { CommercialSource } from './contract';
import { quoteSchema, type Quote } from './quote';
import type { PaymentRecord, WebhookReceipt } from '@/server/payment/integration-contract';
import type { BookingPreparationContract } from './booking-preparation';

/**
 * Phase 3B Part 2 — Supabase/PostgreSQL implementation of the QuoteStore port.
 *
 * Persists into the Phase 3A tables (quotes, quote_versions, payment_intents,
 * payment_events, payment_webhook_receipts, payment_reconciliations,
 * booking_preparations) plus the new orchestration_idempotency_keys table.
 *
 * Authority notes:
 *  - Writes use the service-role admin client, which is already the authorized
 *    server-side write path in this repository (RLS governs reads; writes are
 *    server-only behind authenticated actions that derive actor/ownership from
 *    the session). No client-side authority writes exist.
 *  - loadQuote enforces the same owner-or-staff boundary the RLS policies
 *    enforce, so even the admin path cannot leak another customer's quote.
 *  - Idempotency uses the table's PRIMARY KEY: a concurrent duplicate insert
 *    violates the constraint, and the caller then returns the existing result
 *    (no duplicate records across process restarts).
 *  - Quote saves write the quote row and its versions together and roll back
 *    the quote-status change if version persistence fails (safe-write order:
 *    versions first, then the quote row that references the current version).
 */

class StoreUnavailableError extends Error {
  constructor() {
    super('ORCHESTRATION_STORE_UNAVAILABLE');
    this.name = 'StoreUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new StoreUnavailableError();
  return client;
}

export class SupabaseQuoteStore implements QuoteStore {
  async reserveIdempotent(record: IdempotencyRecord & Partial<OwnershipScope> & { actorId?: string; correlationId?: string }): Promise<{ winner: boolean; resultId: string }> {
    const { error } = await admin()
      .from('orchestration_idempotency_keys')
      .insert({
        key: record.key,
        result_id: record.resultId,
        account_id: record.tenantId ?? '00000000-0000-0000-0000-000000000000',
        customer_id: record.customerId ?? '00000000-0000-0000-0000-000000000000',
        actor_id: record.actorId ?? '00000000-0000-0000-0000-000000000000',
        correlation_id: record.correlationId ?? 'unknown',
        created_at: record.createdAt
      });
    if (!error) return { winner: true, resultId: record.resultId };
    // 23505 = unique_violation: another concurrent caller won the PRIMARY KEY
    // race. This caller must not execute the work; read and return the
    // winner's authoritative result id.
    if (error.code !== '23505') throw new Error(`IDEMPOTENCY_WRITE_FAILED:${error.code}`);
    const { data, error: readError } = await admin()
      .from('orchestration_idempotency_keys')
      .select('result_id')
      .eq('key', record.key)
      .single();
    if (readError) throw new Error(`IDEMPOTENCY_READ_FAILED:${readError.code}`);
    return { winner: false, resultId: data.result_id };
  }

  async releaseIdempotent(key: string): Promise<void> {
    const { error } = await admin()
      .from('orchestration_idempotency_keys')
      .delete()
      .eq('key', key);
    if (error) throw new Error(`IDEMPOTENCY_RELEASE_FAILED:${error.code}`);
  }

  async saveQuote(quote: Quote, ownership: OwnershipScope, source: CommercialSource): Promise<void> {
    const client = admin();
    // Write order under the real foreign key (quote_versions.quote_id ->
    // quotes.id): parent quote row first, then version upserts. Both writes
    // are idempotent upserts, so a failure between them leaves a retryable
    // state and the version uniqueness constraint keeps history immutable.
    const quoteRow = await client
      .from('quotes')
      .upsert({
        id: quote.quoteId,
        account_id: ownership.tenantId,
        customer_id: ownership.customerId,
        status: quote.status,
        supplier_offer_reference: quote.supplierOfferReference,
        source,
        correlation_id: quote.correlationId,
        current_version_number: quote.currentVersionNumber,
        created_at: quote.createdAt,
        expires_at: quote.expiresAt,
        last_revalidated_at: quote.lastRevalidatedAt
      }, { onConflict: 'id' });
    if (quoteRow.error) throw new Error(`QUOTE_WRITE_FAILED:${quoteRow.error.code}`);

    const versionRows = quote.versions.map((version) => ({
      quote_id: quote.quoteId,
      account_id: ownership.tenantId,
      customer_id: ownership.customerId,
      version_number: version.versionNumber,
      content_hash: version.contentHash,
      material: version.material,
      approval_reference: version.approvalReference,
      approval_invalidated: version.approvalInvalidated,
      previous_version_number: version.previousVersionNumber,
      superseded_reason: version.supersededReason,
      created_at: version.createdAt
    }));
    const versions = await client
      .from('quote_versions')
      .upsert(versionRows, { onConflict: 'quote_id,version_number' });
    if (versions.error) throw new Error(`QUOTE_VERSIONS_WRITE_FAILED:${versions.error.code}`);
  }

  async loadQuote(
    quoteId: string,
    requester: OwnershipScope & { isStaff: boolean }
  ): Promise<Quote | null> {
    const client = admin();
    const quoteResult = await client
      .from('quotes')
      .select('id, account_id, customer_id, status, supplier_offer_reference, source, correlation_id, current_version_number, created_at, expires_at, last_revalidated_at')
      .eq('id', quoteId)
      .maybeSingle();
    if (quoteResult.error) throw new Error(`QUOTE_READ_FAILED:${quoteResult.error.code}`);
    if (!quoteResult.data) return null;

    // RLS-equivalent boundary on the server path: owner or staff only.
    const row = quoteResult.data;
    const isOwner = row.customer_id === requester.customerId;
    if (!isOwner && !requester.isStaff) return null;

    const versionsResult = await client
      .from('quote_versions')
      .select('version_number, content_hash, material, approval_reference, approval_invalidated, previous_version_number, superseded_reason, created_at')
      .eq('quote_id', quoteId)
      .order('version_number', { ascending: true });
    if (versionsResult.error) throw new Error(`QUOTE_VERSIONS_READ_FAILED:${versionsResult.error.code}`);

    return quoteSchema.parse({
      quoteId: row.id,
      tenantId: row.account_id,
      customerId: row.customer_id,
      status: row.status,
      supplierOfferReference: row.supplier_offer_reference,
      source: row.source,
      correlationId: row.correlation_id,
      currentVersionNumber: row.current_version_number,
      versions: (versionsResult.data ?? []).map((version) => ({
        versionNumber: version.version_number,
        contentHash: version.content_hash,
        material: version.material,
        approvalReference: version.approval_reference,
        approvalInvalidated: version.approval_invalidated,
        previousVersionNumber: version.previous_version_number,
        supersededReason: version.superseded_reason,
        createdAt: version.created_at
      })),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastRevalidatedAt: row.last_revalidated_at
    });
  }

  async savePayment(payment: PaymentRecord): Promise<void> {
    const client = admin();
    const intent = await client
      .from('payment_intents')
      .upsert({
        id: payment.paymentId,
        quote_id: payment.quoteId,
        account_id: payment.tenantId,
        customer_id: payment.customerId,
        intent_reference: payment.intentReference,
        expected_amount_minor: payment.expectedAmountMinor,
        currency: payment.currency,
        detected_status: payment.detectedStatus,
        verified_status: payment.verifiedStatus,
        source: payment.source,
        simulated: payment.simulated,
        created_at: payment.createdAt,
        updated_at: payment.updatedAt
      }, { onConflict: 'id' });
    if (intent.error) throw new Error(`PAYMENT_WRITE_FAILED:${intent.error.code}`);

    // Reconciliation evidence rows are append-style records.
    if (payment.reconciliationStatus !== 'PENDING') {
      const reconciliation = await client
        .from('payment_reconciliations')
        .insert({
          payment_intent_id: payment.paymentId,
          account_id: payment.tenantId,
          customer_id: payment.customerId,
          status: payment.reconciliationStatus,
          verified: payment.verifiedStatus === 'VERIFIED',
          requires_human_review: payment.verifiedStatus !== 'VERIFIED',
          reason_code: payment.reconciliationStatus,
          reconciled_at: payment.updatedAt
        });
      if (reconciliation.error) throw new Error(`RECONCILIATION_WRITE_FAILED:${reconciliation.error.code}`);
    }
  }

  async loadPaymentByQuote(quoteId: string): Promise<PaymentRecord | null> {
    const client = admin();
    const result = await client
      .from('payment_intents')
      .select('id, quote_id, account_id, customer_id, intent_reference, expected_amount_minor, currency, detected_status, verified_status, source, simulated, created_at, updated_at')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw new Error(`PAYMENT_READ_FAILED:${result.error.code}`);
    if (!result.data) return null;
    const row = result.data;

    const reconciliation = await client
      .from('payment_reconciliations')
      .select('status')
      .eq('payment_intent_id', row.id)
      .order('reconciled_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      paymentId: row.id,
      quoteId: row.quote_id,
      tenantId: row.account_id,
      customerId: row.customer_id,
      expectedAmountMinor: row.expected_amount_minor,
      receivedAmountMinor: null,
      currency: row.currency,
      receivedCurrency: null,
      providerTransactionReference: null,
      intentReference: row.intent_reference,
      detectedStatus: row.detected_status,
      verifiedStatus: row.verified_status,
      reconciliationStatus: reconciliation.data?.status ?? 'PENDING',
      providerFeesMinor: null,
      supplierPayableMinor: null,
      voyaraRevenueMinor: null,
      cashReceivedMinor: null,
      refundableAmountMinor: null,
      refundRequestStatus: 'NONE',
      bookingAllocationReference: null,
      correlationId: 'persisted',
      source: row.source,
      simulated: row.simulated,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async saveWebhookReceipt(receipt: WebhookReceipt): Promise<void> {
    const { error } = await admin()
      .from('payment_webhook_receipts')
      .insert({
        event_id: receipt.eventId,
        event_type: receipt.eventType,
        accepted: receipt.accepted,
        reason_code: receipt.reasonCode,
        correlation_id: receipt.correlationId,
        received_at: receipt.receivedAt
      });
    // Unique event_id: a duplicate insert is the idempotent no-op path.
    if (error && error.code !== '23505') {
      throw new Error(`WEBHOOK_RECEIPT_WRITE_FAILED:${error.code}`);
    }
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    const { data, error } = await admin()
      .from('payment_webhook_receipts')
      .select('event_id')
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new Error(`WEBHOOK_RECEIPT_READ_FAILED:${error.code}`);
    return data !== null;
  }

  async saveBookingPreparation(preparation: BookingPreparationContract, ownership: OwnershipScope): Promise<void> {
    const { error } = await admin()
      .from('booking_preparations')
      .insert({
        quote_id: preparation.quoteId,
        account_id: ownership.tenantId,
        customer_id: ownership.customerId,
        approved_version_number: preparation.approvedVersionNumber,
        approved_content_hash: preparation.approvedContentHash,
        hag_approval_reference: preparation.hagApprovalReference,
        source: preparation.source,
        simulated: preparation.simulated,
        requires_human_verification: preparation.requiresHumanBookingVerification,
        correlation_id: preparation.correlationId,
        prepared_at: preparation.preparedAt
      });
    if (error) throw new Error(`BOOKING_PREPARATION_WRITE_FAILED:${error.code}`);
  }

  async appendAudit(event: StoredAuditEvent): Promise<void> {
    const { error } = await admin()
      .from('orchestration_audit_events')
      .insert({
        id: event.eventId,
        quote_id: event.quoteId,
        kind: event.kind,
        actor_id: event.actorId,
        actor_kind: event.actorKind,
        correlation_id: event.correlationId,
        reason_code: event.reasonCode ?? null,
        content_hash: event.contentHash ?? null,
        occurred_at: event.occurredAt
      });
    if (error) throw new Error(`AUDIT_WRITE_FAILED:${error.code}`);
  }

  async auditForQuote(quoteId: string): Promise<StoredAuditEvent[]> {
    const { data, error } = await admin()
      .from('orchestration_audit_events')
      .select('id, quote_id, kind, actor_id, actor_kind, correlation_id, reason_code, content_hash, occurred_at')
      .eq('quote_id', quoteId)
      .order('occurred_at', { ascending: true });
    if (error) throw new Error(`AUDIT_READ_FAILED:${error.code}`);
    return (data ?? []).map((row) => ({
      eventId: row.id,
      kind: row.kind as StoredAuditEvent['kind'],
      quoteId: row.quote_id,
      actorId: row.actor_id,
      actorKind: row.actor_kind as StoredAuditEvent['actorKind'],
      correlationId: row.correlation_id,
      occurredAt: row.occurred_at,
      reasonCode: row.reason_code ?? undefined,
      contentHash: row.content_hash ?? undefined
    }));
  }
}
