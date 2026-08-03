import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SupabaseJourneyServicePorts } from '@/server/agents/automation/production-journey-ports';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { InMemoryQuoteStore } from '@/server/supplier/in-memory-quote-store';
import { InMemoryPaymentLinkStore } from '@/server/payment/in-memory-payment-link-store';
import { InMemoryPortalTaskStore } from '@/server/agents/supplier-ops/portal-task-store';
import { InMemoryPlanStore } from '@/server/agents/subscriptions/plan-store';
import type { SubscriptionContextLoader } from '@/server/agents/subscriptions/subscription-context-queries';
import {
  sendCoordinatedReply, normalizeInboundEvent, processInboundEvent, type ChannelWiringContext
} from '@/server/agents/automation/channel-adapter-wiring';
import { InMemoryChannelCoordinationStore, ChannelCoordinationError, type ConversationCoordinationState } from '@/server/agents/automation/channel-coordination';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { SimulationChannelAdapter } from '@/server/agents/simulation-channel-adapter';

const FIXED = new Date('2026-08-01T09:00:00.000Z');
const NO_EXISTING_SUBSCRIPTION: SubscriptionContextLoader = { loadPersonal: async () => null, loadCorporate: async () => null };

function makeJourneyPorts() {
  return new SupabaseJourneyServicePorts(
    { correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED, actorId: 'system', actorKind: 'system' },
    {
      conversationStore: new InMemoryConversationStore(), quoteStore: new InMemoryQuoteStore(), paymentLinkStore: new InMemoryPaymentLinkStore(),
      portalTaskStore: new InMemoryPortalTaskStore(), planStore: new InMemoryPlanStore(), subscriptionContextLoader: NO_EXISTING_SUBSCRIPTION
    }
  );
}

class CombinedWiringStore extends InMemoryAutomationStore {
  private readonly coordination = new InMemoryChannelCoordinationStore();
  private readonly featureFlags = new Map<string, { flagCode: string; enabled: boolean }>();
  seedConversation(state: ConversationCoordinationState) { this.coordination.seedConversation(state); }
  async loadConversationState(id: string) { return this.coordination.loadConversationState(id); }
  async saveConversationState(state: ConversationCoordinationState) { return this.coordination.saveConversationState(state); }
  async reserveReplyEvent(key: string) { return this.coordination.reserveReplyEvent(key); }
  async reserveInboundEvent(key: string) { return this.coordination.reserveInboundEvent(key); }
  async recordDeliveryStatusEvent(event: Parameters<InMemoryChannelCoordinationStore['recordDeliveryStatusEvent']>[0]) { return this.coordination.recordDeliveryStatusEvent(event); }
  async loadWorkingHoursPolicy() { return null; }
  async saveWorkingHoursPolicy() { /* unused */ }
  async findActiveWorkingHoursPolicyByCode() { return null; }
  async loadFeatureFlag(flagCode: string) { return this.featureFlags.get(flagCode) ?? null; }
  async saveFeatureFlag(flag: { flagCode: string; enabled: boolean }) { this.featureFlags.set(flag.flagCode, flag); }
  async recordFounderControlEvent() { /* unused */ }
}

function wiringCtx(): ChannelWiringContext & { store: CombinedWiringStore } {
  const store = new CombinedWiringStore();
  return { store, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

function baseConversation(overrides: Partial<ConversationCoordinationState> = {}): ConversationCoordinationState {
  return {
    conversationId: randomUUID(), channel: 'WHATSAPP', customerFacingBrand: 'VOYARA', handoverStatus: 'AI',
    preferredLocale: 'az', lastInboundAt: FIXED.toISOString(), lastOutboundAt: null, consentGranted: true,
    ...overrides
  };
}

test('an AZ-resolved conversation only ever accepts an AZ reply, even after real journey-port draft preparation', async () => {
  const journeyPorts = makeJourneyPorts();
  const wCtx = wiringCtx();
  const conversation = baseConversation({ preferredLocale: 'az' });
  wCtx.store.seedConversation(conversation);

  const draft = await journeyPorts.prepareOutboundDraft(randomUUID(), 'post_trip');
  assert.ok(draft.draftMessageId);

  const azResult = await sendCoordinatedReply(wCtx, {
    conversationId: conversation.conversationId, replyIntentId: draft.draftMessageId, replyBody: 'Salam!',
    replyLocale: 'az', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null
  }, new SimulationChannelAdapter());
  assert.equal(azResult.sent, true);
});

test('a RU-resolved conversation refuses an AZ or EN reply attempt — no language mixing survives into production delivery', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ preferredLocale: 'ru' });
  wCtx.store.seedConversation(conversation);

  await assert.rejects(
    () => sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId: `intent-${randomUUID()}`, replyBody: 'Salam!', replyLocale: 'az', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'LANGUAGE_MIXING_REJECTED'
  );
  await assert.rejects(
    () => sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId: `intent-${randomUUID()}`, replyBody: 'Hello!', replyLocale: 'en', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'LANGUAGE_MIXING_REJECTED'
  );
});

test('an EN-resolved conversation accepts only EN, never AZ or RU', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ preferredLocale: 'en' });
  wCtx.store.seedConversation(conversation);
  const result = await sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId: `intent-${randomUUID()}`, replyBody: 'Hello!', replyLocale: 'en', replyBrand: 'VOYARA', source: 'WEB_CHAT', agentCode: null });
  assert.equal(result.sent, true);
});

test('an R-Travel-originated conversation only ever accepts an R-Travel-branded reply', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ customerFacingBrand: 'RTRAVEL', channel: 'INSTAGRAM_DM', preferredLocale: 'az' });
  wCtx.store.seedConversation(conversation);
  const result = await sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId: `intent-${randomUUID()}`, replyBody: 'Salam!', replyLocale: 'az', replyBrand: 'RTRAVEL', source: 'RTRAVEL_INSTAGRAM', agentCode: null });
  assert.equal(result.sent, true);
});

test('a VOYARA-originated conversation refuses an R-Travel-branded reply — brand never crosses over', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ customerFacingBrand: 'VOYARA', channel: 'INSTAGRAM_DM', preferredLocale: 'az' });
  wCtx.store.seedConversation(conversation);
  await assert.rejects(
    () => sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId: `intent-${randomUUID()}`, replyBody: 'Salam!', replyLocale: 'az', replyBrand: 'RTRAVEL', source: 'VOYARA_INSTAGRAM', agentCode: null }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'BRAND_MISMATCH'
  );
});

test('inbound-event processing preserves the exact conversation and brand context across the full inbound normalization chain', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ customerFacingBrand: 'RTRAVEL', channel: 'INSTAGRAM_DM' });
  wCtx.store.seedConversation(conversation);
  const event = normalizeInboundEvent('RTRAVEL_INSTAGRAM', { externalMessageId: `msg-${randomUUID()}`, externalContactId: randomUUID(), detectedLocale: 'az', receivedAt: FIXED.toISOString() });
  const resolvedState = await processInboundEvent(wCtx, event, conversation.conversationId);
  assert.equal(resolvedState.customerFacingBrand, 'RTRAVEL');
  assert.equal(resolvedState.conversationId, conversation.conversationId);
});

test('two different channels racing to reply to the same correlated intent — the losing channel cannot substitute a different language or brand', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ preferredLocale: 'en', customerFacingBrand: 'VOYARA' });
  wCtx.store.seedConversation(conversation);
  const replyIntentId = `intent-${randomUUID()}`;

  const first = await sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId, replyBody: 'Hello!', replyLocale: 'en', replyBrand: 'VOYARA', source: 'WEB_CHAT', agentCode: null });
  assert.equal(first.sent, true);

  await assert.rejects(
    () => sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId, replyBody: 'Salam!', replyLocale: 'az', replyBrand: 'RTRAVEL', source: 'WHATSAPP', agentCode: null }),
    (e: unknown) => e instanceof ChannelCoordinationError
  );
});

test('human takeover prevents automated delivery through the production send boundary', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ handoverStatus: 'HUMAN' });
  wCtx.store.seedConversation(conversation);
  await assert.rejects(
    () => sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId: `intent-${randomUUID()}`, replyBody: 'Salam!', replyLocale: 'az', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'HUMAN_TAKEOVER_ACTIVE'
  );
});

test('release restores eligible automation — a released conversation accepts an automated reply again', async () => {
  const wCtx = wiringCtx();
  const conversation = baseConversation({ handoverStatus: 'AI' });
  wCtx.store.seedConversation(conversation);
  const result = await sendCoordinatedReply(wCtx, { conversationId: conversation.conversationId, replyIntentId: `intent-${randomUUID()}`, replyBody: 'Salam!', replyLocale: 'az', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null });
  assert.equal(result.sent, true);
});
