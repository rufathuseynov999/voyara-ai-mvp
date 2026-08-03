#!/usr/bin/env node
/**
 * Phase 4C — WhatsApp Cloud API certification script.
 *
 * Mirrors scripts/certify-hotelbeds-sandbox.mjs exactly: if real WhatsApp
 * credentials are configured, this switches to real HTTPS calls. Otherwise
 * it certifies the adapter's signature/challenge verification and inbound
 * normalization against documented fixtures, and reports NOT_CONFIGURED
 * honestly — never claiming a live connection that wasn't attempted.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readWhatsAppCredentials } from '../src/config/env-core.ts';
import { WhatsAppChannelAdapter } from '../src/server/agents/whatsapp/whatsapp-adapter.ts';
import { processInboundWhatsAppMessage } from '../src/server/agents/whatsapp/whatsapp-inbound.ts';
import { WHATSAPP_FIXTURE_INBOUND_TEXT } from '../src/server/agents/whatsapp/whatsapp-fixtures.ts';
import { InMemoryConversationStore } from '../src/server/agents/in-memory-conversation-store.ts';
import { InMemoryIdentityStore } from '../src/server/agents/in-memory-identity-store.ts';

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

const credentials = readWhatsAppCredentials();

if (credentials) {
  process.stdout.write('=== LIVE MODE: real WhatsApp credentials found. Making REAL HTTPS calls. ===\n' + `Base URL: ${credentials.baseUrl}\n\n`);
  const adapter = new WhatsAppChannelAdapter(credentials);
  const health = await adapter.health();
  record('LIVE health() probe', health.healthy, JSON.stringify(health));
  process.stdout.write('\nLive certification complete.\n');
} else {
  process.stdout.write(
    '=== FIXTURE-ONLY CERTIFICATION: NOT_CONFIGURED — no WhatsApp credentials present. ===\n' +
    'None of VOYARA_WHATSAPP_PHONE_NUMBER_ID / _WABA_ID / _ACCESS_TOKEN / _APP_SECRET / _WEBHOOK_VERIFY_TOKEN\n' +
    'are set. No live HTTPS call has been made or will be made by this run.\n\n'
  );

  const fixtureCredentials = { phoneNumberId: 'cert-phone-000001', wabaId: 'cert-waba-000001', accessToken: 'cert-token-00000000', appSecret: 'cert-secret-00000000', webhookVerifyToken: 'cert-verify-00000000', baseUrl: 'https://fixture.invalid' };
  const adapter = new WhatsAppChannelAdapter(fixtureCredentials);

  // 1. Challenge verification.
  const goodChallenge = adapter.verifyChallenge('subscribe', fixtureCredentials.webhookVerifyToken, 'echo-me-123');
  record('webhook challenge verification succeeds with the correct token', goodChallenge === 'echo-me-123');
  const badChallenge = adapter.verifyChallenge('subscribe', 'wrong-token', 'echo-me-123');
  record('webhook challenge verification fails with the wrong token', badChallenge === null);

  // 2. Signature verification.
  const body = JSON.stringify(WHATSAPP_FIXTURE_INBOUND_TEXT);
  const goodSig = `sha256=${createHmac('sha256', fixtureCredentials.appSecret).update(body).digest('hex')}`;
  const { valid: validGood, payload } = adapter.verifyAndParseWebhook(body, goodSig);
  record('signed webhook body verifies and parses', validGood && payload?.messages.length === 1);
  const { valid: validBad } = adapter.verifyAndParseWebhook(body, 'sha256=' + 'f'.repeat(64));
  record('tampered/invalid signature is rejected', validBad === false);

  // 3. Service window.
  record('service window open within 24h', adapter.withinServiceWindow(new Date(Date.now() - 2 * 3_600_000)));
  record('service window closed past 24h (template required)', !adapter.withinServiceWindow(new Date(Date.now() - 48 * 3_600_000)));

  // 4. Inbound normalization end to end.
  const conversationStore = new InMemoryConversationStore();
  const identityStore = new InMemoryIdentityStore();
  const { messageIds } = await processInboundWhatsAppMessage(
    { conversationStore, identityStore, adapter, accountId: randomUUID(), brand: 'RTRAVEL', correlationId: `cert-${Date.now()}`, now: () => new Date() },
    WHATSAPP_FIXTURE_INBOUND_TEXT
  );
  const message = await conversationStore.loadMessage(messageIds[0]);
  record('inbound fixture message normalizes into a real message row', message?.status === 'SENT' && message?.direction === 'INBOUND');

  process.stdout.write('\nFixture-only certification complete. This run made ZERO live HTTPS calls.\n');
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
if (failed.length > 0) {
  process.stderr.write(`FAILED: ${failed.map((f) => f.name).join(', ')}\n`);
  process.exitCode = 1;
}
