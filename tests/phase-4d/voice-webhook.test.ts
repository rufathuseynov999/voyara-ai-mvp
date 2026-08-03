import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SimulationVoiceAdapter, signCallWebhookRawBody, type InboundCallWebhook } from '@/server/agents/voice/voice-adapter';
import { processCallWebhookEvent, type CallWebhookProcessingContext } from '@/server/agents/voice/voice-webhook-processing';
import { InMemoryCallStore } from '@/server/agents/voice/in-memory-call-store';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryIdentityStore } from '@/server/agents/in-memory-identity-store';

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const SECRET = 'v'.repeat(32);

function fixtureEvent(overrides: Partial<InboundCallWebhook> = {}): Omit<InboundCallWebhook, 'signature'> {
  return {
    eventId: `evt-${randomUUID()}`, eventType: 'call.started', providerNumberId: 'test-number-000001',
    calledNumber: '+994121234567', callerNumber: '+994501234567', callStatus: 'STARTED',
    transcriptChunk: null, durationSeconds: null, timestamp: FIXED.toISOString(),
    ...overrides
  };
}

function ctx(): CallWebhookProcessingContext & { callStore: InMemoryCallStore; conversationStore: InMemoryConversationStore; identityStore: InMemoryIdentityStore } {
  return {
    callStore: new InMemoryCallStore(), conversationStore: new InMemoryConversationStore(), identityStore: new InMemoryIdentityStore(),
    accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED
  };
}

/* -------------------------------- signature verification, raw body -------------------------------- */

test('a correctly signed raw body verifies and parses', () => {
  const adapter = new SimulationVoiceAdapter(() => FIXED);
  const body = JSON.stringify({ ...fixtureEvent(), signature: '' });
  const signature = signCallWebhookRawBody(SECRET, body);
  const result = adapter.verifyAndParseWebhookRaw(body, signature, SECRET);
  assert.equal(result.valid, true);
  assert.ok(result.payload);
});

test('signature validation happens BEFORE parsing — an invalid signature never returns a payload, even with a well-formed body', () => {
  const adapter = new SimulationVoiceAdapter(() => FIXED);
  const body = JSON.stringify({ ...fixtureEvent(), signature: '' });
  const result = adapter.verifyAndParseWebhookRaw(body, 'sha256=' + 'f'.repeat(64), SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.payload, null);
});

test('a tampered body invalidates an otherwise-correct signature', () => {
  const adapter = new SimulationVoiceAdapter(() => FIXED);
  const body = JSON.stringify({ ...fixtureEvent(), signature: '' });
  const signature = signCallWebhookRawBody(SECRET, body);
  const tampered = JSON.stringify({ ...fixtureEvent({ callerNumber: '+994509999999' }), signature: '' });
  const result = adapter.verifyAndParseWebhookRaw(tampered, signature, SECRET);
  assert.equal(result.valid, false);
});

test('a missing or malformed signature header is rejected', () => {
  const adapter = new SimulationVoiceAdapter(() => FIXED);
  const body = JSON.stringify({ ...fixtureEvent(), signature: '' });
  assert.equal(adapter.verifyAndParseWebhookRaw(body, null, SECRET).valid, false);
  assert.equal(adapter.verifyAndParseWebhookRaw(body, 'not-a-real-signature', SECRET).valid, false);
});

/* -------------------------------- event processing / lifecycle -------------------------------- */

test('a call.started event creates a real call record', async () => {
  const c = ctx();
  const { callId } = await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.started' }) as InboundCallWebhook, null);
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.status, 'STARTED');
});

test('lifecycle ordering: ringing -> answered -> completed transitions the same call correctly', async () => {
  const c = ctx();
  const { callId } = await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.started' }) as InboundCallWebhook, null);
  await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.ringing' }) as InboundCallWebhook, callId);
  assert.equal((await c.callStore.loadCall(callId))?.status, 'RINGING');
  await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.answered' }) as InboundCallWebhook, callId);
  assert.equal((await c.callStore.loadCall(callId))?.status, 'ANSWERED');
  await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.completed', durationSeconds: 210 }) as InboundCallWebhook, callId);
  const final = await c.callStore.loadCall(callId);
  assert.equal(final?.status, 'COMPLETED');
  assert.equal(final?.durationSeconds, 210);
  assert.ok(final?.endedAt);
});

test('a failed event marks the call FAILED and sets endedAt', async () => {
  const c = ctx();
  const { callId } = await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.started' }) as InboundCallWebhook, null);
  await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.failed' }) as InboundCallWebhook, callId);
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.status, 'FAILED');
  assert.ok(call?.endedAt);
});

test('transcript chunks accumulate onto the call record', async () => {
  const c = ctx();
  const { callId } = await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.started' }) as InboundCallWebhook, null);
  await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.transcript_chunk', transcriptChunk: 'Salam,' }) as InboundCallWebhook, callId);
  await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.transcript_chunk', transcriptChunk: 'Baku-ya seyahet etmek isteyirem.' }) as InboundCallWebhook, callId);
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.transcript, 'Salam, Baku-ya seyahet etmek isteyirem.');
});

test('dual-brand routing: brand carried through processing context is preserved on the created call', async () => {
  const c = { ...ctx(), brand: 'VOYARA' as const };
  const { callId } = await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.started' }) as InboundCallWebhook, null);
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.brand, 'VOYARA');
});

test('a webhook event for an unknown callId throws rather than silently creating a phantom update', async () => {
  const c = ctx();
  await assert.rejects(() => processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.answered' }) as InboundCallWebhook, randomUUID()));
});

test('every processed webhook event is recorded in the call audit trail', async () => {
  const c = ctx();
  const { callId } = await processCallWebhookEvent(c, fixtureEvent({ eventType: 'call.started' }) as InboundCallWebhook, null);
  const events = c.callStore.eventsFor(callId);
  assert.ok(events.some((e) => e.kind === 'WEBHOOK_CALL.STARTED'));
});
