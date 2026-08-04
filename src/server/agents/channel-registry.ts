import { readWhatsAppCredentials, readInstagramCredentials } from '@/config/env-core';
import type { ChannelAdapter } from './channel-adapter';
import { SimulationChannelAdapter } from './simulation-channel-adapter';
import { WhatsAppChannelAdapter } from './whatsapp/whatsapp-adapter';
import { InstagramChannelAdapter } from './instagram/instagram-adapter';
import type { ChannelKind } from './agent-contract';

/**
 * Phase 4A/4C/4H — channel adapter registry / factory.
 *
 * Identical fail-closed discipline to the supplier and payment registries:
 *  - SIMULATION channel may load only the simulation adapter;
 *  - SANDBOX may load only WHATSAPP or INSTAGRAM_DM, and only when real,
 *    non-placeholder credentials are configured for the requested
 *    channel/brand — CREDENTIALS_MISSING otherwise, never a silent
 *    fallback to simulation. Voice and web-chat still have no adapter in
 *    this build.
 *  - LIVE is never available for any channel in this build.
 *
 * INSTAGRAM_DM additionally requires a `brand` parameter, since one
 * Instagram adapter instance is always scoped to exactly one brand's
 * account (see instagram-adapter.ts) — there is no "generic" Instagram
 * adapter the way there is a single WhatsApp number for initial
 * certification.
 *
 * No live channel integration is claimed anywhere. See the gap matrix
 * (docs/phase-4/VOYARA-GAP-MATRIX.md) for exactly what each channel needs
 * before it could be built: WhatsApp needs Meta Business + WhatsApp Business
 * Platform access; Instagram DM needs Meta Business + Graph API access,
 * App Review, and two connected Pages/IG accounts (see the Phase 4H
 * activation runbook); voice needs a telephony + STT/TTS provider; none of
 * these credentials exist anywhere in this project.
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
  environment: NodeJS.ProcessEnv = process.env,
  brand?: 'RTRAVEL' | 'VOYARA'
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
    if (channel === 'WHATSAPP') {
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

    if (channel === 'INSTAGRAM_DM') {
      if (!brand) {
        throw new ChannelAdapterError(
          'Instagram Sandbox adapter requires a brand (RTRAVEL or VOYARA) — there is no brand-generic Instagram adapter.',
          'CREDENTIALS_MISSING'
        );
      }
      const credentials = readInstagramCredentials(brand, environment);
      if (!credentials) {
        throw new ChannelAdapterError(
          `Instagram Sandbox credentials are not fully configured for brand '${brand}' (shared VOYARA_META_APP_ID / _APP_SECRET / ` +
          '_WEBHOOK_VERIFY_TOKEN / _CALLBACK_URL, plus that brand\'s VOYARA_INSTAGRAM_<BRAND>_ACCOUNT_ID / _PAGE_ID / _ACCESS_TOKEN). ' +
          'Refusing to construct the adapter rather than falling back to simulation.',
          'CREDENTIALS_MISSING'
        );
      }
      // A second, independent gate beyond credential presence — mirrors
      // VOYARA_LIVE_BOOKING_ENABLED's role for bookings. Credentials being
      // configured does not, by itself, permit construction of a working
      // adapter; a deliberate, separately-set activation flag is also
      // required, so activation is always a conscious staged decision.
      if (environment.VOYARA_INSTAGRAM_ACTIVATION_ENABLED !== 'true') {
        throw new ChannelAdapterError(
          `Instagram credentials are configured for brand '${brand}' but VOYARA_INSTAGRAM_ACTIVATION_ENABLED is not 'true'. ` +
          'Refusing to construct the adapter until activation is explicitly enabled.',
          'CREDENTIALS_MISSING'
        );
      }
      return new InstagramChannelAdapter(credentials);
    }

    throw new ChannelAdapterError(
      `No Sandbox channel adapter is available for '${channel}' in this build — the only controlled-activated channels are WhatsApp and Instagram DM.`,
      'UNSUPPORTED_CHANNEL'
    );
  }

  throw new ChannelAdapterError(
    `No LIVE channel adapter is available in this build for '${channel}'; live capability is not claimed.`,
    'LIVE_NOT_AVAILABLE'
  );
}
