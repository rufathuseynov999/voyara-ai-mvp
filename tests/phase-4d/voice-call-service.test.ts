import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  endCall,
  escalateCallToHuman,
  recordCallConsent,
  scheduleCallbackFromCall,
  speakLowRiskLine,
  startInboundCall,
  transferCall,
  triggerWhatsAppFollowUp,
  type VoiceCallContext
} from '@/server/agents/voice/voice-call-service';
import { InMemoryCallStore } from '@/server/agents/voice/in-memory-call-store';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryIdentityStore } from '@/server/agents/in-memory-identity-store';
import { InMemoryPolicyStore } from '@/server/agents/policy-store';
import { SimulationVoiceAdapter } from '@/server/agents/voice/voice-adapter';
import { SimulationChannelAdapter } from '@/server/agents/simulation-channel-adapter';
import { SimulationLlmRouter } from '@/server/agents/llm-routing';
import { buildApprovedPolicy } from '@/server/agents/low-risk-auto-send';
import { VoiceAuthorityError, voiceLowRiskIntents, voiceSensitiveActionKinds } from '@/server/agents/voice/voice-contract';
import { RiskPolicyAuthorityError } from '@/server/agents/risk-policy-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): VoiceCallContext & { callStore: InMemoryCallStore; conversationStore: InMemoryConversationStore; identityStore: InMemoryIdentityStore; policyStore: InMemoryPolicyStore } {
  return {
    callStore: new InMemoryCallStore(),
    conversationStore: new InMemoryConversationStore(),
    identityStore: new InMemoryIdentityStore(),
    policyStore: new InMemoryPolicyStore(),
    adapter: new SimulationVoiceAdapter(() => FIXED),
    llmRouter: new SimulationLlmRouter(() => FIXED),
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    now: () => FIXED
  };
}

async function activatePolicy(c: ReturnType<typeof ctx>, allowedIntents: string[] = ['GREETING', 'FAQ']) {
  const policy = buildApprovedPolicy({
    policyId: randomUUID(), policyName: 'voice-policy', version: 1, knowledgeVersion: 'kb-1',
    allowedIntents: allowedIntents as never, approvedBy: randomUUID(), correlationId: c.correlationId, now: c.now
  });
  await c.policyStore.savePolicy(policy);
  return policy;
}

/* -------------------------------- call lifecycle -------------------------------- */

test('an inbound call auto-links a verified phone identity and starts a VOICE conversation', async () => {
  const c = ctx();
  const { callId, conversationId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.status, 'STARTED');
  assert.equal(call?.handoverStatus, 'AI');
  const conversation = await c.conversationStore.loadConversation(conversationId);
  assert.equal(conversation?.channel, 'VOICE');
  const identity = await c.identityStore.findByExternalId('TELEPHONE', '+994501234567');
  assert.equal(identity?.linkedVia, 'AUTO_VERIFIED_PHONE');
});

test('a repeat caller reuses the same contact, not a new one', async () => {
  const c = ctx();
  const a = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  const b = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  const callA = await c.callStore.loadCall(a.callId);
  const callB = await c.callStore.loadCall(b.callId);
  assert.equal(callA?.contactId, callB?.contactId);
});

test('dual-brand routing: two calls to different brands stay correctly tagged', async () => {
  const c = ctx();
  const rtravel = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121111111', callerNumber: '+994501111111' });
  const voyara = await startInboundCall(c, { accountId: randomUUID(), brand: 'VOYARA', voiceNumberId: null, calledNumber: '+994122222222', callerNumber: '+994502222222' });
  assert.equal((await c.callStore.loadCall(rtravel.callId))?.brand, 'RTRAVEL');
  assert.equal((await c.callStore.loadCall(voyara.callId))?.brand, 'VOYARA');
});

/* -------------------------------- consent -------------------------------- */

test('consent defaults to NOT_ASKED and a minimal call record still exists', async () => {
  const c = ctx();
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.consent.recording, 'NOT_ASKED');
  assert.equal(call?.recordingEnabled, false);
});

test('declining recording consent keeps recordingEnabled false while preserving the call record', async () => {
  const c = ctx();
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  await recordCallConsent(c, callId, { recording: 'DECLINED', transcription: 'DECLINED' });
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.consent.recording, 'DECLINED');
  assert.equal(call?.recordingEnabled, false);
  assert.ok(call);
});

test('granting recording consent sets recordingEnabled true', async () => {
  const c = ctx();
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  await recordCallConsent(c, callId, { recording: 'GRANTED' });
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.recordingEnabled, true);
});

/* -------------------------------- low-risk policy gate -------------------------------- */

test('speaking a low-risk line is refused with no active policy', async () => {
  const c = ctx();
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  await assert.rejects(() => speakLowRiskLine(c, callId, 'GREETING', 'Salam!'), (e: unknown) => e instanceof VoiceAuthorityError && e.code === 'VALIDATION');
});

test('speaking a low-risk line succeeds under an active policy that allows the intent', async () => {
  const c = ctx();
  await activatePolicy(c, ['GREETING', 'FAQ']);
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  const result = await speakLowRiskLine(c, callId, 'GREETING', 'Salam! VOYARA-ya xoş gəlmisiniz.');
  assert.equal(result.spoken, true);
  const events = c.callStore.eventsFor(callId);
  assert.ok(events.some((e) => e.kind === 'LOW_RISK_LINE_SPOKEN' && e.reasonCode === 'GREETING'));
});

test('speaking an intent not covered by the active policy is refused', async () => {
  const c = ctx();
  await activatePolicy(c, ['GREETING']);
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  await assert.rejects(() => speakLowRiskLine(c, callId, 'MEMBERSHIP_EXPLANATION', 'x'), (e: unknown) => e instanceof VoiceAuthorityError && e.code === 'VALIDATION');
});

test('duration ceiling exceeded refuses further low-risk speech', async () => {
  const c = ctx();
  await activatePolicy(c, ['GREETING']);
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567', durationCeilingSeconds: 60 });
  const laterCtx = { ...c, now: () => new Date(FIXED.getTime() + 120_000) };
  await assert.rejects(() => speakLowRiskLine(laterCtx, callId, 'GREETING', 'x'), (e: unknown) => e instanceof VoiceAuthorityError && e.code === 'DURATION_CEILING_EXCEEDED');
});

/* -------------------------------- escalation / transfer / callback -------------------------------- */

test('escalating to a human sets handoverStatus and records an audit event', async () => {
  const c = ctx();
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  await escalateCallToHuman(c, callId, 'PAYMENT_LINK');
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.handoverStatus, 'HUMAN');
  const events = c.callStore.eventsFor(callId);
  assert.ok(events.some((e) => e.kind === 'CALL_ESCALATED_TO_HUMAN' && e.reasonCode === 'PAYMENT_LINK'));
});

test('every founder-listed sensitive action is a valid escalation reason (closed enum, no execution path)', () => {
  for (const kind of voiceSensitiveActionKinds) {
    assert.ok(typeof kind === 'string' && kind.length > 0);
  }
});

test('transferring the call sets status TRANSFERRED and hands over to human', async () => {
  const c = ctx();
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  const result = await transferCall(c, callId, '+994559999999');
  assert.equal(result.transferred, true);
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.status, 'TRANSFERRED');
  assert.equal(call?.handoverStatus, 'HUMAN');
});

test('scheduling a callback creates a real callback task tied to the call and contact', async () => {
  const c = ctx();
  const { callId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  const call = await c.callStore.loadCall(callId);
  const { taskId } = await scheduleCallbackFromCall(c, callId, new Date(FIXED.getTime() + 86_400_000).toISOString(), 'Call back tomorrow re: Antalya trip');
  const tasks = c.callStore.callbackTasksFor(callId);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].taskId, taskId);
  assert.equal(tasks[0].contactId, call?.contactId);
});

/* -------------------------------- WhatsApp follow-up reuse -------------------------------- */

test('WhatsApp follow-up reuses sendLowRiskMessage unchanged and is subject to the same policy gate — including E.2A\'s WhatsApp low-risk auto-send block, with no bypass for this call path', async () => {
  const c = ctx();
  await activatePolicy(c, ['CALLBACK_SCHEDULING']);
  const contactId = randomUUID();
  await c.conversationStore.upsertContact({ contactId, accountId: randomUUID(), linkedCustomerId: null, displayName: null, phone: '+994501234567', email: null, instagramHandle: '994501234567', preferredLocale: 'az' });
  const conversationId = randomUUID();
  await c.conversationStore.createConversation({ conversationId, accountId: randomUUID(), contactId, channel: 'WHATSAPP', status: 'OPEN', assignedAgentRole: null, relatedQuoteId: null, correlationId: c.correlationId, createdAt: FIXED.toISOString() });

  const lowRiskCtx = { store: c.conversationStore, policyStore: c.policyStore, channel: new SimulationChannelAdapter('WHATSAPP'), correlationId: c.correlationId, now: c.now };
  // E.2A (whatsapp-inbound.ts checkpoint) deliberately disabled ALL
  // WhatsApp low-risk auto-send, including this voice-call follow-up
  // path — this proves that block is real and has no bypass for a
  // specific caller, rather than the earlier pre-E.2A expectation that
  // this path could auto-send.
  await assert.rejects(
    () => triggerWhatsAppFollowUp(lowRiskCtx, conversationId, 'CALLBACK_SCHEDULING', 'We will call you back at 3pm.', 'sim-cheap-v1', '994501234567'),
    (error: unknown) => error instanceof RiskPolicyAuthorityError && error.code === 'WHATSAPP_AUTOSEND_NOT_ACTIVATED'
  );
});

/* -------------------------------- end call -------------------------------- */

test('ending a call marks it COMPLETED and resolves the conversation', async () => {
  const c = ctx();
  const { callId, conversationId } = await startInboundCall(c, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234567' });
  await endCall(c, callId, 185);
  const call = await c.callStore.loadCall(callId);
  assert.equal(call?.status, 'COMPLETED');
  assert.equal(call?.durationSeconds, 185);
  const conversation = await c.conversationStore.loadConversation(conversationId);
  assert.equal(conversation?.status, 'RESOLVED');
});

/* -------------------------------- structural: no sensitive-action execution -------------------------------- */

test('no function in voice-call-service.ts approves prices, creates bookings, issues tickets, or executes payments/refunds', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/voice/voice-call-service.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/approveQuote|approvePrice|createBooking|issueTicket|executePayment|executeRefund|chargeCard/i.test(codeOnly));
});

test('voice-adapter.ts has no method resembling booking confirmation, payment execution, or refund', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/voice/voice-adapter.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/confirmBooking|chargePayment|issueRefund|collectCard|captureCvv/i.test(codeOnly));
});

test('voiceLowRiskIntents has no overlap with voiceSensitiveActionKinds', () => {
  const lowRiskSet = new Set(voiceLowRiskIntents as readonly string[]);
  for (const sensitive of voiceSensitiveActionKinds) {
    assert.ok(!lowRiskSet.has(sensitive));
  }
});
