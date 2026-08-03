import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { WhatsAppChannelAdapter } from '@/server/agents/whatsapp/whatsapp-adapter';
import { verifyWebhookChallenge, verifyWebhookSignature } from '@/server/agents/whatsapp/whatsapp-signature';
import { processInboundWhatsAppMessage } from '@/server/agents/whatsapp/whatsapp-inbound';
import { WHATSAPP_FIXTURE_INBOUND_BUTTON, WHATSAPP_FIXTURE_INBOUND_TEXT } from '@/server/agents/whatsapp/whatsapp-fixtures';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryIdentityStore } from '@/server/agents/in-memory-identity-store';
import { createChannelAdapter, ChannelAdapterError } from '@/server/agents/channel-registry';

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const APP_SECRET = 'x'.repeat(32);
const VERIFY_TOKEN = 'y'.repeat(32);

const CREDENTIALS = { phoneNumberId: 'test-phone-000001', wabaId: 'test-waba-000001', accessToken: 'z'.repeat(20), appSecret: APP_SECRET, webhookVerifyToken: VERIFY_TOKEN, baseUrl: 'https://fixture.invalid' };

/* -------------------------------- webhook challenge -------------------------------- */

test('a correct webhook challenge is echoed back', () => {
  const result = verifyWebhookChallenge({ mode: 'subscribe', verifyToken: VERIFY_TOKEN, challenge: 'abc123', configuredVerifyToken: VERIFY_TOKEN });
  assert.equal(result, 'abc123');
});

test('a wrong verify token is rejected', () => {
  const result = verifyWebhookChallenge({ mode: 'subscribe', verifyToken: 'wrong-token-000000000000000000', challenge: 'abc123', configuredVerifyToken: VERIFY_TOKEN });
  assert.equal(result, null);
});

test('a non-subscribe mode is rejected', () => {
  const result = verifyWebhookChallenge({ mode: 'unsubscribe', verifyToken: VERIFY_TOKEN, challenge: 'abc123', configuredVerifyToken: VERIFY_TOKEN });
  assert.equal(result, null);
});

/* -------------------------------- webhook signature -------------------------------- */

test('a correctly signed webhook body verifies', () => {
  const body = JSON.stringify({ test: 'payload' });
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  assert.equal(verifyWebhookSignature(body, signature, APP_SECRET), true);
});

test('a tampered body invalidates an otherwise-correct signature', () => {
  const body = JSON.stringify({ test: 'payload' });
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  assert.equal(verifyWebhookSignature(JSON.stringify({ test: 'tampered' }), signature, APP_SECRET), false);
});

test('a missing or malformed signature header is rejected', () => {
  assert.equal(verifyWebhookSignature('{}', null, APP_SECRET), false);
  assert.equal(verifyWebhookSignature('{}', 'not-a-real-signature', APP_SECRET), false);
});

test('the adapter\'s verifyAndParseWebhook rejects an invalid signature before ever parsing the body', () => {
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED });
  const result = adapter.verifyAndParseWebhook(JSON.stringify(WHATSAPP_FIXTURE_INBOUND_TEXT), 'sha256=' + 'f'.repeat(64));
  assert.equal(result.valid, false);
  assert.equal(result.payload, null);
});

test('the adapter\'s verifyAndParseWebhook accepts and parses a genuinely signed body', () => {
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED });
  const body = JSON.stringify(WHATSAPP_FIXTURE_INBOUND_TEXT);
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  const result = adapter.verifyAndParseWebhook(body, signature);
  assert.equal(result.valid, true);
  assert.equal(result.payload?.messages.length, 1);
});

/* -------------------------------- service window -------------------------------- */

test('within 24h of the last inbound message, the service window is open', () => {
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED });
  const twoHoursAgo = new Date(FIXED.getTime() - 2 * 3_600_000);
  assert.equal(adapter.withinServiceWindow(twoHoursAgo), true);
});

test('past 24h since the last inbound message, the service window is closed (template required)', () => {
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED });
  const twoDaysAgo = new Date(FIXED.getTime() - 48 * 3_600_000);
  assert.equal(adapter.withinServiceWindow(twoDaysAgo), false);
});

test('with no prior inbound message at all, the service window is closed', () => {
  const adapter = new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED });
  assert.equal(adapter.withinServiceWindow(null), false);
});

/* -------------------------------- inbound normalization -------------------------------- */

test('an inbound text message auto-links a verified phone identity and creates a PENDING_HUMAN conversation', async () => {
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = {
    conversationStore, identityStore, adapter: new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED }),
    accountId: randomUUID(), brand: 'RTRAVEL' as const, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED
  };
  const { messageIds } = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  assert.equal(messageIds.length, 1);

  const message = await conversationStore.loadMessage(messageIds[0]);
  assert.equal(message?.direction, 'INBOUND');
  assert.equal(message?.senderKind, 'CONTACT');
  assert.equal(message?.status, 'SENT');
  assert.equal(message?.body, WHATSAPP_FIXTURE_INBOUND_TEXT.messages[0].text?.body);

  const conversation = await conversationStore.loadConversation(message!.conversationId);
  assert.equal(conversation?.status, 'PENDING_HUMAN');
  assert.equal(conversation?.channel, 'WHATSAPP');

  const identity = await identityStore.findByExternalId('WHATSAPP', '994501234567');
  assert.ok(identity);
  assert.equal(identity?.linkedVia, 'AUTO_VERIFIED_PHONE');
  assert.equal(identity?.linkedBy, null);
});

test('a button-reply inbound message is normalized with its button text as the body', async () => {
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = {
    conversationStore, identityStore, adapter: new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED }),
    accountId: randomUUID(), brand: 'VOYARA' as const, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED
  };
  const { messageIds } = await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_BUTTON);
  const message = await conversationStore.loadMessage(messageIds[0]);
  assert.equal(message?.messageType, 'BUTTON_REPLY');
  assert.equal(message?.body, 'Yes, book it');
});

test('a second inbound message from the same phone number reuses the same contact, not a duplicate', async () => {
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const ctx = {
    conversationStore, identityStore, adapter: new WhatsAppChannelAdapter(CREDENTIALS, { clock: () => FIXED }),
    accountId: randomUUID(), brand: 'RTRAVEL' as const, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED
  };
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_TEXT);
  await processInboundWhatsAppMessage(ctx, WHATSAPP_FIXTURE_INBOUND_BUTTON);
  assert.equal(identityStore.countIdentities(), 1);
});

/* -------------------------------- channel registry: multi-account-ready -------------------------------- */

test('WHATSAPP in SANDBOX mode fails closed with CREDENTIALS_MISSING when no credentials are configured', () => {
  delete process.env.VOYARA_WHATSAPP_PHONE_NUMBER_ID;
  assert.throws(
    () => createChannelAdapter('WHATSAPP', 'SANDBOX'),
    (e: unknown) => e instanceof ChannelAdapterError && e.code === 'CREDENTIALS_MISSING'
  );
});

test('WHATSAPP in SANDBOX mode constructs successfully once credentials are present', () => {
  process.env.VOYARA_WHATSAPP_PHONE_NUMBER_ID = 'test-phone-000002';
  process.env.VOYARA_WHATSAPP_WABA_ID = 'test-waba-000002';
  process.env.VOYARA_WHATSAPP_ACCESS_TOKEN = 'a'.repeat(20);
  process.env.VOYARA_WHATSAPP_APP_SECRET = 'b'.repeat(20);
  process.env.VOYARA_WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'c'.repeat(20);
  try {
    const adapter = createChannelAdapter('WHATSAPP', 'SANDBOX');
    assert.equal(adapter.channel, 'WHATSAPP');
    assert.equal(adapter.mode, 'SANDBOX');
    assert.equal(adapter.simulated, false);
  } finally {
    delete process.env.VOYARA_WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.VOYARA_WHATSAPP_WABA_ID;
    delete process.env.VOYARA_WHATSAPP_ACCESS_TOKEN;
    delete process.env.VOYARA_WHATSAPP_APP_SECRET;
    delete process.env.VOYARA_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  }
});

/* -------------------------------- structural: no card data / secrets stored -------------------------------- */

test('nothing in the WhatsApp adapter files ever logs or stores the access token or app secret in a message body', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['../../src/server/agents/whatsapp/whatsapp-adapter.ts', '../../src/server/agents/whatsapp/whatsapp-inbound.ts']) {
    const raw = await readFile(new URL(file, import.meta.url), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/console\.(log|error|warn)\([^)]*accessToken/i.test(codeOnly));
    assert.ok(!/body:.*accessToken|body:.*appSecret/i.test(codeOnly));
  }
});
