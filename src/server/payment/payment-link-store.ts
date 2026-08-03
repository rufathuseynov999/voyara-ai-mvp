import type { PaymentLinkRequest } from './payment-link-contract';

/** Phase 4B — payment-link store port. Mirrors ConversationStore's design. */
export interface PaymentLinkStore {
  saveLink(link: PaymentLinkRequest): Promise<void>;
  loadLink(paymentLinkId: string): Promise<PaymentLinkRequest | null>;
  loadLinkByOrderReference(orderReference: string): Promise<PaymentLinkRequest | null>;
  recordLinkEvent(event: PaymentLinkEventRecord): Promise<void>;
  reserveWebhookReceipt(record: { eventId: string; paymentLinkId: string | null; eventType: string; accepted: boolean; reasonCode: string | null; correlationId: string }): Promise<{ winner: boolean }>;
}

export type PaymentLinkEventRecord = {
  eventId: string;
  paymentLinkId: string;
  kind: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  correlationId: string;
  reasonCode?: string | null;
  contentHash?: string | null;
};
