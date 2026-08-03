import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import { SYSTEM_ACTOR_ID } from '../business-account';
import type { ConversationStore } from '../conversation-store';
import type { IdentityStore } from '../identity-store';
import { autoLinkIdentity, type IdentityLinkingContext } from '../identity-linking';
import type { PolicyStore } from '../policy-store';
import { policyHashInput } from '../risk-policy-contract';
import type { LlmRouter } from '../llm-routing';
import { sendLowRiskMessage, type LowRiskAutoSendContext } from '../low-risk-auto-send';
import type { VoiceAdapter } from './voice-adapter';
import type { CallStore } from './call-store';
import {
  VoiceAuthorityError,
  type Call,
  type CallLanguage,
  type VoiceLowRiskIntent
} from './voice-contract';

/**
 * Phase 4D — voice call service.
 *
 * Reuses, rather than duplicates, three pieces of Phase 4C infrastructure:
 *   1. `PolicyStore` / `policyHashInput` — the exact same founder-approved,
 *      hash-verified policy table `message_send_policies` gates low-risk
 *      voice speech, not a separate, less-controlled voice policy.
 *   2. `LlmRouter` — voice content generation goes through the same
 *      provider-neutral, spending-ceiling-enforced router as chat/WhatsApp,
 *      never a separate uncontrolled AI path.
 *   3. `sendLowRiskMessage` / `IdentityStore` / `autoLinkIdentity` — the
 *      WhatsApp follow-up this service can trigger goes through the
 *      existing, already-approved chat/WhatsApp send path unchanged; a call
 *      never gets its own shortcut to send an outbound message.
 *
 * Every sensitive action the founder listed — final price/discount,
 * proposal approval, supplier availability commitment, payment link,
 * booking, ticket issuance, change, cancellation, refund, liability
 * complaint, medical/legal/emergency claim, exceptional promise — has no
 * function anywhere in this file that can execute it. The only actions this
 * service can take are: speak a policy-authorized low-risk line, transfer to
 * a human, end the call, schedule a callback, and (optionally, itself
 * low-risk-policy-gated) send a WhatsApp follow-up.
 */

export type VoiceCallContext = {
  callStore: CallStore;
  conversationStore: ConversationStore;
  identityStore: IdentityStore;
  policyStore: PolicyStore;
  adapter: VoiceAdapter;
  llmRouter: LlmRouter;
  correlationId: string;
  now: () => Date;
};

const DEFAULT_DURATION_CEILING_SECONDS = 900; // 15 minutes — a sane default; overridable per deployment.

async function audit(ctx: VoiceCallContext, callId: string, kind: string, reasonCode?: string): Promise<void> {
  await ctx.callStore.recordCallEvent({ eventId: randomUUID(), callId, kind, actorId: SYSTEM_ACTOR_ID, actorKind: 'system', correlationId: ctx.correlationId, reasonCode: reasonCode ?? null });
}

/** Starts a call record for a genuinely verified inbound webhook (signature
 *  already checked by the caller — see the webhook route). Auto-links the
 *  caller's phone number as a verified TELEPHONE identity — the channel
 *  itself proves the number, same rule already established for WhatsApp. */
export async function startInboundCall(
  ctx: VoiceCallContext,
  params: { accountId: string; brand: 'RTRAVEL' | 'VOYARA'; voiceNumberId: string | null; calledNumber: string; callerNumber: string; durationCeilingSeconds?: number }
): Promise<{ callId: string; conversationId: string }> {
  const existingIdentity = await ctx.identityStore.findByExternalId('TELEPHONE', params.callerNumber);
  let contactId: string;
  if (existingIdentity) {
    contactId = existingIdentity.contactId;
  } else {
    contactId = randomUUID();
    await ctx.conversationStore.upsertContact({
      contactId, accountId: params.accountId, linkedCustomerId: null, displayName: null,
      phone: params.callerNumber, email: null, instagramHandle: null, preferredLocale: null
    });
    const identityCtx: IdentityLinkingContext = { store: ctx.identityStore, actor: { id: 'system', assuranceLevel: 'aal2' }, correlationId: ctx.correlationId, now: ctx.now };
    await autoLinkIdentity(identityCtx, { contactId, identityKind: 'TELEPHONE', externalId: params.callerNumber, linkedVia: 'AUTO_VERIFIED_PHONE', correlationId: ctx.correlationId });
  }

  const conversationId = randomUUID();
  await ctx.conversationStore.createConversation({
    conversationId, accountId: params.accountId, contactId, channel: 'VOICE', status: 'OPEN',
    assignedAgentRole: null, relatedQuoteId: null, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString()
  });

  const callId = randomUUID();
  const call: Call = {
    callId, conversationId, contactId, voiceNumberId: params.voiceNumberId, brand: params.brand,
    calledNumber: params.calledNumber, callerNumber: params.callerNumber, status: 'STARTED',
    detectedLanguage: null, durationSeconds: null, transcript: null, aiSummary: null, urgency: null,
    transferStatus: null, assignedOwnerId: null, handoverStatus: 'AI',
    consent: { aiDisclosure: 'NOT_ASKED', recording: 'NOT_ASKED', transcription: 'NOT_ASKED', crmStorage: 'NOT_ASKED', followUp: 'NOT_ASKED' },
    recordingEnabled: false, modelTier: null, modelName: null, estimatedCostMinorUnits: null,
    durationCeilingSeconds: params.durationCeilingSeconds ?? DEFAULT_DURATION_CEILING_SECONDS,
    correlationId: ctx.correlationId, startedAt: ctx.now().toISOString(), endedAt: null
  };
  await ctx.callStore.saveCall(call);
  await audit(ctx, callId, 'CALL_STARTED');
  return { callId, conversationId };
}

/** Records one consent decision. Recording/transcription can be declined or
 *  not asked; a minimal operational call record (call row itself: brand,
 *  numbers, status, duration) is always preserved regardless — only the
 *  transcript/recording-specific fields depend on consent. */
export async function recordCallConsent(
  ctx: VoiceCallContext,
  callId: string,
  consent: Partial<Call['consent']>
): Promise<void> {
  const call = await ctx.callStore.loadCall(callId);
  if (!call) throw new VoiceAuthorityError('Call not found.', 'NOT_FOUND');
  const updated: Call = {
    ...call,
    consent: { ...call.consent, ...consent },
    recordingEnabled: (consent.recording ?? call.consent.recording) === 'GRANTED'
  };
  await ctx.callStore.saveCall(updated);
  await audit(ctx, callId, 'CONSENT_RECORDED');
}

/** Speaks one policy-authorized low-risk line. Requires an active,
 *  hash-verified policy whose allowedIntents includes this voice intent —
 *  checked at speak time, identical discipline to `sendLowRiskMessage`. */
export async function speakLowRiskLine(
  ctx: VoiceCallContext,
  callId: string,
  intent: VoiceLowRiskIntent,
  text: string
): Promise<{ spoken: boolean }> {
  const call = await ctx.callStore.loadCall(callId);
  if (!call) throw new VoiceAuthorityError('Call not found.', 'NOT_FOUND');
  if (!call.durationSeconds && call.durationCeilingSeconds) {
    const elapsed = (ctx.now().getTime() - Date.parse(call.startedAt)) / 1000;
    if (elapsed > call.durationCeilingSeconds) {
      throw new VoiceAuthorityError('Call duration ceiling exceeded — must escalate or end.', 'DURATION_CEILING_EXCEEDED');
    }
  }

  const policy = await ctx.policyStore.loadActivePolicy();
  if (!policy) throw new VoiceAuthorityError('No active message-send policy — voice auto-speak is refused.', 'VALIDATION');
  if (!(policy.allowedIntents as string[]).includes(intent)) {
    throw new VoiceAuthorityError(`Intent "${intent}" is not authorized by the active policy.`, 'VALIDATION');
  }
  const recomputedHash = sha256(policyHashInput({ policyName: policy.policyName, version: policy.version, knowledgeVersion: policy.knowledgeVersion, allowedIntents: policy.allowedIntents }));
  if (recomputedHash !== policy.policyHash) {
    throw new VoiceAuthorityError('The active policy\'s content hash no longer matches what was approved — refusing to speak.', 'VALIDATION');
  }

  const result = await ctx.adapter.speak(call.callId, text, (call.detectedLanguage ?? 'en') as CallLanguage);
  await audit(ctx, callId, 'LOW_RISK_LINE_SPOKEN', intent);
  return { spoken: result.ok };
}

/** Escalates to a human — the only response available for any sensitive
 *  action. Sets handoverStatus to HUMAN; does not itself perform the
 *  sensitive action, which always requires the existing HAG-gated services
 *  (approveQuote, approvePaymentLink, prepareBooking, etc.) used directly by
 *  a human, never through this file. */
export async function escalateCallToHuman(ctx: VoiceCallContext, callId: string, reasonCode: string): Promise<void> {
  const call = await ctx.callStore.loadCall(callId);
  if (!call) throw new VoiceAuthorityError('Call not found.', 'NOT_FOUND');
  await ctx.callStore.saveCall({ ...call, handoverStatus: 'HUMAN' });
  await audit(ctx, callId, 'CALL_ESCALATED_TO_HUMAN', reasonCode);
}

export async function transferCall(ctx: VoiceCallContext, callId: string, destinationNumber: string): Promise<{ transferred: boolean }> {
  const call = await ctx.callStore.loadCall(callId);
  if (!call) throw new VoiceAuthorityError('Call not found.', 'NOT_FOUND');
  const result = await ctx.adapter.transferCall(call.callId, destinationNumber);
  await ctx.callStore.saveCall({ ...call, status: 'TRANSFERRED', transferStatus: `TRANSFERRED_TO:${destinationNumber}`, handoverStatus: 'HUMAN' });
  await audit(ctx, callId, 'CALL_TRANSFERRED', destinationNumber);
  return { transferred: result.ok };
}

export async function scheduleCallbackFromCall(ctx: VoiceCallContext, callId: string, dueAt: string, notes: string | null): Promise<{ taskId: string }> {
  const call = await ctx.callStore.loadCall(callId);
  if (!call) throw new VoiceAuthorityError('Call not found.', 'NOT_FOUND');
  const taskId = randomUUID();
  await ctx.callStore.createCallbackTask({
    taskId, callId, contactId: call.contactId, dueAt, status: 'PENDING', assignedOwnerId: null, notes, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString()
  });
  await audit(ctx, callId, 'CALLBACK_SCHEDULED');
  return { taskId };
}

/** Optionally triggers an approved WhatsApp follow-up — reuses
 *  `sendLowRiskMessage` (Phase 4C) completely unchanged. This function does
 *  not construct or send anything itself; it only delegates. */
export async function triggerWhatsAppFollowUp(
  lowRiskCtx: LowRiskAutoSendContext,
  waConversationId: string,
  intentChatEquivalent: 'GREETING' | 'FAQ' | 'CALLBACK_SCHEDULING' | 'COLLECT_TRIP_DETAILS',
  body: string,
  modelName: string,
  contactExternalId: string
): Promise<{ messageId: string; sent: boolean }> {
  return sendLowRiskMessage(
    lowRiskCtx,
    { conversationId: waConversationId, agentRole: 'concierge', intent: intentChatEquivalent, body, modelName, correlationId: lowRiskCtx.correlationId },
    contactExternalId
  );
}

export async function endCall(ctx: VoiceCallContext, callId: string, durationSeconds: number): Promise<void> {
  const call = await ctx.callStore.loadCall(callId);
  if (!call) throw new VoiceAuthorityError('Call not found.', 'NOT_FOUND');
  await ctx.adapter.endCall(call.callId);
  await ctx.callStore.saveCall({ ...call, status: 'COMPLETED', durationSeconds, endedAt: ctx.now().toISOString() });
  await ctx.conversationStore.updateConversationStatus(call.conversationId, 'RESOLVED', ctx.now().toISOString());
  await audit(ctx, callId, 'CALL_COMPLETED');
}
