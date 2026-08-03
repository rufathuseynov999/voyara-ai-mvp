import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  normalizeInboundEvent, processInboundEvent, sendCoordinatedReply, channelSources, type ChannelWiringContext, type ChannelSource
} from '@/server/agents/automation/channel-adapter-wiring';
import { InMemoryChannelCoordinationStore, ChannelCoordinationError, type ConversationCoordinationState } from '@/server/agents/automation/channel-coordination';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { pauseChannel } from '@/server/agents/automation/automation-service';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';
import { SimulationChannelAdapter } from '@/server/agents/simulation-channel-adapter';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

class CombinedStore extends InMemoryAutomationStore {
  private readonly coordination = new InMemoryChannelCoordinationStore();
  private readonly featureFlags = new Map<string, { flagCode: string; enabled: boolean }>();
  private readonly controlEvents: unknown[] = [];

  seedConversation(state: ConversationCoordinationState) { this.coordination.seedConversation(state); }
  async loadConversationState(id: string) { return this.coordination.loadConversationState(id); }
  async saveConversationState(state: ConversationCoordinationState) { return this.coordination.saveConversationState(state); }
  async reserveReplyEvent(key: string) { return this.coordination.reserveReplyEvent(key); }
  async reserveInboundEvent(key: string) { return this.coordination.reserveInboundEvent(key); }
  async recordDeliveryStatusEvent(event: Parameters<InMemoryChannelCoordinationStore['recordDeliveryStatusEvent']>[0]) { return this.coordination.recordDeliveryStatusEvent(event); }
  deliveryEventsFor(id: string) { return this.coordination.deliveryEventsFor(id); }

  async loadWorkingHoursPolicy() { return null; }
  async saveWorkingHoursPolicy() { /* not used in these tests */ }
  async findActiveWorkingHoursPolicyByCode() { return null; }
  async loadFeatureFlag(flagCode: string) { return this.featureFlags.get(flagCode) ?? null; }
  async saveFeatureFlag(flag: { flagCode: string; enabled: boolean }) { this.featureFlags.set(flag.flagCode, flag); }
  async recordFounderControlEvent(event: unknown) { this.controlEvents.push(event); }
}

function ctx(): ChannelWiringContext & { store: CombinedStore } {
  const store = new CombinedStore();
  return { store, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

function baseState(overrides: Partial<ConversationCoordinationState> = {}): ConversationCoordinationState {
  return {
    conversationId: randomUUID(), channel: 'WHATSAPP', customerFacingBrand: 'VOYARA', handoverStatus: 'AI',
    preferredLocale: 'az', lastInboundAt: FIXED.toISOString(), lastOutboundAt: null, consentGranted: true,
    ...overrides
  };
}

test('every customer-facing source normalizes to the canonical event shape with a real channel and brand', () => {
  const customerSources: ChannelSource[] = ['RTRAVEL_INSTAGRAM', 'VOYARA_INSTAGRAM', 'WHATSAPP', 'WEB_CHAT', 'VOICE'];
  for (const source of customerSources) {
    const event = normalizeInboundEvent(source, { externalMessageId: 'msg-1', externalContactId: 'ext-1', detectedLocale: 'az', receivedAt: FIXED.toISOString() });
    assert.equal(event.source, source);
    assert.ok(event.channel);
    assert.ok(event.brand);
    assert.ok(event.correlationId);
    assert.ok(event.eventId);
  }
});

test('R-Travel Instagram and VOYARA Instagram share the same channel kind but carry distinct brand identity', () => {
  const rtravel = normalizeInboundEvent('RTRAVEL_INSTAGRAM', { externalMessageId: 'm1', externalContactId: 'c1', detectedLocale: 'ru', receivedAt: FIXED.toISOString() });
  const voyara = normalizeInboundEvent('VOYARA_INSTAGRAM', { externalMessageId: 'm2', externalContactId: 'c2', detectedLocale: 'ru', receivedAt: FIXED.toISOString() });
  assert.equal(rtravel.channel, 'INSTAGRAM_DM');
  assert.equal(voyara.channel, 'INSTAGRAM_DM');
  assert.equal(rtravel.brand, 'RTRAVEL');
  assert.equal(voyara.brand, 'VOYARA');
});

test('STAFF_CONSOLE is not a normalizable inbound customer-message source', () => {
  assert.throws(
    () => normalizeInboundEvent('STAFF_CONSOLE', { externalMessageId: 'm', externalContactId: 'c', detectedLocale: 'en', receivedAt: FIXED.toISOString() }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'VALIDATION'
  );
});

test('every declared channel source is accounted for in the exported list', () => {
  assert.equal(channelSources.length, 6);
});

test('processInboundEvent rejects an inbound event whose brand does not match the conversation\'s own brand', async () => {
  const c = ctx();
  const conversation = baseState({ customerFacingBrand: 'RTRAVEL' });
  c.store.seedConversation(conversation);
  const event = normalizeInboundEvent('VOYARA_INSTAGRAM', { externalMessageId: 'm1', externalContactId: 'c1', detectedLocale: 'az', receivedAt: FIXED.toISOString() });
  await assert.rejects(
    () => processInboundEvent(c, event, conversation.conversationId),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'BRAND_MISMATCH'
  );
});

test('processInboundEvent rejects a duplicate inbound event for the same source+externalMessageId', async () => {
  const c = ctx();
  const conversation = baseState({ customerFacingBrand: 'VOYARA' });
  c.store.seedConversation(conversation);
  const event = normalizeInboundEvent('WHATSAPP', { externalMessageId: 'dup-msg', externalContactId: 'c1', detectedLocale: 'az', receivedAt: FIXED.toISOString() });
  await processInboundEvent(c, event, conversation.conversationId);
  await assert.rejects(
    () => processInboundEvent(c, event, conversation.conversationId),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'DUPLICATE_INBOUND'
  );
});

test('two different simulated sources racing to reply to the same correlated intent — only one actually sends', async () => {
  const c = ctx();
  const conversation = baseState({ customerFacingBrand: 'VOYARA', preferredLocale: 'en' });
  c.store.seedConversation(conversation);

  const replyIntentId = `intent-${randomUUID()}`;
  const first = await sendCoordinatedReply(c, {
    conversationId: conversation.conversationId, replyIntentId, replyBody: 'Hello', replyLocale: 'en', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null
  });
  assert.equal(first.sent, true);

  await assert.rejects(
    () => sendCoordinatedReply(c, {
      conversationId: conversation.conversationId, replyIntentId, replyBody: 'Hello', replyLocale: 'en', replyBrand: 'VOYARA', source: 'WEB_CHAT', agentCode: null
    }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'DUPLICATE_REPLY'
  );
});

test('a reply is blocked when the conversation is under human takeover', async () => {
  const c = ctx();
  const conversation = baseState({ handoverStatus: 'HUMAN' });
  c.store.seedConversation(conversation);
  await assert.rejects(
    () => sendCoordinatedReply(c, {
      conversationId: conversation.conversationId, replyIntentId: 'intent-1', replyBody: 'Hi', replyLocale: 'az', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null
    }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'HUMAN_TAKEOVER_ACTIVE'
  );
});

test('a reply is blocked when no consent is on file', async () => {
  const c = ctx();
  const conversation = baseState({ consentGranted: false });
  c.store.seedConversation(conversation);
  await assert.rejects(
    () => sendCoordinatedReply(c, {
      conversationId: conversation.conversationId, replyIntentId: 'intent-1', replyBody: 'Hi', replyLocale: 'az', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null
    }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'CONSENT_NOT_GRANTED'
  );
});

test('a reply in the wrong language is rejected even though every other check would pass', async () => {
  const c = ctx();
  const conversation = baseState({ preferredLocale: 'az' });
  c.store.seedConversation(conversation);
  await assert.rejects(
    () => sendCoordinatedReply(c, {
      conversationId: conversation.conversationId, replyIntentId: 'intent-1', replyBody: 'Привет', replyLocale: 'ru', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null
    }),
    (e: unknown) => e instanceof ChannelCoordinationError && e.code === 'LANGUAGE_MIXING_REJECTED'
  );
});

test('pausing the resolved channel blocks sendCoordinatedReply through the full gate, even with consent/language/brand all correct', async () => {
  const c = ctx();
  const conversation = baseState({ channel: 'WHATSAPP', consentGranted: true, preferredLocale: 'en' });
  c.store.seedConversation(conversation);
  await pauseChannel(c, 'WHATSAPP', randomUUID(), 'INCIDENT');
  await assert.rejects(
    () => sendCoordinatedReply(c, {
      conversationId: conversation.conversationId, replyIntentId: 'intent-1', replyBody: 'Hello', replyLocale: 'en', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null
    }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'AGENT_PAUSED'
  );
});

test('a successful simulated reply records a real delivery-status event, never a live send', async () => {
  const c = ctx();
  const conversation = baseState({ preferredLocale: 'en' });
  c.store.seedConversation(conversation);
  const adapter = new SimulationChannelAdapter();
  assert.equal(adapter.simulated, true);
  const result = await sendCoordinatedReply(c, {
    conversationId: conversation.conversationId, replyIntentId: 'intent-1', replyBody: 'Hello', replyLocale: 'en', replyBrand: 'VOYARA', source: 'WHATSAPP', agentCode: null
  }, adapter);
  assert.equal(result.sent, true);
  assert.ok(result.externalMessageId?.startsWith('sim-msg-'));
  const events = c.store.deliveryEventsFor(conversation.conversationId);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'PENDING');
});
