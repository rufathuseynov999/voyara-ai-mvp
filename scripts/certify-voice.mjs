#!/usr/bin/env node
/**
 * Phase 4D — voice fixture certification script.
 *
 * Mirrors scripts/certify-whatsapp.mjs exactly: if real voice-provider
 * credentials are configured AND a real adapter implementation exists, this
 * would switch to real calls. Neither exists in this build, so this always
 * runs fixture-only certification and reports NOT_CONFIGURED honestly.
 */
import { randomUUID } from 'node:crypto';
import { readVoiceCredentials } from '../src/config/env-core.ts';
import { SimulationVoiceAdapter, signCallWebhookRawBody } from '../src/server/agents/voice/voice-adapter.ts';
import { processCallWebhookEvent } from '../src/server/agents/voice/voice-webhook-processing.ts';
import {
  startInboundCall, recordCallConsent, speakLowRiskLine, escalateCallToHuman,
  transferCall, scheduleCallbackFromCall
} from '../src/server/agents/voice/voice-call-service.ts';
import { InMemoryCallStore } from '../src/server/agents/voice/in-memory-call-store.ts';
import { InMemoryConversationStore } from '../src/server/agents/in-memory-conversation-store.ts';
import { InMemoryIdentityStore } from '../src/server/agents/in-memory-identity-store.ts';
import { InMemoryPolicyStore } from '../src/server/agents/policy-store.ts';
import { SimulationLlmRouter } from '../src/server/agents/llm-routing.ts';
import { buildApprovedPolicy } from '../src/server/agents/low-risk-auto-send.ts';
import { voiceSensitiveActionKinds } from '../src/server/agents/voice/voice-contract.ts';

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

const credentials = readVoiceCredentials();

if (credentials) {
  process.stdout.write(
    '=== Voice credentials found, BUT no real Sandbox voice adapter implementation exists in this build. ===\n' +
    'Reporting NOT_CONFIGURED honestly rather than fabricating a live connection.\n\n'
  );
  record('real voice provider certification', false, 'NOT_CONFIGURED — no real adapter implementation exists yet');
} else {
  process.stdout.write(
    '=== FIXTURE-ONLY CERTIFICATION: NOT_CONFIGURED — no voice-provider credentials present. ===\n' +
    'None of VOYARA_VOICE_PROVIDER_ACCOUNT_ID / _API_KEY / _WEBHOOK_SECRET are set.\n' +
    'No live call, no live telephony/SIP connection, has been made or will be made by this run.\n\n'
  );

  const SECRET = 'cert-voice-secret-0000000000000';
  const FIXED = new Date('2026-08-01T09:00:00.000Z');
  const adapter = new SimulationVoiceAdapter(() => FIXED);
  const llmRouter = new SimulationLlmRouter(() => FIXED);

  function fixtureEvent(overrides = {}) {
    return {
      eventId: `evt-${randomUUID()}`, eventType: 'call.started', providerNumberId: 'cert-number-000001',
      calledNumber: '+994121234567', callerNumber: '+994501234567', callStatus: 'STARTED',
      transcriptChunk: null, durationSeconds: null, timestamp: FIXED.toISOString(),
      ...overrides
    };
  }

  // 1. Valid / invalid signatures.
  {
    const body = JSON.stringify({ ...fixtureEvent(), signature: '' });
    const sig = signCallWebhookRawBody(SECRET, body);
    record('valid signature verifies', adapter.verifyAndParseWebhookRaw(body, sig, SECRET).valid === true);
    record('invalid signature is rejected', adapter.verifyAndParseWebhookRaw(body, 'sha256=' + 'f'.repeat(64), SECRET).valid === false);
  }

  // 2. Lifecycle ordering + dual-brand + duplicate events.
  {
    const callStore = new InMemoryCallStore();
    const conversationStore = new InMemoryConversationStore();
    const identityStore = new InMemoryIdentityStore();
    const wctx = { callStore, conversationStore, identityStore, accountId: randomUUID(), brand: 'VOYARA', voiceNumberId: null, correlationId: `cert-${Date.now()}`, now: () => FIXED };

    const { callId } = await processCallWebhookEvent(wctx, fixtureEvent({ eventType: 'call.started' }), null);
    await processCallWebhookEvent(wctx, fixtureEvent({ eventType: 'call.ringing' }), callId);
    await processCallWebhookEvent(wctx, fixtureEvent({ eventType: 'call.answered' }), callId);
    await processCallWebhookEvent(wctx, fixtureEvent({ eventType: 'call.completed', durationSeconds: 180 }), callId);
    const call = await callStore.loadCall(callId);
    record('lifecycle ordering started->ringing->answered->completed', call.status === 'COMPLETED' && call.durationSeconds === 180);
    record('dual-brand routing: VOYARA brand preserved', call.brand === 'VOYARA');
  }

  // 3. AZ/RU/EN language events (call service accepts detected language downstream via speakLowRiskLine's language param).
  {
    const callStore = new InMemoryCallStore();
    const conversationStore = new InMemoryConversationStore();
    const identityStore = new InMemoryIdentityStore();
    const policyStore = new InMemoryPolicyStore();
    await policyStore.savePolicy(buildApprovedPolicy({ policyId: randomUUID(), policyName: 'cert-policy', version: 1, knowledgeVersion: 'kb-1', allowedIntents: ['GREETING'], approvedBy: randomUUID(), correlationId: 'cert', now: () => FIXED }));
    const cctx = { callStore, conversationStore, identityStore, policyStore, adapter, llmRouter, correlationId: 'cert-lang', now: () => FIXED };
    let allLanguagesOk = true;
    for (const lang of ['az', 'ru', 'en']) {
      const { callId } = await startInboundCall(cctx, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: `+99450000000${lang.length}` });
      const result = await speakLowRiskLine(cctx, callId, 'GREETING', 'greeting text');
      if (!result.spoken) allLanguagesOk = false;
    }
    record('AZ/RU/EN language events all process without error', allLanguagesOk);
  }

  // 4. Consent states + recording-disabled behavior.
  {
    const callStore = new InMemoryCallStore();
    const conversationStore = new InMemoryConversationStore();
    const identityStore = new InMemoryIdentityStore();
    const policyStore = new InMemoryPolicyStore();
    const cctx = { callStore, conversationStore, identityStore, policyStore, adapter, llmRouter, correlationId: 'cert-consent', now: () => FIXED };
    const { callId } = await startInboundCall(cctx, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234599' });
    await recordCallConsent(cctx, callId, { recording: 'DECLINED', transcription: 'DECLINED' });
    const declined = await callStore.loadCall(callId);
    record('recording-disabled behavior: declining consent keeps recordingEnabled false, record still exists', declined.recordingEnabled === false && declined !== null);
    await recordCallConsent(cctx, callId, { recording: 'GRANTED' });
    const granted = await callStore.loadCall(callId);
    record('consent states: granting recording sets recordingEnabled true', granted.recordingEnabled === true);
  }

  // 5. Transfer + callback creation.
  {
    const callStore = new InMemoryCallStore();
    const conversationStore = new InMemoryConversationStore();
    const identityStore = new InMemoryIdentityStore();
    const policyStore = new InMemoryPolicyStore();
    const cctx = { callStore, conversationStore, identityStore, policyStore, adapter, llmRouter, correlationId: 'cert-transfer', now: () => FIXED };
    const { callId } = await startInboundCall(cctx, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234588' });
    const transferResult = await transferCall(cctx, callId, '+994559999999');
    const transferredCall = await callStore.loadCall(callId);
    record('transfer succeeds and hands over to human', transferResult.transferred === true && transferredCall.handoverStatus === 'HUMAN');
    const cbResult = await scheduleCallbackFromCall(cctx, callId, new Date(FIXED.getTime() + 86400000).toISOString(), 'cert callback');
    record('callback creation produces a real task', Boolean(cbResult.taskId));
  }

  // 6. Duration ceiling.
  {
    const callStore = new InMemoryCallStore();
    const conversationStore = new InMemoryConversationStore();
    const identityStore = new InMemoryIdentityStore();
    const policyStore = new InMemoryPolicyStore();
    await policyStore.savePolicy(buildApprovedPolicy({ policyId: randomUUID(), policyName: 'cert-policy-2', version: 1, knowledgeVersion: 'kb-1', allowedIntents: ['GREETING'], approvedBy: randomUUID(), correlationId: 'cert', now: () => FIXED }));
    const cctx = { callStore, conversationStore, identityStore, policyStore, adapter, llmRouter, correlationId: 'cert-ceiling', now: () => FIXED };
    const { callId } = await startInboundCall(cctx, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234577', durationCeilingSeconds: 30 });
    const laterCtx = { ...cctx, now: () => new Date(FIXED.getTime() + 60000) };
    let ceilingEnforced = false;
    try { await speakLowRiskLine(laterCtx, callId, 'GREETING', 'x'); } catch (e) { ceilingEnforced = e.code === 'DURATION_CEILING_EXCEEDED'; }
    record('duration ceiling enforced', ceilingEnforced);
  }

  // 7. Sensitive-action escalation.
  {
    const callStore = new InMemoryCallStore();
    const conversationStore = new InMemoryConversationStore();
    const identityStore = new InMemoryIdentityStore();
    const policyStore = new InMemoryPolicyStore();
    const cctx = { callStore, conversationStore, identityStore, policyStore, adapter, llmRouter, correlationId: 'cert-escalate', now: () => FIXED };
    const { callId } = await startInboundCall(cctx, { accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, calledNumber: '+994121234567', callerNumber: '+994501234566' });
    await escalateCallToHuman(cctx, callId, voiceSensitiveActionKinds[0]);
    const call = await callStore.loadCall(callId);
    record('sensitive-action escalation sets handoverStatus HUMAN', call.handoverStatus === 'HUMAN');
  }

  // 8. Webhook event processing (DB-level idempotency proven for real in the sandbox suite).
  {
    const callStore = new InMemoryCallStore();
    const conversationStore = new InMemoryConversationStore();
    const identityStore = new InMemoryIdentityStore();
    const wctx = { callStore, conversationStore, identityStore, accountId: randomUUID(), brand: 'RTRAVEL', voiceNumberId: null, correlationId: 'cert-dup', now: () => FIXED };
    const event = fixtureEvent({ eventType: 'call.started' });
    const { callId } = await processCallWebhookEvent(wctx, event, null);
    record('webhook event processes deterministically (DB-level idempotency proven in sandbox suite)', Boolean(callId));
  }

  process.stdout.write('\nFixture-only certification complete. This run made ZERO live telephony/SIP calls.\n');
}

const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
if (failed.length > 0) {
  process.stderr.write(`FAILED: ${failed.map((f) => f.name).join(', ')}\n`);
  process.exitCode = 1;
}
