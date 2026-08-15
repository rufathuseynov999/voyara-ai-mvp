import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryIdentityStore } from '@/server/agents/in-memory-identity-store';
import { WhatsAppChannelAdapter } from '@/server/agents/whatsapp/whatsapp-adapter';
import { processInboundWhatsAppMessage, parseMetaMessageTimestamp, type WhatsAppInboundContext } from '@/server/agents/whatsapp/whatsapp-inbound';
import { approveAndSendMessage, type AgentOperatingContext } from '@/server/agents/agent-operating-layer';
import { WHATSAPP_FIXTURE_INBOUND_TEXT } from '@/server/agents/whatsapp/whatsapp-fixtures';
import type { Message } from '@/server/agents/agent-contract';
import { ActiveConversationConflictError, MessageReplayConflictError } from '@/server/conversation/conversation-store-errors';

const CREDENTIALS = {
  phoneNumberId: 'test-phone-number-id', wabaId: 'test-waba', accessToken: 'x'.repeat(32),
  appSecret: 'y'.repeat(32), webhookVerifyToken: 'z'.repeat(32), baseUrl: 'https://graph.facebook.com/v20.0'
};

function makeCtx(overrides: Partial<WhatsAppInboundContext> = {}): WhatsAppInboundContext {
  return {
    conversationStore: new InMemoryConversationStore(),
    identityStore: new InMemoryIdentityStore(),
    adapter: new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: false }),
    accountId: randomUUID(),
    brand: 'VOYARA',
    correlationId: randomUUID(),
    now: () => new Date('2026-08-14T12:00:00.000Z'),
    ...overrides
  };
}

/* --------------------------- §1 brand invariant --------------------------- */

test('an inbound WhatsApp conversation is always created with the real, non-null resolved brand', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const accountId = randomUUID();
  const ctx = makeCtx({ conversationStore: store, accountId, brand: 'RTRAVEL' });
  const result = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.customerFacingBrand, 'RTRAVEL', 'brand is persisted, never left null');
});

test('two different brands for the same account/contact never share a conversation', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const accountId = randomUUID();
  const contactId = randomUUID();
  const ctxVoyara = makeCtx({ conversationStore: store, accountId, brand: 'VOYARA' });
  const resultVoyara = await processInboundWhatsAppMessage(ctxVoyara, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const voyaraMessage = await store.loadMessage(resultVoyara.messageIds[0]);
  const voyaraConversation = await store.loadConversation(voyaraMessage!.conversationId);

  // Same phone number (same contact, via identity auto-link) but resolved
  // under the RTRAVEL brand this time — must NOT reuse the VOYARA thread.
  const ctxRtravel = makeCtx({ conversationStore: store, accountId, brand: 'RTRAVEL' });
  const secondPayload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], id: 'wamid.DIFFERENT' }] };
  const resultRtravel = await processInboundWhatsAppMessage(ctxRtravel, secondPayload);
  const rtravelMessage = await store.loadMessage(resultRtravel.messageIds[0]);
  const rtravelConversation = await store.loadConversation(rtravelMessage!.conversationId);

  assert.notEqual(voyaraConversation!.conversationId, rtravelConversation!.conversationId, 'brand isolation: a new conversation, not a reused one');
  assert.equal(voyaraConversation!.customerFacingBrand, 'VOYARA');
  assert.equal(rtravelConversation!.customerFacingBrand, 'RTRAVEL');
  void contactId;
});

test('findOpenConversation with a real brand never returns a conversation of a different brand', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const accountId = randomUUID();
  const contactId = randomUUID();
  await store.createConversation({
    conversationId: randomUUID(), accountId, contactId, channel: 'WHATSAPP', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'c1', createdAt: '2026-01-01T00:00:00.000Z',
    customerFacingBrand: 'RTRAVEL', handoverStatus: 'AI', lastInboundAt: null
  });
  const found = await store.findOpenConversation({ accountId, contactId, channel: 'WHATSAPP', customerFacingBrand: 'VOYARA' });
  assert.equal(found, null, 'no VOYARA conversation exists, and the RTRAVEL one must not be returned for a VOYARA lookup');
});

/* ------------------------- §4 inbound activity ------------------------- */

test('an inbound message persists both lastInboundAt and lastMessageAt, and sets handoverStatus to HUMAN', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store });
  const result = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  assert.equal(result.messageIds.length, 1);
  const message = await store.loadMessage(result.messageIds[0]);
  assert.ok(message);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.ok(conversation);
  assert.equal(conversation!.status, 'PENDING_HUMAN');
  assert.equal(conversation!.handoverStatus, 'HUMAN');
  assert.ok(conversation!.lastInboundAt, 'lastInboundAt was set');
  assert.equal(conversation!.lastMessageAt, conversation!.lastInboundAt, 'a single inbound event produces matching last_message_at/last_inbound_at');
});

test('Meta timestamp (seconds since epoch) is interpreted correctly, not treated as milliseconds', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store });
  const result = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  // WHATSAPP_FIXTURE_INBOUND_TEXT's messages[0].timestamp is '1735689600'
  // (seconds) = 2025-01-01T00:00:00.000Z. If it had been misread as
  // milliseconds, this would resolve to some time in 1970 instead.
  assert.equal(conversation!.lastInboundAt, '2025-01-01T00:00:00.000Z');
});

test('a second, later inbound message from the same contact reuses the conversation and moves lastInboundAt forward', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store });
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const second = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], id: 'wamid.SECOND', timestamp: '1735776000' }] }; // +1 day
  const result = await processInboundWhatsAppMessage(ctx, second);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.lastInboundAt, '2025-01-02T00:00:00.000Z');
});

test('recordInboundActivity never moves lastInboundAt backwards on a replayed/out-of-order event', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'acct-1', contactId: 'contact-1', channel: 'WHATSAPP', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-01-01T00:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'AI', lastInboundAt: null
  });
  await store.recordInboundActivity({ conversationId, inboundAt: '2026-01-05T00:00:00.000Z', status: 'PENDING_HUMAN', handoverStatus: 'HUMAN' });
  await store.recordInboundActivity({ conversationId, inboundAt: '2026-01-03T00:00:00.000Z', status: 'PENDING_HUMAN', handoverStatus: 'HUMAN' }); // an older, replayed event
  const conversation = await store.loadConversation(conversationId);
  assert.equal(conversation!.lastInboundAt, '2026-01-05T00:00:00.000Z', 'the later timestamp is preserved, not overwritten by the replay');
});

test('an outbound send (updateConversationStatus) never touches lastInboundAt', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'acct-1', contactId: 'contact-1', channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-01-01T00:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: '2026-01-01T00:00:00.000Z'
  });
  await store.updateConversationStatus(conversationId, 'RESOLVED', '2026-01-10T00:00:00.000Z');
  const conversation = await store.loadConversation(conversationId);
  assert.equal(conversation!.lastMessageAt, '2026-01-10T00:00:00.000Z', 'last_message_at was bumped by the outbound send');
  assert.equal(conversation!.lastInboundAt, '2026-01-01T00:00:00.000Z', 'last_inbound_at is completely untouched by an outbound-only write');
});

/* --------------------------- §2 outbound send (canonical path) --------------------------- */
/* E.2A architecture requirement: WhatsApp sending goes through the ONE
 * canonical approveAndSendMessage path (agent-operating-layer.ts), not a
 * second parallel send function. These tests call that exact function. */

function baseOutboundMessage(conversationId: string): Message {
  return {
    messageId: randomUUID(), conversationId, direction: 'OUTBOUND', senderKind: 'STAFF', agentRole: null,
    body: 'Salam! Sizin sualiniza cavab veririk.', contentHash: 'a'.repeat(64), status: 'APPROVED',
    requiresHumanApproval: true, approvedBy: randomUUID(), approvedAt: '2026-08-14T11:00:00.000Z', sentAt: null,
    correlationId: 'corr-1', createdAt: '2026-08-14T10:00:00.000Z', riskClass: 'HUMAN_APPROVAL_REQUIRED',
    policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null, messageType: 'TEXT',
    externalMessageId: null, deliveryStatus: null, webhookStatus: null
  };
}

async function setupWhatsAppConversation(store: InMemoryConversationStore, identityStore: InMemoryIdentityStore, overrides: { accountId?: string; brand?: 'RTRAVEL' | 'VOYARA'; lastInboundAt?: string | null; phone?: string; skipIdentity?: boolean } = {}) {
  const accountId = overrides.accountId ?? 'acct-1';
  const contactId = randomUUID();
  const conversationId = randomUUID();
  const phone = overrides.phone ?? '+994501234567';
  await store.upsertContact({ contactId, accountId, linkedCustomerId: null, displayName: null, phone, email: null, instagramHandle: null, preferredLocale: null });
  if (!overrides.skipIdentity) {
    await identityStore.saveLinkedIdentity({
      linkedIdentityId: randomUUID(), contactId, identityKind: 'WHATSAPP', externalId: phone.replace(/^\+/, ''),
      verified: true, linkedVia: 'AUTO_VERIFIED_PHONE', linkedBy: null, correlationId: 'corr-1', linkedAt: '2026-08-14T09:00:00.000Z'
    });
  }
  await store.createConversation({
    conversationId, accountId, contactId, channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: overrides.brand ?? 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: overrides.lastInboundAt === undefined ? '2026-08-14T11:30:00.000Z' : overrides.lastInboundAt
  });
  return { accountId, contactId, conversationId };
}

function makeOperatingCtx(store: InMemoryConversationStore, identityStore: InMemoryIdentityStore, channel: WhatsAppChannelAdapter, accountId: string): AgentOperatingContext {
  return { store, identityStore, channel, actor: { id: 'staff-1', kind: 'human' }, accountId, correlationId: 'corr-1', now: () => new Date('2026-08-14T12:00:00.000Z') };
}

test('approveAndSendMessage: a successful WhatsApp send persists SENT, sentAt, and the real externalMessageId — recipient resolved from the conversation, not caller input', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId } = await setupWhatsAppConversation(store, identityStore, { phone: '+994501234567' });
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);

  let capturedRecipient: string | null = null;
  const fakeFetch: typeof fetch = async (_url, init) => {
    capturedRecipient = JSON.parse(String(init?.body)).to;
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUTREAL0001' }] }), { status: 200 });
  };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch, clock: () => new Date('2026-08-14T12:00:00.000Z') });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');

  // Note: no contactExternalId argument is passed — WhatsApp resolves it internally.
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: true });
  assert.equal(capturedRecipient, '+994501234567', 'the real phone on the contact record was used, not a caller-supplied value');

  const saved = await store.loadMessage(message.messageId);
  assert.equal(saved!.status, 'SENT');
  assert.equal(saved!.sentAt, '2026-08-14T12:00:00.000Z');
  assert.equal(saved!.externalMessageId, 'wamid.OUTREAL0001');
  assert.equal(saved!.deliveryStatus, 'PENDING');
});

test('approveAndSendMessage: a message that is not yet APPROVED is refused before any send is attempted', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId } = await setupWhatsAppConversation(store, identityStore);
  const message = { ...baseOutboundMessage(conversationId), status: 'DRAFTED' as const, approvedBy: null, approvedAt: null };
  await store.saveMessage(message);
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  await assert.rejects(() => approveAndSendMessage(ctx, message.messageId));
  const saved = await store.loadMessage(message.messageId);
  assert.equal(saved!.status, 'DRAFTED', 'unchanged — never marked SENT');
  assert.equal(saved!.externalMessageId, null, 'no externalMessageId is ever invented');
});

test('approveAndSendMessage: service window closed never marks the message SENT and never invents an externalMessageId', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId } = await setupWhatsAppConversation(store, identityStore, { lastInboundAt: null }); // no service window evidence
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: false });
  const saved = await store.loadMessage(message.messageId);
  assert.equal(saved!.status, 'APPROVED', 'still APPROVED, not SENT');
  assert.equal(saved!.externalMessageId, null);
});

test('approveAndSendMessage: activation disabled refuses the send with no network call attempted', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId } = await setupWhatsAppConversation(store, identityStore);
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let fetchCalled = false;
  const fakeFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: false, fetchImpl: fakeFetch });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: false });
  assert.equal(fetchCalled, false, 'no network call was attempted');
});

test('approveAndSendMessage: a WhatsApp conversation with no resolvable brand refuses to send (fail closed, not a default)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const accountId = 'acct-1';
  const contactId = randomUUID();
  const conversationId = randomUUID();
  await store.upsertContact({ contactId, accountId, linkedCustomerId: null, displayName: null, phone: '+994501234567', email: null, instagramHandle: null, preferredLocale: null });
  await store.createConversation({
    conversationId, accountId, contactId, channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: null, handoverStatus: 'HUMAN', lastInboundAt: '2026-08-14T11:30:00.000Z' // no brand — must never send
  });
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let fetchCalled = false;
  const fakeFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch });
  const ctx = makeOperatingCtx(store, identityStore, adapter, accountId);
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: false });
  assert.equal(fetchCalled, false, 'no network call attempted without a resolved brand');
});

test('approveAndSendMessage: an approved message cannot be redirected to another phone via caller-supplied contactExternalId — WhatsApp ignores it entirely', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId } = await setupWhatsAppConversation(store, identityStore, { phone: '+994501234567' });
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let capturedRecipient: string | null = null;
  const fakeFetch: typeof fetch = async (_url, init) => {
    capturedRecipient = JSON.parse(String(init?.body)).to;
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.SAFE0001' }] }), { status: 200 });
  };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch, clock: () => new Date('2026-08-14T12:00:00.000Z') });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  // Even if a caller passed an attacker-supplied phone as contactExternalId,
  // the WHATSAPP branch never reads that argument.
  await approveAndSendMessage(ctx, message.messageId, '+1attacker0000000');
  assert.equal(capturedRecipient, '+994501234567', 'the real contact phone was used, the supplied argument was ignored for WhatsApp');
});

test('approveAndSendMessage: a message belonging to a different conversation than expected is still bound to its OWN conversation\'s contact (no cross-conversation substitution possible)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId: conversationA } = await setupWhatsAppConversation(store, identityStore, { phone: '+994501111111' });
  const { conversationId: conversationB } = await setupWhatsAppConversation(store, identityStore, { phone: '+994502222222' });
  const messageForB = { ...baseOutboundMessage(conversationB) };
  await store.saveMessage(messageForB);
  let capturedRecipient: string | null = null;
  const fakeFetch: typeof fetch = async (_url, init) => {
    capturedRecipient = JSON.parse(String(init?.body)).to;
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
  };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch, clock: () => new Date('2026-08-14T12:00:00.000Z') });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  await approveAndSendMessage(ctx, messageForB.messageId);
  assert.equal(capturedRecipient, '+994502222222', 'resolved from messageForB\'s own conversationId, never conversationA\'s contact');
  void conversationA;
});

/* --------------- §1 (continued) verified WhatsApp identity resolution --------------- */

test('a contact.phone value with NO verified WHATSAPP linked identity refuses to send (phone alone is not recipient authority)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId } = await setupWhatsAppConversation(store, identityStore, { skipIdentity: true }); // phone set, no identity linked
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let fetchCalled = false;
  const fakeFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: false });
  assert.equal(fetchCalled, false, 'zero network calls without a verified identity');
});

test('a linked WHATSAPP identity that belongs to a DIFFERENT contact is never used for this conversation', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId, contactId } = await setupWhatsAppConversation(store, identityStore, { skipIdentity: true });
  // A verified identity exists, but for some OTHER contact entirely.
  await identityStore.saveLinkedIdentity({
    linkedIdentityId: randomUUID(), contactId: randomUUID(), identityKind: 'WHATSAPP', externalId: '994509999999',
    verified: true, linkedVia: 'AUTO_VERIFIED_PHONE', linkedBy: null, correlationId: 'corr-1', linkedAt: '2026-08-14T09:00:00.000Z'
  });
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let fetchCalled = false;
  const fakeFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: false });
  assert.equal(fetchCalled, false);
  void contactId;
});

test('contacts.phone disagreeing with the verified identity fails closed rather than picking one', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId, contactId } = await setupWhatsAppConversation(store, identityStore, { phone: '+994501234567' });
  // Overwrite the verified identity to disagree with contacts.phone.
  await identityStore.saveLinkedIdentity({
    linkedIdentityId: randomUUID(), contactId, identityKind: 'WHATSAPP', externalId: '994509999999',
    verified: true, linkedVia: 'HUMAN_CONFIRMED', linkedBy: randomUUID(), correlationId: 'corr-1', linkedAt: '2026-08-14T09:05:00.000Z'
  });
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let fetchCalled = false;
  const fakeFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: false });
  assert.equal(fetchCalled, false, 'a phone/identity disagreement is a real inconsistency, refused rather than guessed at');
});

test('a valid, unambiguous verified identity produces the exact Meta recipient, and arbitrary contactExternalId is still ignored', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId } = await setupWhatsAppConversation(store, identityStore, { phone: '+994501234567' });
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let capturedRecipient: string | null = null;
  const fakeFetch: typeof fetch = async (_url, init) => {
    capturedRecipient = JSON.parse(String(init?.body)).to;
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.VERIFIED0001' }] }), { status: 200 });
  };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch, clock: () => new Date('2026-08-14T12:00:00.000Z') });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  const result = await approveAndSendMessage(ctx, message.messageId, '+1attacker0000000');
  assert.deepEqual(result, { sent: true });
  assert.equal(capturedRecipient, '+994501234567');
});

test('two verified WHATSAPP identities for the same contact is treated as ambiguous and refused, not guessed', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { conversationId, contactId } = await setupWhatsAppConversation(store, identityStore, { phone: '+994501234567' });
  // A second verified WHATSAPP identity for the SAME contact (e.g. a
  // number change that wasn't properly reconciled).
  await identityStore.saveLinkedIdentity({
    linkedIdentityId: randomUUID(), contactId, identityKind: 'WHATSAPP', externalId: '994507777777',
    verified: true, linkedVia: 'HUMAN_CONFIRMED', linkedBy: randomUUID(), correlationId: 'corr-1', linkedAt: '2026-08-14T09:10:00.000Z'
  });
  const message = baseOutboundMessage(conversationId);
  await store.saveMessage(message);
  let fetchCalled = false;
  const fakeFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}', { status: 200 }); };
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true, fetchImpl: fakeFetch });
  const ctx = makeOperatingCtx(store, identityStore, adapter, 'acct-1');
  const result = await approveAndSendMessage(ctx, message.messageId);
  assert.deepEqual(result, { sent: false });
  assert.equal(fetchCalled, false, 'ambiguous identity state — never guesses which one to use');
});

/* ------------------------ §3 delivery reconciliation ------------------------ */
/* ------------------------ §3 delivery reconciliation ------------------------ */

test('a delivered status updates the exact matching message by externalMessageId, scoped to the right account/brand', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const conversationId = randomUUID();
  const accountId = 'acct-1';
  await store.createConversation({
    conversationId, accountId, contactId: 'contact-1', channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const message = { ...baseOutboundMessage(conversationId), status: 'SENT' as const, sentAt: '2026-08-14T12:00:00.000Z', externalMessageId: 'wamid.OUT001', deliveryStatus: 'PENDING' as const };
  await store.saveMessage(message);

  const result = await store.reconcileDeliveryStatus({ externalMessageId: 'wamid.OUT001', deliveryStatus: 'DELIVERED', webhookStatus: 'delivered', expectedAccountId: accountId, expectedBrand: 'VOYARA' });
  assert.deepEqual(result, { matched: true });
  const updated = await store.loadMessage(message.messageId);
  assert.equal(updated!.deliveryStatus, 'DELIVERED');
});

test('an unknown externalMessageId mutates nothing', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const result = await store.reconcileDeliveryStatus({ externalMessageId: 'wamid.NEVER_EXISTED', deliveryStatus: 'DELIVERED', webhookStatus: 'delivered', expectedAccountId: 'acct-1', expectedBrand: 'VOYARA' });
  assert.deepEqual(result, { matched: false });
});

test('a status for the right externalMessageId but the WRONG brand mutates nothing (cross-brand isolation)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'acct-1', contactId: 'contact-1', channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: 'RTRAVEL', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const message = { ...baseOutboundMessage(conversationId), status: 'SENT' as const, externalMessageId: 'wamid.OUT002', deliveryStatus: 'PENDING' as const };
  await store.saveMessage(message);

  const result = await store.reconcileDeliveryStatus({ externalMessageId: 'wamid.OUT002', deliveryStatus: 'DELIVERED', webhookStatus: 'delivered', expectedAccountId: 'acct-1', expectedBrand: 'VOYARA' });
  assert.deepEqual(result, { matched: false }, 'a VOYARA-context status event must not touch an RTRAVEL message');
  const unchanged = await store.loadMessage(message.messageId);
  assert.equal(unchanged!.deliveryStatus, 'PENDING', 'untouched');
});

test('a status for the right externalMessageId but the WRONG account mutates nothing', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'acct-OTHER', contactId: 'contact-1', channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const message = { ...baseOutboundMessage(conversationId), status: 'SENT' as const, externalMessageId: 'wamid.OUT005', deliveryStatus: 'PENDING' as const };
  await store.saveMessage(message);
  const result = await store.reconcileDeliveryStatus({ externalMessageId: 'wamid.OUT005', deliveryStatus: 'DELIVERED', webhookStatus: 'delivered', expectedAccountId: 'acct-1', expectedBrand: 'VOYARA' });
  assert.deepEqual(result, { matched: false });
});

test('READ never regresses to DELIVERED on a duplicate/out-of-order status webhook', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'acct-1', contactId: 'contact-1', channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const message = { ...baseOutboundMessage(conversationId), status: 'SENT' as const, externalMessageId: 'wamid.OUT003', deliveryStatus: 'READ' as const };
  await store.saveMessage(message);

  await store.reconcileDeliveryStatus({ externalMessageId: 'wamid.OUT003', deliveryStatus: 'DELIVERED', webhookStatus: 'delivered', expectedAccountId: 'acct-1', expectedBrand: 'VOYARA' });
  const updated = await store.loadMessage(message.messageId);
  assert.equal(updated!.deliveryStatus, 'READ', 'a late/duplicate DELIVERED after READ must not regress the state');
});

test('duplicate identical status events are idempotent', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'acct-1', contactId: 'contact-1', channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const message = { ...baseOutboundMessage(conversationId), status: 'SENT' as const, externalMessageId: 'wamid.OUT004', deliveryStatus: 'PENDING' as const };
  await store.saveMessage(message);
  await store.reconcileDeliveryStatus({ externalMessageId: 'wamid.OUT004', deliveryStatus: 'DELIVERED', webhookStatus: 'delivered', expectedAccountId: 'acct-1', expectedBrand: 'VOYARA' });
  await store.reconcileDeliveryStatus({ externalMessageId: 'wamid.OUT004', deliveryStatus: 'DELIVERED', webhookStatus: 'delivered', expectedAccountId: 'acct-1', expectedBrand: 'VOYARA' });
  const updated = await store.loadMessage(message.messageId);
  assert.equal(updated!.deliveryStatus, 'DELIVERED');
});

/* --------------------- §4 Meta timestamp parsing (parseMetaMessageTimestamp) --------------------- */

const REFERENCE_NOW = new Date('2026-08-14T12:00:00.000Z');

test('a valid seconds-since-epoch string parses correctly', () => {
  // 1735689600 = 2025-01-01T00:00:00.000Z
  assert.equal(parseMetaMessageTimestamp('1735689600', REFERENCE_NOW), '2025-01-01T00:00:00.000Z');
});

test('a value that looks like milliseconds (13 digits) is NOT silently reinterpreted as seconds — it is treated as seconds literally, per Meta\'s documented contract, and any resulting implausible date fails closed', () => {
  // If a caller mistakenly sent milliseconds (e.g. 1735689600000), taking
  // it literally as SECONDS would land far in the future (year ~57000) —
  // exactly the class of bug the far-future check exists to catch.
  const result = parseMetaMessageTimestamp('1735689600000', REFERENCE_NOW);
  assert.equal(result, null, 'an implausible far-future value (from ms/seconds confusion) fails closed, not silently accepted');
});

test('a malformed (non-numeric) timestamp string fails closed', () => {
  assert.equal(parseMetaMessageTimestamp('not-a-timestamp', REFERENCE_NOW), null);
  assert.equal(parseMetaMessageTimestamp('', REFERENCE_NOW), null);
  assert.equal(parseMetaMessageTimestamp('12.5', REFERENCE_NOW), null);
});

test('a negative timestamp fails closed', () => {
  assert.equal(parseMetaMessageTimestamp('-1735689600', REFERENCE_NOW), null);
});

test('a far-future timestamp (more than 1 day ahead) fails closed', () => {
  const farFutureSeconds = Math.floor(REFERENCE_NOW.getTime() / 1000) + 10 * 24 * 60 * 60; // 10 days ahead
  assert.equal(parseMetaMessageTimestamp(String(farFutureSeconds), REFERENCE_NOW), null);
});

test('a delayed but genuinely old message (real past timestamp) still parses successfully — it is stored as real evidence, just not usable to satisfy post-confirmation ordering (proven separately in the migration-29 database suite)', () => {
  const weekAgoSeconds = Math.floor(REFERENCE_NOW.getTime() / 1000) - 7 * 24 * 60 * 60;
  const result = parseMetaMessageTimestamp(String(weekAgoSeconds), REFERENCE_NOW);
  assert.notEqual(result, null, 'an old-but-valid timestamp is still real, storable evidence — not the same failure class as malformed/implausible input');
});

test('the timestamp round-trips through ISO format without timezone loss', () => {
  const seconds = 1735732845; // an arbitrary real second, not on a clean boundary
  const result = parseMetaMessageTimestamp(String(seconds), REFERENCE_NOW);
  assert.equal(new Date(result!).getTime(), seconds * 1000);
});

test('processInboundWhatsAppMessage: a missing/malformed provider timestamp stores the message with providerOccurredAt null, and never opens/extends the service window (lastInboundAt stays untouched)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const malformedPayload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], timestamp: 'garbage' }] };
  const result = await processInboundWhatsAppMessage(ctx, malformedPayload);
  const message = await store.loadMessage(result.messageIds[0]);
  assert.equal(message!.providerOccurredAt, null, 'providerOccurredAt is null, not silently substituted with server time');
  // E.2A §0 correction: lastInboundAt is service-window evidence and must
  // NEVER be a guess — an untrusted timestamp leaves it completely
  // untouched (still null on a brand-new conversation), not "opened" via
  // any server-time fallback. The message is still safely recorded and a
  // human still sees it (status/handover still advance) — this only
  // affects the service-window-relevant field.
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.lastInboundAt, null, 'lastInboundAt is never guessed — the service window is not opened by untrustworthy evidence');
  assert.equal(conversation!.status, 'PENDING_HUMAN', 'the conversation still moves to PENDING_HUMAN — a human still needs to see this message');
  assert.equal(conversation!.handoverStatus, 'HUMAN');
});

/* --------------------- §0 service-window authority matrix --------------------- */

test('a valid recent inbound message opens the service window (lastInboundAt set)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const result = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.ok(conversation!.lastInboundAt);
  assert.equal(conversation!.lastInboundAt, message!.providerOccurredAt);
});

test('a valid but OLDER inbound message never regresses an already-later lastInboundAt', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT); // timestamp 1735689600 (2025-01-01)
  const olderPayload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], id: 'wamid.OLDER', timestamp: '1704067200' }] }; // 2024-01-01, a year earlier
  const result = await processInboundWhatsAppMessage(ctx, olderPayload);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.lastInboundAt, '2025-01-01T00:00:00.000Z', 'the later timestamp is preserved, not regressed by the older replay');
});

test('a malformed timestamp does not open the service window', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const payload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], timestamp: 'not-a-number' }] };
  const result = await processInboundWhatsAppMessage(ctx, payload);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.lastInboundAt, null);
});

test('a missing timestamp does not open the service window', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const payload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], timestamp: '' }] };
  const result = await processInboundWhatsAppMessage(ctx, payload);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.lastInboundAt, null);
});

test('a milliseconds-as-seconds value does not open the service window (implausible far-future fails closed)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const payload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], timestamp: '1735689600000' }] };
  const result = await processInboundWhatsAppMessage(ctx, payload);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.lastInboundAt, null);
});

test('a far-future timestamp does not open the service window', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore, now: () => new Date('2026-08-14T12:00:00.000Z') });
  const farFutureSeconds = Math.floor(new Date('2026-08-14T12:00:00.000Z').getTime() / 1000) + 10 * 24 * 60 * 60;
  const payload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], timestamp: String(farFutureSeconds) }] };
  const result = await processInboundWhatsAppMessage(ctx, payload);
  const message = await store.loadMessage(result.messageIds[0]);
  const conversation = await store.loadConversation(message!.conversationId);
  assert.equal(conversation!.lastInboundAt, null);
});

/* --------------------- store-parity: saveMessage never auto-vivifies a conversation --------------------- */

test('saveMessage rejects a missing conversation — never fabricates one', async () => {
  const store = new InMemoryConversationStore();
  const message: Message = {
    messageId: randomUUID(), conversationId: randomUUID(), direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
    body: 'hello', contentHash: 'a'.repeat(64), status: 'SENT', requiresHumanApproval: false, approvedBy: null, approvedAt: null,
    sentAt: '2026-08-14T09:00:00.000Z', correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
    messageType: 'TEXT', externalMessageId: null, deliveryStatus: null, webhookStatus: null
  };
  await assert.rejects(() => store.saveMessage(message), /CONVERSATION_NOT_FOUND/);
});

test('a failed saveMessage (missing conversation) creates neither a conversation nor a message', async () => {
  const store = new InMemoryConversationStore();
  const conversationId = randomUUID();
  const message: Message = {
    messageId: randomUUID(), conversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
    body: 'hello', contentHash: 'a'.repeat(64), status: 'SENT', requiresHumanApproval: false, approvedBy: null, approvedAt: null,
    sentAt: '2026-08-14T09:00:00.000Z', correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
    messageType: 'TEXT', externalMessageId: null, deliveryStatus: null, webhookStatus: null
  };
  await assert.rejects(() => store.saveMessage(message));
  assert.equal(await store.loadConversation(conversationId), null, 'no conversation was fabricated');
  assert.equal(await store.loadMessage(message.messageId), null, 'no message was persisted');
});

test('creating the real conversation first permits saveMessage to succeed', async () => {
  const store = new InMemoryConversationStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'real-account', contactId: 'real-contact', channel: 'WEB_CHAT', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    handoverStatus: 'AI', lastInboundAt: null
  });
  const message: Message = {
    messageId: randomUUID(), conversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
    body: 'hello', contentHash: 'a'.repeat(64), status: 'SENT', requiresHumanApproval: false, approvedBy: null, approvedAt: null,
    sentAt: '2026-08-14T09:00:00.000Z', correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
    messageType: 'TEXT', externalMessageId: null, deliveryStatus: null, webhookStatus: null
  };
  await store.saveMessage(message);
  const loaded = await store.loadMessage(message.messageId);
  assert.ok(loaded);
});

test('channel is always derived from the real conversation, never the caller — even when the caller omits it', async () => {
  const store = new InMemoryConversationStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'real-account', contactId: 'real-contact', channel: 'INSTAGRAM_DM', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    handoverStatus: 'AI', lastInboundAt: null
  });
  const message: Message = {
    messageId: randomUUID(), conversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
    body: 'hello', contentHash: 'a'.repeat(64), status: 'SENT', requiresHumanApproval: false, approvedBy: null, approvedAt: null,
    sentAt: '2026-08-14T09:00:00.000Z', correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
    messageType: 'TEXT', externalMessageId: null, deliveryStatus: null, webhookStatus: null
    // channel deliberately omitted
  };
  await store.saveMessage(message);
  const loaded = await store.loadMessage(message.messageId);
  assert.equal(loaded!.channel, 'INSTAGRAM_DM', 'channel was derived from the real conversation, not defaulted');
});

test('a caller-supplied channel that mismatches the real conversation is rejected', async () => {
  const store = new InMemoryConversationStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'real-account', contactId: 'real-contact', channel: 'WEB_CHAT', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    handoverStatus: 'AI', lastInboundAt: null
  });
  const message: Message = {
    messageId: randomUUID(), conversationId, direction: 'INBOUND', senderKind: 'CONTACT', agentRole: null,
    body: 'hello', contentHash: 'a'.repeat(64), status: 'SENT', requiresHumanApproval: false, approvedBy: null, approvedAt: null,
    sentAt: '2026-08-14T09:00:00.000Z', correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    riskClass: 'HUMAN_APPROVAL_REQUIRED', policyId: null, policyHash: null, knowledgeVersion: null, model: null, agentRunId: null,
    messageType: 'TEXT', externalMessageId: null, deliveryStatus: null, webhookStatus: null, channel: 'WHATSAPP'
  };
  await assert.rejects(() => store.saveMessage(message), /MESSAGE_CHANNEL_MISMATCH/);
});

test('account/contact/brand authority is never fabricated for a missing conversation — the real values from createConversation are the only source of truth', async () => {
  const store = new InMemoryConversationStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'real-account-xyz', contactId: 'real-contact-xyz', channel: 'WHATSAPP', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const conversation = await store.loadConversation(conversationId);
  assert.equal(conversation!.accountId, 'real-account-xyz');
  assert.equal(conversation!.contactId, 'real-contact-xyz');
  assert.equal(conversation!.customerFacingBrand, 'VOYARA');
  assert.notEqual(conversation!.accountId, 'auto-vivified');
  assert.notEqual(conversation!.contactId, 'auto-vivified');
});

test('an outbound-style write never extends lastInboundAt (regression guard)', async () => {
  const store = new InMemoryConversationStore();
  const conversationId = randomUUID();
  await store.createConversation({
    conversationId, accountId: 'acct-1', contactId: 'contact-1', channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-01-01T00:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  await store.updateConversationStatus(conversationId, 'OPEN', '2026-01-05T00:00:00.000Z');
  const conversation = await store.loadConversation(conversationId);
  assert.equal(conversation!.lastInboundAt, null, 'still null — an outbound-style write never opens the service window');
});

test('with lastInboundAt null, an outbound non-template send stays closed (real send path, not just the parser)', async () => {
  const store = new InMemoryConversationStore();
  const conversationId = randomUUID();
  const contactId = randomUUID();
  await store.upsertContact({ contactId, accountId: 'acct-1', linkedCustomerId: null, displayName: null, phone: '+994501234567', email: null, instagramHandle: null, preferredLocale: null });
  await store.createConversation({
    conversationId, accountId: 'acct-1', contactId, channel: 'WHATSAPP', status: 'PENDING_HUMAN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-1', createdAt: '2026-01-01T00:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  const identityStore = new InMemoryIdentityStore();
  await identityStore.saveLinkedIdentity({
    linkedIdentityId: randomUUID(), contactId, identityKind: 'WHATSAPP', externalId: '994501234567',
    verified: true, linkedVia: 'AUTO_VERIFIED_PHONE', linkedBy: null, correlationId: 'corr-1', linkedAt: '2026-01-01T00:00:00.000Z'
  });
  const message = {
    messageId: randomUUID(), conversationId, direction: 'OUTBOUND' as const, senderKind: 'STAFF' as const, agentRole: null,
    body: 'hello', contentHash: 'a'.repeat(64), status: 'APPROVED' as const, requiresHumanApproval: true,
    approvedBy: randomUUID(), approvedAt: '2026-01-02T00:00:00.000Z', sentAt: null, correlationId: 'corr-1',
    createdAt: '2026-01-02T00:00:00.000Z', riskClass: 'HUMAN_APPROVAL_REQUIRED' as const, policyId: null, policyHash: null,
    knowledgeVersion: null, model: null, agentRunId: null, messageType: 'TEXT' as const,
    externalMessageId: null, deliveryStatus: null, webhookStatus: null
  };
  await store.saveMessage(message);
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { activationEnabled: true });
  const opCtx = { store, identityStore, channel: adapter, actor: { id: 'staff-1', kind: 'human' as const }, accountId: 'acct-1', correlationId: 'corr-1', now: () => new Date() };
  const { approveAndSendMessage } = await import('@/server/agents/agent-operating-layer');
  const result = await approveAndSendMessage(opCtx, message.messageId);
  assert.deepEqual(result, { sent: false }, 'real send path refuses — service window is closed with no inbound evidence at all');
});

/* --------------------- §6A typed active-conversation race recovery --------------------- */

test('active-conversation race: a typed conflict on create is recovered by re-reading and reusing the exact winning conversation — the inbound message is never lost', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const accountId = randomUUID();
  const contactId = randomUUID();
  const winnerConversationId = randomUUID();
  await store.createConversation({
    conversationId: winnerConversationId, accountId, contactId, channel: 'WHATSAPP', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: 'corr-winner', createdAt: '2026-08-14T09:00:00.000Z',
    customerFacingBrand: 'VOYARA', handoverStatus: 'HUMAN', lastInboundAt: null
  });
  await identityStore.saveLinkedIdentity({
    linkedIdentityId: randomUUID(), contactId, identityKind: 'WHATSAPP', externalId: WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].from,
    verified: true, linkedVia: 'AUTO_VERIFIED_PHONE', linkedBy: null, correlationId: 'corr-1', linkedAt: '2026-08-14T09:00:00.000Z'
  });

  let createAttempts = 0;
  let findCalls = 0;
  const raceStore: typeof store = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'findOpenConversation') {
        return async (...args: Parameters<typeof store.findOpenConversation>) => {
          findCalls++;
          // First check (before the create attempt): simulates the real
          // race window — at that moment, this worker's own read had not
          // yet seen the winner. Every subsequent call (the recovery
          // re-read) uses the real store, which does have it.
          if (findCalls === 1) return null;
          return target.findOpenConversation(...args);
        };
      }
      if (prop === 'createConversation') {
        return async () => {
          createAttempts++;
          throw new ActiveConversationConflictError(accountId, contactId, 'WHATSAPP', 'VOYARA');
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  const ctx = makeCtx({ conversationStore: raceStore, identityStore, accountId });
  const result = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);

  assert.equal(createAttempts, 1, 'createConversation was attempted and lost the race exactly once');
  assert.equal(result.messageIds.length, 1, 'the inbound message is never lost after the race');
  const message = await store.loadMessage(result.messageIds[0]);
  assert.equal(message!.conversationId, winnerConversationId, 'the message is attached to the WINNING conversation, not a phantom losing one');
});

test('active-conversation race: if no winner can be found on re-read (genuinely unexpected), the original error is preserved (fail closed)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const accountId = randomUUID();
  const contactId = randomUUID();
  await identityStore.saveLinkedIdentity({
    linkedIdentityId: randomUUID(), contactId, identityKind: 'WHATSAPP', externalId: WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].from,
    verified: true, linkedVia: 'AUTO_VERIFIED_PHONE', linkedBy: null, correlationId: 'corr-1', linkedAt: '2026-08-14T09:00:00.000Z'
  });
  const raceStore: typeof store = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'createConversation') {
        return async () => { throw new ActiveConversationConflictError(accountId, contactId, 'WHATSAPP', 'VOYARA'); };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
  const ctx = makeCtx({ conversationStore: raceStore, identityStore, accountId });
  await assert.rejects(() => processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT), ActiveConversationConflictError);
});

test('an unrelated non-conflict error from createConversation is never mistaken for the active-conversation race and is rethrown as-is', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  await identityStore.saveLinkedIdentity({
    linkedIdentityId: randomUUID(), contactId: randomUUID(), identityKind: 'WHATSAPP', externalId: WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].from,
    verified: true, linkedVia: 'AUTO_VERIFIED_PHONE', linkedBy: null, correlationId: 'corr-1', linkedAt: '2026-08-14T09:00:00.000Z'
  });
  const raceStore: typeof store = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'createConversation') {
        return async () => { throw new Error('CONVERSATION_WRITE_FAILED:57P01'); };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
  const ctx = makeCtx({ conversationStore: raceStore, identityStore });
  await assert.rejects(() => processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT), /CONVERSATION_WRITE_FAILED:57P01/);
});

/* --------------------- §2/§4 message-replay idempotency matrix --------------------- */

test('sequential identical replay: sending the exact same Meta message twice creates exactly one message', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const result2 = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT); // identical payload, same external id
  assert.equal(result2.messageIds.length, 1);
  const total = (await Promise.all(result2.messageIds.map((id) => store.loadMessage(id)))).filter(Boolean);
  assert.equal(total.length, 1);
  // Confirm only one message exists for this external id in the whole store.
  const conv = await store.loadMessage(result2.messageIds[0]);
  const winner = await store.loadMessageByExternalId('WHATSAPP', WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].id);
  assert.equal(winner!.message.messageId, conv!.messageId);
});

test('concurrent-style replay: saveMessage losing a race to MessageReplayConflictError reloads and reuses the winner', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const first = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const winnerMessage = await store.loadMessage(first.messageIds[0]);

  // Simulate: the pre-check (loadMessageByExternalId) races and misses,
  // but the real insert then hits the unique index.
  let preCheckCalls = 0;
  const raceStore: typeof store = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'loadMessageByExternalId') {
        return async (...args: Parameters<typeof store.loadMessageByExternalId>) => {
          preCheckCalls++;
          if (preCheckCalls === 1) return null; // pre-check misses (the race window)
          return target.loadMessageByExternalId(...args);
        };
      }
      if (prop === 'saveMessage') {
        return async () => { throw new MessageReplayConflictError('WHATSAPP', WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].id); };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
  const raceCtx = makeCtx({ conversationStore: raceStore, identityStore, accountId: ctx.accountId });
  const result = await processInboundWhatsAppMessage(raceCtx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  assert.equal(result.messageIds[0], winnerMessage!.messageId, 'the race loser reuses the exact winning message, never a phantom duplicate');
});

test('duplicate body text with a DIFFERENT external id creates a genuinely distinct message', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const secondPayload = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], id: 'wamid.DIFFERENT_ID' }] };
  const result2 = await processInboundWhatsAppMessage(ctx, secondPayload);
  assert.equal(result2.messageIds.length, 1);
  const first = await store.loadMessageByExternalId('WHATSAPP', WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].id);
  const second = await store.loadMessageByExternalId('WHATSAPP', 'wamid.DIFFERENT_ID');
  assert.notEqual(first!.message.messageId, second!.message.messageId);
});

test('same external id with a CHANGED body is denied (fails closed, never overwrites)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const tampered = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], text: { body: 'a completely different message' } }] };
  await assert.rejects(() => processInboundWhatsAppMessage(ctx, tampered), /WHATSAPP_REPLAY_EVIDENCE_MISMATCH/);
  const original = await store.loadMessageByExternalId('WHATSAPP', WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].id);
  assert.equal(original!.message.body, WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].text!.body, 'the original message body is never overwritten');
});

test('same external id with a CHANGED provider timestamp is denied', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const tampered = { ...WHATSAPP_FIXTURE_INBOUND_TEXT, messages: [{ ...WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0], timestamp: '1735776000' }] }; // +1 day, same id
  await assert.rejects(() => processInboundWhatsAppMessage(ctx, tampered), /WHATSAPP_REPLAY_EVIDENCE_MISMATCH/);
});

test('same external id under a DIFFERENT account is denied', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx1 = makeCtx({ conversationStore: store, identityStore, accountId: 'account-A' });
  await processInboundWhatsAppMessage(ctx1, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const ctx2 = makeCtx({ conversationStore: store, identityStore, accountId: 'account-B' });
  await assert.rejects(() => processInboundWhatsAppMessage(ctx2, WHATSAPP_FIXTURE_INBOUND_TEXT), /WHATSAPP_REPLAY_EVIDENCE_MISMATCH/);
});

test('same external id under a DIFFERENT brand is denied', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx1 = makeCtx({ conversationStore: store, identityStore, brand: 'VOYARA' });
  await processInboundWhatsAppMessage(ctx1, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const ctx2 = makeCtx({ conversationStore: store, identityStore, brand: 'RTRAVEL' });
  await assert.rejects(() => processInboundWhatsAppMessage(ctx2, WHATSAPP_FIXTURE_INBOUND_TEXT), /WHATSAPP_REPLAY_EVIDENCE_MISMATCH/);
});

test('WhatsApp and a hypothetical other channel may reuse the same external-id text independently (channel-scoped uniqueness)', async () => {
  const store = new InMemoryConversationStore();
  const winner = await store.loadMessageByExternalId('INSTAGRAM_DM', WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].id);
  assert.equal(winner, null, 'no cross-channel collision — an Instagram lookup for the same external-id text finds nothing from a WhatsApp-only store');
});

test('an unrelated (non-replay) error from saveMessage is never mistaken for a replay conflict and remains a hard failure', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const raceStore: typeof store = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'saveMessage') return async () => { throw new Error('MESSAGE_WRITE_FAILED:57P01'); };
      return Reflect.get(target, prop, receiver);
    }
  });
  const ctx = makeCtx({ conversationStore: raceStore, identityStore });
  await assert.rejects(() => processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT), /MESSAGE_WRITE_FAILED:57P01/);
});

test('a replay never re-extends lastInboundAt (no second recordInboundActivity call, service window not artificially extended)', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const first = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const firstMessage = await store.loadMessage(first.messageIds[0]);
  const firstConversation = await store.loadConversation(firstMessage!.conversationId);
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT); // exact replay
  const afterReplayConversation = await store.loadConversation(firstMessage!.conversationId);
  assert.equal(afterReplayConversation!.lastInboundAt, firstConversation!.lastInboundAt, 'lastInboundAt is unchanged by the replay');
});

test('a replay does not create a second conversation', async () => {
  const store = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = makeCtx({ conversationStore: store, identityStore });
  const first = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const firstMessage = await store.loadMessage(first.messageIds[0]);
  const second = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  const secondMessage = await store.loadMessage(second.messageIds[0]);
  assert.equal(firstMessage!.conversationId, secondMessage!.conversationId);
});
