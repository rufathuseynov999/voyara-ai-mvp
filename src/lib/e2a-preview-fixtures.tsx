import type { Detail } from '@/components/crm-inbox';

/**
 * E.2A internal visual preview fixtures. Deliberately domain-shaped:
 * valid UUID format, real 64-char hex hashes, real direction/sender
 * combinations, a confirmation that genuinely precedes its
 * acknowledgement in time. These are never written anywhere — they only
 * ever exist as in-memory objects passed as React props on the internal
 * preview route, which itself performs no Supabase query and no
 * operational write.
 */

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const CONFIRMATION_MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const ACK_MESSAGE_ID = '55555555-5555-4555-8555-555555555555';

function hash(seed: string): string {
  // A deterministic, valid-looking 64-hex-char placeholder — never a real
  // content hash of anything, purely for visual shape in the preview.
  const base = seed.padEnd(64, '0').slice(0, 64);
  return base.replace(/[^0-9a-f]/gi, '0').toLowerCase();
}

function baseDetail(overrides: Partial<Detail> = {}): Detail {
  return {
    conversationId: CONVERSATION_ID,
    contactId: CONTACT_ID,
    contactName: 'Aysel Məmmədova',
    channel: 'WHATSAPP',
    customerFacingBrand: 'VOYARA',
    status: 'PENDING_HUMAN',
    handoverStatus: 'HUMAN',
    assignedOwnerId: null,
    preferredLocale: 'az',
    lastMessageAt: '2026-08-14T11:32:00.000Z',
    createdAt: '2026-08-14T09:00:00.000Z',
    unread: false,
    slaOverdue: false,
    linkedIdentities: [{ identityKind: 'WHATSAPP', externalId: '994501234567', verified: true }],
    linkedCustomerId: CUSTOMER_ID,
    messages: [
      {
        messageId: 'a0000000-0000-4000-8000-000000000001', direction: 'INBOUND', senderKind: 'CONTACT',
        body: 'Salam! Bakıdan İstanbula sentyabrda 5 gecəlik səfər planlaşdırıram.', status: 'SENT', createdAt: '2026-08-14T09:00:00.000Z',
        approvedBy: null, sentAt: '2026-08-14T09:00:00.000Z', contentHash: hash('inbound-1'), deliveryStatus: null, providerOccurredAt: '2026-08-14T09:00:00.000Z'
      },
      {
        messageId: CONFIRMATION_MESSAGE_ID, direction: 'OUTBOUND', senderKind: 'STAFF',
        body: 'Sizin səfər təfərrüatlarınızı təsdiqləyirik: İstanbul, 01–05 Sentyabr, 2 nəfər, büdcə 3000 AZN. Təsdiq edirsinizmi?',
        status: 'SENT', createdAt: '2026-08-14T10:00:00.000Z', approvedBy: 'staff-preview-id', sentAt: '2026-08-14T10:00:00.000Z',
        contentHash: hash('confirmation'), deliveryStatus: 'READ', providerOccurredAt: null
      }
    ],
    paymentLinks: [],
    voiceCall: null,
    ...overrides
  };
}

export function previewWaitingDetail(): Detail {
  // Confirmation sent, no acknowledgement yet — conversion is genuinely
  // unavailable because the evidence doesn't exist, not because of a UI
  // restriction.
  return baseDetail();
}

export function previewReadyDetail(): Detail {
  return baseDetail({
    messages: [
      ...baseDetail().messages,
      {
        messageId: ACK_MESSAGE_ID, direction: 'INBOUND', senderKind: 'CONTACT',
        body: 'Bəli, təsdiq edirəm!', status: 'SENT', createdAt: '2026-08-14T11:30:00.000Z',
        approvedBy: null, sentAt: '2026-08-14T11:30:00.000Z', contentHash: hash('ack-1'), deliveryStatus: null,
        providerOccurredAt: '2026-08-14T11:30:00.000Z' // strictly after the confirmation's 10:00 sent_at
      }
    ]
  });
}

export const PREVIEW_CONFIRMATION_MESSAGE_ID = CONFIRMATION_MESSAGE_ID;
export const PREVIEW_ACK_MESSAGE_ID = ACK_MESSAGE_ID;

export function previewConvertedDetail(): Detail {
  return previewReadyDetail();
}

export function previewDeniedDetail(): Detail {
  return previewReadyDetail();
}
