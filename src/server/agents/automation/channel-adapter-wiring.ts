import { randomUUID } from 'node:crypto';
import type { ChannelAdapter } from '../channel-adapter';
import { SimulationChannelAdapter } from '../simulation-channel-adapter';
import {
  guardAgainstDuplicateInbound, guardAgainstDuplicateReply, requireNoHumanTakeover, resolveReplyLocale, assertBrandConsistency,
  requireConsentGranted, recordDeliveryStatus, type ChannelCoordinationContext, type CoordinationChannelKind,
  type CustomerFacingBrand, type SupportedLocale, ChannelCoordinationError
} from './channel-coordination';
import { checkAutomationGateExtended, type FounderControlContext } from './founder-controls';
import type { AutomationContext } from './automation-service';

/**
 * Phase 4G — real channel-adapter wiring, simulation only.
 *
 * The six named sources (R-Travel Instagram, VOYARA Instagram, WhatsApp,
 * website chat, voice receptionist, staff console) are modeled as
 * `ChannelSource` values that resolve to a real `(channel, brand)` pair —
 * R-Travel Instagram and VOYARA Instagram share the same underlying
 * `INSTAGRAM_DM` channel kind but carry different brand identity, exactly
 * matching the dual-account architecture already proven in Phase 4B. Every
 * source funnels through the SAME shared coordination functions
 * (`channel-coordination.ts`) and the SAME extended automation gate
 * (`founder-controls.ts`) — there is no per-channel bypass anywhere in
 * this file.
 *
 * `SimulationChannelAdapter` is the only adapter actually invoked — no
 * live message is ever sent. Real WhatsApp/Instagram/voice/web-chat
 * adapters would satisfy the exact same `ChannelAdapter` interface
 * (channel-adapter.ts, Phase 4A) and could be substituted here without
 * changing anything in this orchestration layer.
 */

export const channelSources = ['RTRAVEL_INSTAGRAM', 'VOYARA_INSTAGRAM', 'WHATSAPP', 'WEB_CHAT', 'VOICE', 'STAFF_CONSOLE'] as const;
export type ChannelSource = (typeof channelSources)[number];

const SOURCE_TO_CHANNEL_AND_BRAND: Record<Exclude<ChannelSource, 'STAFF_CONSOLE'>, { channel: CoordinationChannelKind; brand: CustomerFacingBrand }> = {
  RTRAVEL_INSTAGRAM: { channel: 'INSTAGRAM_DM', brand: 'RTRAVEL' },
  VOYARA_INSTAGRAM: { channel: 'INSTAGRAM_DM', brand: 'VOYARA' },
  WHATSAPP: { channel: 'WHATSAPP', brand: 'VOYARA' },
  WEB_CHAT: { channel: 'WEB_CHAT', brand: 'VOYARA' },
  VOICE: { channel: 'VOICE', brand: 'VOYARA' }
};

export type CanonicalInboundEvent = {
  eventId: string;
  correlationId: string;
  causationId: string | null;
  source: ChannelSource;
  channel: CoordinationChannelKind;
  brand: CustomerFacingBrand;
  externalMessageId: string;
  externalContactId: string;
  detectedLocale: SupportedLocale;
  receivedAt: string;
};

export function normalizeInboundEvent(
  source: ChannelSource,
  raw: { externalMessageId: string; externalContactId: string; detectedLocale: SupportedLocale; receivedAt: string },
  causationId: string | null = null
): CanonicalInboundEvent {
  if (source === 'STAFF_CONSOLE') {
    throw new ChannelCoordinationError('STAFF_CONSOLE is not an inbound customer-message source — it originates takeover/release/reply actions instead.', 'VALIDATION');
  }
  const { channel, brand } = SOURCE_TO_CHANNEL_AND_BRAND[source];
  return {
    eventId: randomUUID(), correlationId: randomUUID(), causationId, source, channel, brand,
    externalMessageId: raw.externalMessageId, externalContactId: raw.externalContactId,
    detectedLocale: raw.detectedLocale, receivedAt: raw.receivedAt
  };
}

export type ChannelWiringContext = AutomationContext & ChannelCoordinationContext & FounderControlContext;

export async function processInboundEvent(ctx: ChannelWiringContext, event: CanonicalInboundEvent, conversationId: string) {
  await guardAgainstDuplicateInbound(ctx, `${event.source}:${event.externalMessageId}`);
  const state = await requireNoHumanTakeover(ctx, conversationId);
  assertBrandConsistency(state.customerFacingBrand, event.brand);
  return state;
}

export async function sendCoordinatedReply(
  ctx: ChannelWiringContext,
  input: { conversationId: string; replyIntentId: string; replyBody: string; replyLocale: string; replyBrand: CustomerFacingBrand; source: ChannelSource; agentCode: string | null },
  adapter: ChannelAdapter = new SimulationChannelAdapter()
): Promise<{ sent: boolean; externalMessageId?: string }> {
  const state = await requireNoHumanTakeover(ctx, input.conversationId);
  requireConsentGranted(state);
  const locale = resolveReplyLocale(state.preferredLocale, input.replyLocale);
  assertBrandConsistency(state.customerFacingBrand, input.replyBrand);

  const correlationKey = `${input.conversationId}:${input.replyIntentId}`;
  await guardAgainstDuplicateReply(ctx, correlationKey);

  await checkAutomationGateExtended(ctx, {
    agentCode: input.agentCode, channel: state.channel, workflowCode: null, workingHoursPolicyCode: null,
    requiredFeatureFlag: null, level1PolicyCode: null
  });

  const result = await adapter.sendOutbound({ contactExternalId: input.conversationId, body: input.replyBody, correlationId: ctx.correlationId });
  if (!result.ok) {
    await recordDeliveryStatus(ctx, input.conversationId, state.channel, 'FAILED', input.replyIntentId);
    return { sent: false };
  }
  await recordDeliveryStatus(ctx, input.conversationId, state.channel, 'PENDING', input.replyIntentId);
  return { sent: true, externalMessageId: result.value.externalMessageId };
}
