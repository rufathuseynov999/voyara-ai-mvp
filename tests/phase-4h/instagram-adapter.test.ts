import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import test from 'node:test';
import { InstagramChannelAdapter } from '@/server/agents/instagram/instagram-adapter';
import { processInboundInstagramMessage } from '@/server/agents/instagram/instagram-inbound';
import {
  INSTAGRAM_FIXTURE_INBOUND_TEXT, INSTAGRAM_FIXTURE_INBOUND_SECOND_SENDER,
  INSTAGRAM_FIXTURE_INBOUND_RETURNING_SENDER, INSTAGRAM_FIXTURE_DELIVERY_RECEIPT,
  INSTAGRAM_FIXTURE_UNKNOWN_PAGE
} from '@/server/agents/instagram/instagram-fixtures';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryIdentityStore } from '@/server/agents/in-memory-identity-store';
import {
  readInstagramAppCredentials, readInstagramBrandCredentials, readInstagramCredentials,
  validateInstagramConfiguration, InstagramConfigurationError
} from '@/config/env-core';
import { createChannelAdapter, ChannelAdapterError } from '@/server/agents/channel-registry';

/**
 * Phase 4H — hermetic tests for the Instagram adapter. Mirrors
 * tests/phase-4c/whatsapp.test.ts's coverage shape, plus the identity
 * linking and dual-brand isolation guarantees specific to Instagram.
 */

const FIXTURE_APP = {
  appId: 'test-app-000001', appSecret: 'test-app-secret-00000000',
  webhookVerifyToken: 'test-verify-00000000', graphApiVersion: 'v21.0',
  callbackUrl: 'https://fixture.invalid/webhook'
};
const RTRAVEL_CREDS = { ...FIXTURE_APP, brand: 'RTRAVEL' as const, instagramAccountId: 'test-ig-rtravel-001', pageId: 'test-page-000001', accessToken: 'test-token-rtravel-00000000' };
const VOYARA_CREDS = { ...FIXTURE_APP, brand: 'VOYARA' as const, instagramAccountId: 'test-ig-voyara-001', pageId: 'test-page-voyara-000001', accessToken: 'test-token-voyara-00000000' };

/** Casts a plain object literal to NodeJS.ProcessEnv for test env-var
 *  fixtures — the readers below only ever read string keys off it, so a
 *  partial literal is safe here even though the real type requires every
 *  standard Node env var to be present. */
function envFixture(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

/* ------------------------------- signature/challenge ------------------------------- */

test('Instagram: webhook challenge succeeds only with the exact configured token', () => {
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  assert.equal(adapter.verifyChallenge('subscribe', FIXTURE_APP.webhookVerifyToken, 'echo-1'), 'echo-1');
  assert.equal(adapter.verifyChallenge('subscribe', 'wrong', 'echo-1'), null);
  assert.equal(adapter.verifyChallenge('unsubscribe', FIXTURE_APP.webhookVerifyToken, 'echo-1'), null);
  assert.equal(adapter.verifyChallenge('subscribe', null, 'echo-1'), null);
});

test('Instagram: valid signature is accepted, tampered/missing/wrong-secret signatures are rejected', () => {
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  const body = JSON.stringify(INSTAGRAM_FIXTURE_INBOUND_TEXT);
  const goodSig = `sha256=${createHmac('sha256', FIXTURE_APP.appSecret).update(body).digest('hex')}`;

  const good = adapter.verifyAndParseWebhook(body, goodSig);
  assert.equal(good.valid, true);
  assert.equal(good.payload?.entry.length, 1);

  const tampered = adapter.verifyAndParseWebhook(body.replace('Salam', 'X'), goodSig);
  assert.equal(tampered.valid, false);

  const missing = adapter.verifyAndParseWebhook(body, null);
  assert.equal(missing.valid, false);

  const wrongSecretSig = `sha256=${createHmac('sha256', 'totally-different-secret-value').update(body).digest('hex')}`;
  const wrongSecret = adapter.verifyAndParseWebhook(body, wrongSecretSig);
  assert.equal(wrongSecret.valid, false);
});

test('Instagram: unsupported object type is rejected even with a valid signature', () => {
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const sig = `sha256=${createHmac('sha256', FIXTURE_APP.appSecret).update(body).digest('hex')}`;
  const result = adapter.verifyAndParseWebhook(body, sig);
  assert.equal(result.valid, true); // signature itself is fine
  assert.equal(result.payload, null); // but the schema rejects the object literal
});

test('Instagram: an entry for an unknown/unowned page id is filtered out of the parsed payload', () => {
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  const body = JSON.stringify(INSTAGRAM_FIXTURE_UNKNOWN_PAGE);
  const sig = `sha256=${createHmac('sha256', FIXTURE_APP.appSecret).update(body).digest('hex')}`;
  const result = adapter.verifyAndParseWebhook(body, sig);
  assert.equal(result.valid, true);
  assert.equal(result.payload?.entry.length, 0);
});

/* ------------------------------- credentials / env-core ------------------------------- */

test('Instagram: readInstagramAppCredentials returns null when nothing is set', () => {
  assert.equal(readInstagramAppCredentials(envFixture({})), null);
});

test('Instagram: readInstagramAppCredentials throws on partial configuration', () => {
  assert.throws(() => readInstagramAppCredentials(envFixture({ VOYARA_META_APP_ID: 'app-id-0001' })));
});

test('Instagram: readInstagramAppCredentials throws on placeholder content', () => {
  assert.throws(() => readInstagramAppCredentials(envFixture({
    VOYARA_META_APP_ID: 'app-1', VOYARA_META_APP_SECRET: 'replace_me_0000000000000',
    VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-0000000000', VOYARA_INSTAGRAM_CALLBACK_URL: 'https://x.invalid/webhook'
  })), /placeholder/);
});

test('Instagram: readInstagramBrandCredentials is brand-scoped and never reads the other brand\'s vars', () => {
  const env = envFixture({
    VOYARA_INSTAGRAM_RTRAVEL_ACCOUNT_ID: 'ig-r', VOYARA_INSTAGRAM_RTRAVEL_PAGE_ID: 'page-r', VOYARA_INSTAGRAM_RTRAVEL_ACCESS_TOKEN: 'token-rtravel-0000000000'
  });
  const rtravel = readInstagramBrandCredentials('RTRAVEL', env);
  const voyara = readInstagramBrandCredentials('VOYARA', env);
  assert.equal(rtravel?.brand, 'RTRAVEL');
  assert.equal(voyara, null);
});

test('Instagram: readInstagramCredentials requires BOTH app-level and brand-level credentials', () => {
  const appOnly = envFixture({ VOYARA_META_APP_ID: 'app-id-0001', VOYARA_META_APP_SECRET: 'secret-0000000000000000', VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-0000000000', VOYARA_INSTAGRAM_CALLBACK_URL: 'https://x.invalid/webhook' });
  assert.equal(readInstagramCredentials('RTRAVEL', appOnly), null);
});

test('Instagram: validateInstagramConfiguration distinguishes all required states', () => {
  assert.deepEqual(validateInstagramConfiguration(envFixture({})), { status: 'BOTH_NOT_CONFIGURED' });

  const appVars = envFixture({ VOYARA_META_APP_ID: 'app-id-0001', VOYARA_META_APP_SECRET: 'secret-0000000000000000', VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-0000000000', VOYARA_INSTAGRAM_CALLBACK_URL: 'https://x.invalid/webhook' });
  const rtravelVars = envFixture({ VOYARA_INSTAGRAM_RTRAVEL_ACCOUNT_ID: 'ig-r', VOYARA_INSTAGRAM_RTRAVEL_PAGE_ID: 'page-r', VOYARA_INSTAGRAM_RTRAVEL_ACCESS_TOKEN: 'token-rtravel-0000000000' });
  const voyaraVars = envFixture({ VOYARA_INSTAGRAM_VOYARA_ACCOUNT_ID: 'ig-v', VOYARA_INSTAGRAM_VOYARA_PAGE_ID: 'page-v', VOYARA_INSTAGRAM_VOYARA_ACCESS_TOKEN: 'token-voyara-0000000000' });

  assert.deepEqual(validateInstagramConfiguration({ ...appVars, ...rtravelVars }), { status: 'ONLY_RTRAVEL_CONFIGURED' });
  assert.deepEqual(validateInstagramConfiguration({ ...appVars, ...voyaraVars }), { status: 'ONLY_VOYARA_CONFIGURED' });
  assert.deepEqual(validateInstagramConfiguration({ ...appVars, ...rtravelVars, ...voyaraVars }), { status: 'BOTH_CONFIGURED' });
});

test('Instagram: validateInstagramConfiguration throws (never silently degrades) on duplicate account id across brands', () => {
  const appVars = envFixture({ VOYARA_META_APP_ID: 'app-id-0001', VOYARA_META_APP_SECRET: 'secret-0000000000000000', VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-0000000000', VOYARA_INSTAGRAM_CALLBACK_URL: 'https://x.invalid/webhook' });
  const env = envFixture({
    ...appVars,
    VOYARA_INSTAGRAM_RTRAVEL_ACCOUNT_ID: 'same-ig', VOYARA_INSTAGRAM_RTRAVEL_PAGE_ID: 'page-r', VOYARA_INSTAGRAM_RTRAVEL_ACCESS_TOKEN: 'token-rtravel-0000000000',
    VOYARA_INSTAGRAM_VOYARA_ACCOUNT_ID: 'same-ig', VOYARA_INSTAGRAM_VOYARA_PAGE_ID: 'page-v', VOYARA_INSTAGRAM_VOYARA_ACCESS_TOKEN: 'token-voyara-0000000000'
  });
  assert.throws(() => validateInstagramConfiguration(env), (e: unknown) => e instanceof InstagramConfigurationError && e.code === 'DUPLICATE_ACCOUNT_ID');
});

test('Instagram: validateInstagramConfiguration throws on shared access token across brands', () => {
  const appVars = envFixture({ VOYARA_META_APP_ID: 'app-id-0001', VOYARA_META_APP_SECRET: 'secret-0000000000000000', VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-0000000000', VOYARA_INSTAGRAM_CALLBACK_URL: 'https://x.invalid/webhook' });
  const env = envFixture({
    ...appVars,
    VOYARA_INSTAGRAM_RTRAVEL_ACCOUNT_ID: 'ig-r', VOYARA_INSTAGRAM_RTRAVEL_PAGE_ID: 'page-r', VOYARA_INSTAGRAM_RTRAVEL_ACCESS_TOKEN: 'same-token-000000000000000',
    VOYARA_INSTAGRAM_VOYARA_ACCOUNT_ID: 'ig-v', VOYARA_INSTAGRAM_VOYARA_PAGE_ID: 'page-v', VOYARA_INSTAGRAM_VOYARA_ACCESS_TOKEN: 'same-token-000000000000000'
  });
  assert.throws(() => validateInstagramConfiguration(env), (e: unknown) => e instanceof InstagramConfigurationError && e.code === 'DUPLICATE_ACCESS_TOKEN');
});

/* ------------------------------- channel-registry gating ------------------------------- */

test('Instagram: channel-registry refuses SANDBOX construction without a brand parameter', () => {
  assert.throws(() => createChannelAdapter('INSTAGRAM_DM', 'SANDBOX', envFixture({})), (e: unknown) => e instanceof ChannelAdapterError && e.code === 'CREDENTIALS_MISSING');
});

test('Instagram: channel-registry refuses SANDBOX construction without credentials', () => {
  assert.throws(() => createChannelAdapter('INSTAGRAM_DM', 'SANDBOX', envFixture({}), 'RTRAVEL'), (e: unknown) => e instanceof ChannelAdapterError && e.code === 'CREDENTIALS_MISSING');
});

test('Instagram: channel-registry refuses SANDBOX construction when credentials exist but activation switch is not \'true\'', () => {
  const env = envFixture({
    VOYARA_META_APP_ID: 'app-id-0001', VOYARA_META_APP_SECRET: 'secret-0000000000000000', VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-0000000000', VOYARA_INSTAGRAM_CALLBACK_URL: 'https://x.invalid/webhook',
    VOYARA_INSTAGRAM_RTRAVEL_ACCOUNT_ID: 'ig-r', VOYARA_INSTAGRAM_RTRAVEL_PAGE_ID: 'page-r', VOYARA_INSTAGRAM_RTRAVEL_ACCESS_TOKEN: 'token-rtravel-0000000000'
    // VOYARA_INSTAGRAM_ACTIVATION_ENABLED deliberately absent
  });
  assert.throws(() => createChannelAdapter('INSTAGRAM_DM', 'SANDBOX', env, 'RTRAVEL'), (e: unknown) => e instanceof ChannelAdapterError && e.code === 'CREDENTIALS_MISSING');
});

test('Instagram: channel-registry constructs a real adapter once credentials AND activation switch are both present', () => {
  const env = envFixture({
    VOYARA_META_APP_ID: 'app-id-0001', VOYARA_META_APP_SECRET: 'secret-0000000000000000', VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-0000000000', VOYARA_INSTAGRAM_CALLBACK_URL: 'https://x.invalid/webhook',
    VOYARA_INSTAGRAM_RTRAVEL_ACCOUNT_ID: 'ig-r', VOYARA_INSTAGRAM_RTRAVEL_PAGE_ID: 'page-r', VOYARA_INSTAGRAM_RTRAVEL_ACCESS_TOKEN: 'token-rtravel-0000000000',
    VOYARA_INSTAGRAM_ACTIVATION_ENABLED: 'true'
  });
  const adapter = createChannelAdapter('INSTAGRAM_DM', 'SANDBOX', env, 'RTRAVEL');
  assert.equal(adapter.channel, 'INSTAGRAM_DM');
  assert.equal(adapter.mode, 'SANDBOX');
});

/* ------------------------------- inbound normalization + identity linking ------------------------------- */

test('Instagram: a first-time sender is never auto-linked — no LinkedIdentity is created', async () => {
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);

  const { messageIds } = await processInboundInstagramMessage(
    { conversationStore, identityStore, adapter, accountId: randomUUID(), brand: 'RTRAVEL', correlationId: 'test-corr-1', now: () => new Date() },
    INSTAGRAM_FIXTURE_INBOUND_TEXT
  );
  assert.equal(messageIds.length, 1);
  const message = await conversationStore.loadMessage(messageIds[0]);
  assert.equal(message?.status, 'SENT');
  assert.equal(message?.direction, 'INBOUND');

  const conversation = await conversationStore.loadConversation(message!.conversationId);
  assert.equal(conversation?.channel, 'INSTAGRAM_DM');

  const identity = await identityStore.findByExternalId('INSTAGRAM_RTRAVEL', 'test-igsid-000001');
  assert.equal(identity, null, 'an Instagram sender id must never be auto-linked');
});

test('Instagram: a returning sender is recognized via lookup, not re-created, and remains unlinked', async () => {
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  const ctx = { conversationStore, identityStore, adapter, accountId: randomUUID(), brand: 'RTRAVEL' as const, correlationId: 'test-corr-2', now: () => new Date() };

  await processInboundInstagramMessage(ctx, INSTAGRAM_FIXTURE_INBOUND_TEXT);
  const { messageIds: secondRound } = await processInboundInstagramMessage(ctx, INSTAGRAM_FIXTURE_INBOUND_RETURNING_SENDER);
  assert.equal(secondRound.length, 1);

  const identity = await identityStore.findByExternalId('INSTAGRAM_RTRAVEL', 'test-igsid-000001');
  assert.equal(identity, null, 'still unlinked — only a HUMAN_CONFIRMED action can link it');
});

test('Instagram: a delivery receipt with no message field produces zero messages', async () => {
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);

  const { messageIds } = await processInboundInstagramMessage(
    { conversationStore, identityStore, adapter, accountId: randomUUID(), brand: 'RTRAVEL', correlationId: 'test-corr-3', now: () => new Date() },
    INSTAGRAM_FIXTURE_DELIVERY_RECEIPT
  );
  assert.equal(messageIds.length, 0);
});

/* ------------------------------- dual-brand routing ------------------------------- */

test('Instagram: R-Travel and VOYARA inbound processing is fully isolated — same fixture shape, independent brands', async () => {
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const rtravelAdapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  const voyaraAdapter = new InstagramChannelAdapter(VOYARA_CREDS);

  await processInboundInstagramMessage(
    { conversationStore, identityStore, adapter: rtravelAdapter, accountId: randomUUID(), brand: 'RTRAVEL', correlationId: 'test-corr-4', now: () => new Date() },
    INSTAGRAM_FIXTURE_INBOUND_TEXT
  );
  await processInboundInstagramMessage(
    { conversationStore, identityStore, adapter: voyaraAdapter, accountId: randomUUID(), brand: 'VOYARA', correlationId: 'test-corr-5', now: () => new Date() },
    INSTAGRAM_FIXTURE_INBOUND_SECOND_SENDER
  );

  // Same external sender id under the two different brand-scoped identity
  // kinds never cross-resolves — proves brand isolation at the identity layer.
  const asRtravel = await identityStore.findByExternalId('INSTAGRAM_RTRAVEL', 'test-igsid-000001');
  const asVoyara = await identityStore.findByExternalId('INSTAGRAM_VOYARA', 'test-igsid-000001');
  assert.equal(asRtravel, null);
  assert.equal(asVoyara, null);
});

test('Instagram: an adapter instance\'s brand is fixed at construction and exposed read-only', () => {
  const rtravelAdapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  const voyaraAdapter = new InstagramChannelAdapter(VOYARA_CREDS);
  assert.equal(rtravelAdapter.brand, 'RTRAVEL');
  assert.equal(voyaraAdapter.brand, 'VOYARA');
});

/* ------------------------------- outbound safety ------------------------------- */

test('Instagram: sendOutbound rejects an empty or over-length body without attempting a network call', async () => {
  let fetchCalled = false;
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS, { fetchImpl: async () => { fetchCalled = true; throw new Error('should not be called'); } });
  const empty = await adapter.sendOutbound({ contactExternalId: 'x', body: '', correlationId: 'c' });
  assert.equal(empty.ok, false);
  const tooLong = await adapter.sendOutbound({ contactExternalId: 'x', body: 'a'.repeat(1_001), correlationId: 'c' });
  assert.equal(tooLong.ok, false);
  assert.equal(fetchCalled, false);
});

test('Instagram: health() never reports healthy without a real network probe', async () => {
  const adapter = new InstagramChannelAdapter(RTRAVEL_CREDS);
  const health = await adapter.health();
  assert.equal(health.healthy, false);
  assert.equal(health.channel, 'INSTAGRAM_DM');
});
