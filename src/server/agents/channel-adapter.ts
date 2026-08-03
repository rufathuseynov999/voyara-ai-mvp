import type { ChannelKind } from './agent-contract';

/**
 * Phase 4A — provider-neutral channel adapter interface.
 *
 * Mirrors SupplierAdapter/PaymentAdapter exactly: a stable, provider-agnostic
 * contract that a real WhatsApp, Instagram, voice, or web-chat integration
 * would implement, gated by the same fail-closed registry pattern
 * (channel-registry.ts) proven for Hotelbeds (Phase 3C Part 2) and the
 * generic payment provider (Part 3). No real channel is implemented here —
 * see the gap matrix. `SimulationChannelAdapter` is the only adapter that
 * currently exists, for testing the operating layer end to end without any
 * external account.
 */

export type ChannelMessage = {
  externalMessageId: string;
  contactExternalId: string; // phone number, Instagram handle, etc. — provider-specific, opaque here
  body: string;
  receivedAt: string;
};

export type ChannelResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: 'VALIDATION' | 'TIMEOUT' | 'RATE_LIMIT' | 'UNAVAILABLE' | 'TERMINAL_FAILURE'; code: string } };

export interface ChannelAdapter {
  readonly channel: ChannelKind;
  readonly mode: 'SIMULATION' | 'SANDBOX' | 'LIVE';
  readonly simulated: boolean;

  /** Sends an already human-approved outbound message. This is the ONLY
   *  place a message ever leaves VOYARA — and it is only ever called by
   *  agent-operating-layer.ts's approveAndSendMessage(), after a human actor
   *  has approved the exact message content by id. No adapter implementation
   *  may skip this call chain; there is no other public send path. */
  sendOutbound(params: { contactExternalId: string; body: string; correlationId: string }): Promise<ChannelResult<{ externalMessageId: string }>>;

  health(): Promise<{ channel: ChannelKind; healthy: boolean; checkedAt: string }>;
}
