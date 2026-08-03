import { randomUUID } from 'node:crypto';

/**
 * Phase 4G — cross-channel communication coordination.
 *
 * Reuses the exact conceptual fields already proven in Phase 4B
 * (`conversations.customer_facing_brand`, `conversations.handover_status`,
 * `messages.delivery_status`) rather than inventing a parallel model — this
 * module's `ChannelCoordinationStore` is a port that a real
 * Supabase-backed implementation would satisfy using those same columns.
 * Duplicate-reply prevention reuses the identical reserve-first pattern
 * proven throughout this project (payment webhooks, portal tasks, renewal
 * events, workflow event inbox) rather than a new mechanism.
 *
 * The single most important guarantee: `guardAgainstDuplicateReply` is the
 * ONE choke point every channel's outbound-reply path must call before
 * sending — a correlated customer event that somehow triggers both the
 * WhatsApp path and the web-chat path for the same reply intent can only
 * win the reservation once; the second channel's attempt is refused.
 */

export const supportedLocales = ['az', 'ru', 'en'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const channelKinds = ['VOICE', 'WEB_CHAT', 'WHATSAPP', 'INSTAGRAM_DM', 'EMAIL'] as const;
export type CoordinationChannelKind = (typeof channelKinds)[number];

export const customerFacingBrands = ['RTRAVEL', 'VOYARA'] as const;
export type CustomerFacingBrand = (typeof customerFacingBrands)[number];

export type ConversationCoordinationState = {
  conversationId: string;
  channel: CoordinationChannelKind;
  customerFacingBrand: CustomerFacingBrand;
  handoverStatus: 'AI' | 'HUMAN';
  preferredLocale: SupportedLocale;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  consentGranted: boolean;
};

export interface ChannelCoordinationStore {
  loadConversationState(conversationId: string): Promise<ConversationCoordinationState | null>;
  saveConversationState(state: ConversationCoordinationState): Promise<void>;
  reserveReplyEvent(correlationKey: string): Promise<{ winner: boolean }>;
  reserveInboundEvent(eventKey: string): Promise<{ winner: boolean }>;
  recordDeliveryStatusEvent(event: { eventId: string; conversationId: string; channel: CoordinationChannelKind; status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'READ'; correlationId: string; causationId: string | null }): Promise<void>;
}

export class InMemoryChannelCoordinationStore implements ChannelCoordinationStore {
  private readonly conversations = new Map<string, ConversationCoordinationState>();
  private readonly replyReservations = new Set<string>();
  private readonly inboundReservations = new Set<string>();
  private readonly deliveryEvents: Array<{ eventId: string; conversationId: string; channel: CoordinationChannelKind; status: string }> = [];

  seedConversation(state: ConversationCoordinationState): void { this.conversations.set(state.conversationId, state); }
  async loadConversationState(conversationId: string): Promise<ConversationCoordinationState | null> { return this.conversations.get(conversationId) ?? null; }
  async saveConversationState(state: ConversationCoordinationState): Promise<void> { this.conversations.set(state.conversationId, state); }
  async reserveReplyEvent(correlationKey: string): Promise<{ winner: boolean }> {
    if (this.replyReservations.has(correlationKey)) return { winner: false };
    this.replyReservations.add(correlationKey);
    return { winner: true };
  }
  async reserveInboundEvent(eventKey: string): Promise<{ winner: boolean }> {
    if (this.inboundReservations.has(eventKey)) return { winner: false };
    this.inboundReservations.add(eventKey);
    return { winner: true };
  }
  async recordDeliveryStatusEvent(event: { eventId: string; conversationId: string; channel: CoordinationChannelKind; status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'READ' }): Promise<void> {
    this.deliveryEvents.push(event);
  }

  deliveryEventsFor(conversationId: string) {
    return this.deliveryEvents.filter((e) => e.conversationId === conversationId);
  }
}

export type ChannelCoordinationContext = { store: ChannelCoordinationStore; correlationId: string; now: () => Date };

export class ChannelCoordinationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_FOUND' | 'DUPLICATE_REPLY' | 'DUPLICATE_INBOUND' | 'HUMAN_TAKEOVER_ACTIVE'
      | 'LANGUAGE_MIXING_REJECTED' | 'BRAND_MISMATCH' | 'CONSENT_NOT_GRANTED' | 'VALIDATION'
  ) {
    super(message);
    this.name = 'ChannelCoordinationError';
  }
}

export async function guardAgainstDuplicateInbound(ctx: ChannelCoordinationContext, eventKey: string): Promise<void> {
  const reservation = await ctx.store.reserveInboundEvent(eventKey);
  if (!reservation.winner) throw new ChannelCoordinationError(`Duplicate inbound event: ${eventKey}.`, 'DUPLICATE_INBOUND');
}

export async function guardAgainstDuplicateReply(ctx: ChannelCoordinationContext, correlationKey: string): Promise<void> {
  const reservation = await ctx.store.reserveReplyEvent(correlationKey);
  if (!reservation.winner) throw new ChannelCoordinationError(`A reply for "${correlationKey}" has already been sent through another channel.`, 'DUPLICATE_REPLY');
}

export async function requireNoHumanTakeover(ctx: ChannelCoordinationContext, conversationId: string): Promise<ConversationCoordinationState> {
  const state = await ctx.store.loadConversationState(conversationId);
  if (!state) throw new ChannelCoordinationError('Conversation not found.', 'NOT_FOUND');
  if (state.handoverStatus === 'HUMAN') throw new ChannelCoordinationError(`Conversation ${conversationId} is under human takeover — automation is blocked.`, 'HUMAN_TAKEOVER_ACTIVE');
  return state;
}

export async function takeOverConversation(ctx: ChannelCoordinationContext, conversationId: string, staffActorId: string): Promise<void> {
  if (!staffActorId) throw new ChannelCoordinationError('A real human staff actor is required to take over a conversation.', 'VALIDATION');
  const state = await ctx.store.loadConversationState(conversationId);
  if (!state) throw new ChannelCoordinationError('Conversation not found.', 'NOT_FOUND');
  await ctx.store.saveConversationState({ ...state, handoverStatus: 'HUMAN' });
}

export async function releaseConversation(ctx: ChannelCoordinationContext, conversationId: string, staffActorId: string): Promise<void> {
  if (!staffActorId) throw new ChannelCoordinationError('A real human staff actor is required to release a conversation.', 'VALIDATION');
  const state = await ctx.store.loadConversationState(conversationId);
  if (!state) throw new ChannelCoordinationError('Conversation not found.', 'NOT_FOUND');
  await ctx.store.saveConversationState({ ...state, handoverStatus: 'AI' });
}

export function resolveReplyLocale(conversationLocale: SupportedLocale, candidateReplyLocale: string): SupportedLocale {
  if (!supportedLocales.includes(candidateReplyLocale as SupportedLocale)) {
    throw new ChannelCoordinationError(`"${candidateReplyLocale}" is not a supported locale (az/ru/en only).`, 'LANGUAGE_MIXING_REJECTED');
  }
  if (candidateReplyLocale !== conversationLocale) {
    throw new ChannelCoordinationError(`Reply locale "${candidateReplyLocale}" does not match the conversation's resolved locale "${conversationLocale}" — language mixing is rejected.`, 'LANGUAGE_MIXING_REJECTED');
  }
  return conversationLocale;
}

export function assertBrandConsistency(conversationBrand: CustomerFacingBrand, replyBrand: CustomerFacingBrand): void {
  if (conversationBrand !== replyBrand) {
    throw new ChannelCoordinationError(`Brand mismatch: conversation is ${conversationBrand}, reply was prepared as ${replyBrand}.`, 'BRAND_MISMATCH');
  }
}

export function requireConsentGranted(state: ConversationCoordinationState): void {
  if (!state.consentGranted) throw new ChannelCoordinationError(`No consent on file for conversation ${state.conversationId} — automated reply blocked.`, 'CONSENT_NOT_GRANTED');
}

export async function recordDeliveryStatus(ctx: ChannelCoordinationContext, conversationId: string, channel: CoordinationChannelKind, status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'READ', causationId: string | null): Promise<void> {
  await ctx.store.recordDeliveryStatusEvent({ eventId: randomUUID(), conversationId, channel, status, correlationId: ctx.correlationId, causationId });
}

export function isUnansweredPastSla(state: ConversationCoordinationState, now: Date, slaMinutes: number): boolean {
  if (state.handoverStatus !== 'HUMAN' || !state.lastInboundAt) return false;
  const inboundTime = new Date(state.lastInboundAt).getTime();
  const outboundTime = state.lastOutboundAt ? new Date(state.lastOutboundAt).getTime() : -Infinity;
  if (outboundTime > inboundTime) return false;
  return now.getTime() - inboundTime > slaMinutes * 60 * 1000;
}
