import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  guardAgainstDuplicateInbound, guardAgainstDuplicateReply, requireNoHumanTakeover, takeOverConversation, releaseConversation,
  resolveReplyLocale, assertBrandConsistency, requireConsentGranted, recordDeliveryStatus, isUnansweredPastSla,
  InMemoryChannelCoordinationStore, ChannelCoordinationError, type ChannelCoordinationContext, type ConversationCoordinationState
} from '@/server/agents/automation/channel-coordination';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): ChannelCoordinationContext & { store: InMemoryChannelCoordinationStore } {
  return { store: new InMemoryChannelCoordinationStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

function baseState(overrides: Partial<ConversationCoordinationState> = {}): ConversationCoordinationState {
  return {
    conversationId: randomUUID(), channel: 'WHATSAPP', customerFacingBrand: 'VOYARA', handoverStatus: 'AI',
    preferredLocale: 'az', lastInboundAt: FIXED.toISOString(), lastOutboundAt: null, consentGranted: true,
    ...overrides
  };
}

test('a single correlated customer event never generates duplicate replies through two channels', async () => {
  const c = ctx();
  const correlationKey = `${randomUUID()}:reply-intent-1`;
  await guardAgainstDuplicateReply(c, correlationKey);
  await assert.rejects(
    () => guardAgainstDuplicateReply(c, correlationKey),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'DUPLICATE_REPLY'
  );
});

test('two genuinely different correlated events are never blocked by each other', async () => {
  const c = ctx();
  await guardAgainstDuplicateReply(c, `${randomUUID()}:reply-intent-a`);
  await assert.doesNotReject(() => guardAgainstDuplicateReply(c, `${randomUUID()}:reply-intent-b`));
});

test('a duplicate inbound webhook event is rejected, never processed twice', async () => {
  const c = ctx();
  const eventKey = `evt-${randomUUID()}`;
  await guardAgainstDuplicateInbound(c, eventKey);
  await assert.rejects(
    () => guardAgainstDuplicateInbound(c, eventKey),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'DUPLICATE_INBOUND'
  );
});

test('human takeover blocks automated replies for that conversation', async () => {
  const c = ctx();
  const state = baseState({ handoverStatus: 'AI' });
  c.store.seedConversation(state);
  const staff = randomUUID();
  await takeOverConversation(c, state.conversationId, staff);
  await assert.rejects(
    () => requireNoHumanTakeover(c, state.conversationId),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'HUMAN_TAKEOVER_ACTIVE'
  );
});

test('takeOverConversation refuses without a real human staff actor', async () => {
  const c = ctx();
  const state = baseState();
  c.store.seedConversation(state);
  await assert.rejects(
    () => takeOverConversation(c, state.conversationId, ''),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'VALIDATION'
  );
});

test('releasing a conversation after human takeover restores automation eligibility', async () => {
  const c = ctx();
  const state = baseState({ handoverStatus: 'AI' });
  c.store.seedConversation(state);
  const staff = randomUUID();
  await takeOverConversation(c, state.conversationId, staff);
  await releaseConversation(c, state.conversationId, staff);
  const resolved = await requireNoHumanTakeover(c, state.conversationId);
  assert.equal(resolved.handoverStatus, 'AI');
});

test('releaseConversation refuses without a real human staff actor', async () => {
  const c = ctx();
  const state = baseState({ handoverStatus: 'HUMAN' });
  c.store.seedConversation(state);
  await assert.rejects(
    () => releaseConversation(c, state.conversationId, ''),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'VALIDATION'
  );
});

test('a reply in the conversation\'s own resolved locale is accepted', () => {
  const resolved = resolveReplyLocale('az', 'az');
  assert.equal(resolved, 'az');
});

test('a reply in a DIFFERENT locale than the conversation\'s resolved locale is rejected as language mixing', () => {
  assert.throws(
    () => resolveReplyLocale('az', 'ru'),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'LANGUAGE_MIXING_REJECTED'
  );
});

test('an unsupported locale is rejected outright', () => {
  assert.throws(
    () => resolveReplyLocale('en', 'fr'),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'LANGUAGE_MIXING_REJECTED'
  );
});

test('a reply prepared under the same brand as the conversation is accepted', () => {
  assert.doesNotThrow(() => assertBrandConsistency('RTRAVEL', 'RTRAVEL'));
});

test('a reply prepared under a DIFFERENT brand than the conversation is rejected', () => {
  assert.throws(
    () => assertBrandConsistency('RTRAVEL', 'VOYARA'),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'BRAND_MISMATCH'
  );
});

test('an automated reply is blocked when no consent is on file', () => {
  const state = baseState({ consentGranted: false });
  assert.throws(
    () => requireConsentGranted(state),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'CONSENT_NOT_GRANTED'
  );
});

test('an automated reply proceeds when consent is on file', () => {
  const state = baseState({ consentGranted: true });
  assert.doesNotThrow(() => requireConsentGranted(state));
});

test('recording a delivery status creates a real, attributable event', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  await recordDeliveryStatus(c, conversationId, 'WHATSAPP', 'DELIVERED', null);
  const events = c.store.deliveryEventsFor(conversationId);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'DELIVERED');
});

test('a HUMAN-handover conversation with an old unanswered inbound message is flagged past SLA', () => {
  const oldInbound = new Date(FIXED.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const state = baseState({ handoverStatus: 'HUMAN', lastInboundAt: oldInbound, lastOutboundAt: null });
  assert.equal(isUnansweredPastSla(state, FIXED, 60), true);
});

test('a conversation already answered after the inbound message is NOT flagged past SLA', () => {
  const oldInbound = new Date(FIXED.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const recentOutbound = new Date(FIXED.getTime() - 30 * 60 * 1000).toISOString();
  const state = baseState({ handoverStatus: 'HUMAN', lastInboundAt: oldInbound, lastOutboundAt: recentOutbound });
  assert.equal(isUnansweredPastSla(state, FIXED, 60), false);
});

test('an AI-handover conversation is never flagged for human SLA escalation', () => {
  const oldInbound = new Date(FIXED.getTime() - 5 * 60 * 60 * 1000).toISOString();
  const state = baseState({ handoverStatus: 'AI', lastInboundAt: oldInbound, lastOutboundAt: null });
  assert.equal(isUnansweredPastSla(state, FIXED, 60), false);
});

test('a recent unanswered inbound message within the SLA window is not yet flagged', () => {
  const recentInbound = new Date(FIXED.getTime() - 10 * 60 * 1000).toISOString();
  const state = baseState({ handoverStatus: 'HUMAN', lastInboundAt: recentInbound, lastOutboundAt: null });
  assert.equal(isUnansweredPastSla(state, FIXED, 60), false);
});
