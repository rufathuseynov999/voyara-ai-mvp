import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { PaymentLinkRequest } from './payment-link-contract';
import type { PaymentLinkEventRecord, PaymentLinkStore } from './payment-link-store';

export class SupabasePaymentLinkStore implements PaymentLinkStore {
  private admin() {
    const client = createAdminSupabaseClient();
    if (!client) throw new Error('PAYMENT_LINK_STORE_UNAVAILABLE: Supabase admin client is not configured.');
    return client;
  }

  async saveLink(link: PaymentLinkRequest): Promise<void> {
    const { error } = await this.admin().from('payment_link_requests').upsert({
      id: link.paymentLinkId,
      order_reference: link.orderReference,
      correlation_id: link.correlationId,
      contact_id: link.contactId,
      originating_conversation_id: link.originatingConversationId,
      originating_brand: link.originatingBrand,
      proposal_version_id: link.proposalVersionId,
      supplier_contract_reference: link.supplierContractReference,
      service_description: link.serviceDescription,
      transaction_type: link.transactionType,
      amount_minor: link.amountMinor,
      currency: link.currency,
      merchant_authority: link.merchantAuthority,
      expires_at: link.expiresAt,
      payment_purpose: link.paymentPurpose,
      content_hash: link.contentHash,
      status: link.status,
      approved_by: link.approvedBy,
      approved_at: link.approvedAt,
      hosted_url: link.hostedUrl,
      created_at: link.createdAt
    }, { onConflict: 'id' });
    if (error) throw new Error(`PAYMENT_LINK_WRITE_FAILED:${error.code}`);
  }

  async loadLink(paymentLinkId: string): Promise<PaymentLinkRequest | null> {
    const { data, error } = await this.admin().from('payment_link_requests').select('*').eq('id', paymentLinkId).maybeSingle();
    if (error) throw new Error(`PAYMENT_LINK_READ_FAILED:${error.code}`);
    return data ? this.mapRow(data) : null;
  }

  async loadLinkByOrderReference(orderReference: string): Promise<PaymentLinkRequest | null> {
    const { data, error } = await this.admin().from('payment_link_requests').select('*').eq('order_reference', orderReference).maybeSingle();
    if (error) throw new Error(`PAYMENT_LINK_READ_FAILED:${error.code}`);
    return data ? this.mapRow(data) : null;
  }

  async recordLinkEvent(event: PaymentLinkEventRecord): Promise<void> {
    const { error } = await this.admin().from('payment_link_events').insert({
      id: event.eventId,
      payment_link_id: event.paymentLinkId,
      kind: event.kind,
      actor_id: event.actorId,
      actor_kind: event.actorKind,
      correlation_id: event.correlationId,
      reason_code: event.reasonCode ?? null,
      content_hash: event.contentHash ?? null
    });
    if (error) throw new Error(`PAYMENT_LINK_EVENT_WRITE_FAILED:${error.code}`);
  }

  async reserveWebhookReceipt(record: { eventId: string; paymentLinkId: string | null; eventType: string; accepted: boolean; reasonCode: string | null; correlationId: string }): Promise<{ winner: boolean }> {
    const { error } = await this.admin().from('payment_link_webhook_receipts').insert({
      id: crypto.randomUUID(),
      event_id: record.eventId,
      payment_link_id: record.paymentLinkId,
      event_type: record.eventType,
      accepted: record.accepted,
      reason_code: record.reasonCode,
      correlation_id: record.correlationId
    });
    if (!error) return { winner: true };
    if (error.code === '23505') return { winner: false };
    throw new Error(`PAYMENT_LINK_WEBHOOK_RECEIPT_FAILED:${error.code}`);
  }

  private mapRow(row: Record<string, unknown>): PaymentLinkRequest {
    return {
      paymentLinkId: row.id as string,
      orderReference: row.order_reference as string,
      correlationId: row.correlation_id as string,
      contactId: row.contact_id as string,
      originatingConversationId: row.originating_conversation_id as string,
      originatingBrand: row.originating_brand as PaymentLinkRequest['originatingBrand'],
      proposalVersionId: row.proposal_version_id as string | null,
      supplierContractReference: row.supplier_contract_reference as string | null,
      serviceDescription: row.service_description as string,
      transactionType: row.transaction_type as PaymentLinkRequest['transactionType'],
      amountMinor: row.amount_minor as number,
      currency: row.currency as PaymentLinkRequest['currency'],
      merchantAuthority: row.merchant_authority as string,
      expiresAt: row.expires_at as string,
      paymentPurpose: row.payment_purpose as string,
      contentHash: row.content_hash as string,
      status: row.status as PaymentLinkRequest['status'],
      approvedBy: row.approved_by as string | null,
      approvedAt: row.approved_at as string | null,
      hostedUrl: row.hosted_url as string | null,
      createdAt: row.created_at as string
    };
  }
}
