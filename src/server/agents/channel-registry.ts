import { readWhatsAppCredentials } from '@/config/env-core';
import type { ChannelAdapter } from './channel-adapter';
import { SimulationChannelAdapter } from './simulation-channel-adapter';
import { WhatsAppChannelAdapter } from './whatsapp/whatsapp-adapter';
import type { ChannelKind } from './agent-contract';

/**
 * Phase 4A/4C — channel adapter registry / factory.
 *
 * Identical fail-closed discipline to the supplier and payment registries:
 *  - SIMULATION channel may load only the simulation adapter;
 *  - SANDBOX may load only WHATSAPP, and only when real, non-placeholder
 *    WhatsApp credentials are configured — CREDENTIALS_MISSING otherwise,
 *    never a silent fallback to simulation. Instagram, voice, and web-chat
 *    still have no adapter in this build.
 *  - LIVE is never available for any channel in this build.
 *
 * No live channel integration is claimed anywhere. See the gap matrix
 * (docs/phase-4/VOYARA-GAP-MATRIX.md) for exactly what each channel needs
 * before it could be built: WhatsApp needs Meta Business + WhatsApp Business
 * Platform access (see the Phase 4C activation runbook for the exact list);
 * Instagram DM needs Meta Business + Graph API access; voice needs a
 * telephony + STT/TTS provider; none of these credentials exist anywhere in
 * this project.
 */

export class ChannelAdapterError extends Error {
  constructor(message: string, readonly code: 'UNSUPPORTED_CHANNEL' | 'LIVE_NOT_AVAILABLE' | 'CREDENTIALS_MISSING') {
    super(message);
    this.name = 'ChannelAdapterError';
  }
}

export function createChannelAdapter(
  channel: ChannelKind,
  mode: 'SIMULATION' | 'SANDBOX' | 'LIVE',
  environment: NodeJS.ProcessEnv = process.env
): ChannelAdapter {
  if (mode === 'SIMULATION') {
    if (channel !== 'SIMULATION') {
      throw new ChannelAdapterError(
        `Simulation mode may only load the SIMULATION channel (got '${channel}').`,
        'UNSUPPORTED_CHANNEL'
      );
    }
    return new SimulationChannelAdapter();
  }

  if (mode === 'SANDBOX') {
    if (channel !== 'WHATSAPP') {
      throw new ChannelAdapterError(
        `No Sandbox channel adapter is available for '${channel}' in this build — the only controlled-activated channel is WhatsApp.`,
        'UNSUPPORTED_CHANNEL'
      );
    }
    const credentials = readWhatsAppCredentials(environment);
    if (!credentials) {
      throw new ChannelAdapterError(
        'WhatsApp Sandbox credentials are not configured (VOYARA_WHATSAPP_PHONE_NUMBER_ID / _WABA_ID / _ACCESS_TOKEN / ' +
        '_APP_SECRET / _WEBHOOK_VERIFY_TOKEN). Refusing to construct the adapter rather than falling back to simulation.',
        'CREDENTIALS_MISSING'
      );
    }
    return new WhatsAppChannelAdapter(credentials);
  }

  throw new ChannelAdapterError(
    `No LIVE channel adapter is available in this build for '${channel}'; live capability is not claimed.`,
    'LIVE_NOT_AVAILABLE'
  );
}
