import type { WhatsAppWebhookPayload } from './whatsapp-contract';
import type { MetaWebhookEnvelope } from './whatsapp-activation';

/**
 * Phase 4C / E.2A — documented WhatsApp fixtures, modeled on Meta's public
 * Cloud API webhook documentation, not captured live (see
 * whatsapp-contract.ts's header for the honesty note: no live Meta
 * endpoint has ever been reached from this project).
 *
 * The META_* fixtures below are the REAL wire shape
 * (object/entry/changes/value) a live webhook actually delivers — these
 * are what should be fed to normalizeMetaWebhookEnvelope() and, at the
 * route boundary, to WhatsAppChannelAdapter.verifyAndParseWebhook(). The
 * WHATSAPP_FIXTURE_* constants remain as the already-normalized INTERNAL
 * shape (WhatsAppWebhookPayload) for tests that operate below the
 * normalization boundary.
 */

export const META_FIXTURE_INBOUND_TEXT: MetaWebhookEnvelope = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'test-waba-id-000001',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '+994501234567', phone_number_id: 'test-phone-number-id-000001' },
            contacts: [{ profile: { name: 'Test Customer' }, wa_id: '994501234567' }],
            messages: [
              { from: '994501234567', id: 'wamid.TEST0001', timestamp: '1735689600', type: 'text', text: { body: 'Salam, Baku-ya sehher planlashdirmaq isteyirem' } }
            ]
          }
        }
      ]
    }
  ]
};

export const META_FIXTURE_INBOUND_BUTTON: MetaWebhookEnvelope = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'test-waba-id-000001',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '+994501234567', phone_number_id: 'test-phone-number-id-000001' },
            messages: [
              { from: '994501234567', id: 'wamid.TEST0002', timestamp: '1735689660', type: 'button', button: { text: 'Yes, book it', payload: 'CONFIRM_YES' } }
            ]
          }
        }
      ]
    }
  ]
};

export const META_FIXTURE_STATUS_DELIVERED: MetaWebhookEnvelope = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'test-waba-id-000001',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '+994501234567', phone_number_id: 'test-phone-number-id-000001' },
            statuses: [{ id: 'wamid.OUTBOUND0001', status: 'delivered', timestamp: '1735689700', recipient_id: '994501234567' }]
          }
        }
      ]
    }
  ]
};

/** Two entries, two different phone numbers, in ONE POST body — the real
 *  batching shape a single Meta webhook delivery can carry. */
export const META_FIXTURE_MULTI_ENTRY_MULTI_NUMBER: MetaWebhookEnvelope = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'test-waba-id-000001',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'test-phone-number-id-000001' },
            messages: [{ from: '994501234567', id: 'wamid.MULTI0001', timestamp: '1735689600', type: 'text', text: { body: 'first number' } }]
          }
        }
      ]
    },
    {
      id: 'test-waba-id-000002',
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'test-phone-number-id-000002' },
            messages: [{ from: '994507654321', id: 'wamid.MULTI0002', timestamp: '1735689601', type: 'text', text: { body: 'second number' } }]
          }
        }
      ]
    }
  ]
};

/** A non-"messages" field (e.g. account review) — must be safely
 *  acknowledged as unsupported, never fabricated into a fake message. */
export const META_FIXTURE_UNSUPPORTED_FIELD: MetaWebhookEnvelope = {
  object: 'whatsapp_business_account',
  entry: [
    { id: 'test-waba-id-000001', changes: [{ field: 'account_review_update', value: {} }] }
  ]
};

/* -------------------------------------------------------------------------
 * Already-normalized internal shape — for tests operating below the
 * normalization boundary (e.g. processInboundWhatsAppMessage directly).
 * ------------------------------------------------------------------------- */

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
