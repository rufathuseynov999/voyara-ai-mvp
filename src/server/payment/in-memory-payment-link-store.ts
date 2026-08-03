import type { PaymentLinkRequest } from './payment-link-contract';
import type { PaymentLinkEventRecord, PaymentLinkStore } from './payment-link-store';

export class InMemoryPaymentLinkStore implements PaymentLinkStore {
  private readonly links = new Map<string, PaymentLinkRequest>();
  private readonly byOrderReference = new Map<string, string>(); // orderReference -> paymentLinkId
  private readonly events: PaymentLinkEventRecord[] = [];
  private readonly webhookReceipts = new Set<string>();

  async saveLink(link: PaymentLinkRequest): Promise<void> {
    if (!this.links.has(link.paymentLinkId)) {
      const existingForRef = this.byOrderReference.get(link.orderReference);
      if (existingForRef && existingForRef !== link.paymentLinkId) {
        throw new Error('ORDER_REFERENCE_CONFLICT:23505');
      }
      this.byOrderReference.set(link.orderReference, link.paymentLinkId);
    }
    this.links.set(link.paymentLinkId, link);
  }

  async loadLink(paymentLinkId: string): Promise<PaymentLinkRequest | null> {
    return this.links.get(paymentLinkId) ?? null;
  }

  async loadLinkByOrderReference(orderReference: string): Promise<PaymentLinkRequest | null> {
    const id = this.byOrderReference.get(orderReference);
    return id ? (this.links.get(id) ?? null) : null;
  }

  async recordLinkEvent(event: PaymentLinkEventRecord): Promise<void> {
    this.events.push(event);
  }

  async reserveWebhookReceipt(record: { eventId: string }): Promise<{ winner: boolean }> {
    if (this.webhookReceipts.has(record.eventId)) return { winner: false };
    this.webhookReceipts.add(record.eventId);
    return { winner: true };
  }

  /** Test helpers. */
  eventsFor(paymentLinkId: string): PaymentLinkEventRecord[] {
    return this.events.filter((e) => e.paymentLinkId === paymentLinkId);
  }
  countLinks(): number {
    return this.links.size;
  }
}
