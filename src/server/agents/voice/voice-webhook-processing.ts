import { randomUUID } from 'node:crypto';
import type { CallStore } from './call-store';
import type { ConversationStore } from '../conversation-store';
import type { IdentityStore } from '../identity-store';
import { startInboundCall } from './voice-call-service';
import { SYSTEM_ACTOR_ID } from '../business-account';
import type { InboundCallWebhook } from './voice-adapter';
import type { Call } from './voice-contract';

/**
 * Phase 4D — normalizes a verified inbound call webhook event into the
 * `calls` table. Deliberately separate from voice-call-service.ts (not an
 * edit to it): webhook events are passive OBSERVATIONS of what already
 * happened on the provider side (the call rang, was answered, ended) — they
 * update state directly, they don't go through the AI-authority functions
 * in voice-call-service.ts, which govern what VOYARA's own AI is permitted
 * to DO during a live call. The one exception is `call.started`, which
 * genuinely does need to create the call record — that reuses
 * `startInboundCall` from voice-call-service.ts unchanged, not a copy.
 * (`startInboundCall`'s context type also carries policyStore/adapter/
 * llmRouter fields it never reads for a plain call-start — those are
 * supplied as harmless placeholders here rather than widening that
 * function's already-tested signature.)
 *
 * The caller (the webhook route) is responsible for signature verification
 * BEFORE calling this — this function assumes the payload it receives has
 * already been verified.
 */

export type CallWebhookProcessingContext = {
  callStore: CallStore;
  conversationStore: ConversationStore;
  identityStore: IdentityStore;
  accountId: string;
  brand: 'RTRAVEL' | 'VOYARA';
  voiceNumberId: string | null;
  correlationId: string;
  now: () => Date;
};

export async function processCallWebhookEvent(
  ctx: CallWebhookProcessingContext,
  event: InboundCallWebhook,
  knownCallId: string | null
): Promise<{ callId: string }> {
  if (event.eventType === 'call.started' || !knownCallId) {
    const { callId } = await startInboundCall(
      {
        callStore: ctx.callStore, conversationStore: ctx.conversationStore, identityStore: ctx.identityStore,
        policyStore: undefined as never, adapter: undefined as never, llmRouter: undefined as never,
        correlationId: ctx.correlationId, now: ctx.now
      },
      { accountId: ctx.accountId, brand: ctx.brand, voiceNumberId: ctx.voiceNumberId, calledNumber: event.calledNumber, callerNumber: event.callerNumber }
    );
    await ctx.callStore.recordCallEvent({ eventId: randomUUID(), callId, kind: `WEBHOOK_${event.eventType.toUpperCase()}`, actorId: SYSTEM_ACTOR_ID, actorKind: 'system', correlationId: ctx.correlationId });
    return { callId };
  }

  const call = await ctx.callStore.loadCall(knownCallId);
  if (!call) throw new Error('CALL_NOT_FOUND_FOR_WEBHOOK_EVENT');

  const statusMap: Record<InboundCallWebhook['eventType'], Call['status'] | null> = {
    'call.started': 'STARTED',
    'call.ringing': 'RINGING',
    'call.answered': 'ANSWERED',
    'call.transferred': 'TRANSFERRED',
    'call.completed': 'COMPLETED',
    'call.failed': 'FAILED',
    'call.transcript_chunk': null
  };
  const nextStatus = statusMap[event.eventType];

  const updated: Call = {
    ...call,
    status: nextStatus ?? call.status,
    durationSeconds: event.durationSeconds ?? call.durationSeconds,
    transcript: event.transcriptChunk ? `${call.transcript ?? ''}${call.transcript ? ' ' : ''}${event.transcriptChunk}` : call.transcript,
    endedAt: nextStatus === 'COMPLETED' || nextStatus === 'FAILED' ? ctx.now().toISOString() : call.endedAt
  };
  await ctx.callStore.saveCall(updated);
  await ctx.callStore.recordCallEvent({ eventId: randomUUID(), callId: knownCallId, kind: `WEBHOOK_${event.eventType.toUpperCase()}`, actorId: SYSTEM_ACTOR_ID, actorKind: 'system', correlationId: ctx.correlationId });
  return { callId: knownCallId };
}
