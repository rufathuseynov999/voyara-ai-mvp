import type { WhatsAppWebhookPayload } from './whatsapp-contract';

/** Phase 4C — documented WhatsApp fixtures, modeled on public API docs, not
 *  captured live (see whatsapp-contract.ts's header for the honesty note). */

export const WHATSAPP_FIXTURE_INBOUND_TEXT: WhatsAppWebhookPayload = {
  phoneNumberId: 'test-phone-number-id-000001',
  messages: [{ from: '994501234567', id: 'wamid.TEST0001', timestamp: '1735689600', type: 'text', text: { body: 'Salam, Baku-ya sehher planlashdirmaq isteyirem' } }],
  statuses: []
};

export const WHATSAPP_FIXTURE_INBOUND_BUTTON: WhatsAppWebhookPayload = {
  phoneNumberId: 'test-phone-number-id-000001',
  messages: [{ from: '994501234567', id: 'wamid.TEST0002', timestamp: '1735689660', type: 'button', button: { text: 'Yes, book it', payload: 'CONFIRM_YES' } }],
  statuses: []
};

export const WHATSAPP_FIXTURE_STATUS_DELIVERED: WhatsAppWebhookPayload = {
  phoneNumberId: 'test-phone-number-id-000001',
  messages: [],
  statuses: [{ id: 'wamid.OUTBOUND0001', status: 'delivered', timestamp: '1735689700', recipient_id: '994501234567' }]
};
