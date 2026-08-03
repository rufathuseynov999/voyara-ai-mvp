import { readVoiceCredentials } from '@/config/env-core';
import { SimulationVoiceAdapter, type VoiceAdapter } from './voice-adapter';

/**
 * Phase 4D — voice adapter registry / factory. Identical fail-closed
 * discipline to channel-registry.ts / payment-registry.ts / registry.ts:
 *  - SIMULATION works today (the only mode that can be constructed);
 *  - SANDBOX requires real, non-placeholder credentials — CREDENTIALS_MISSING
 *    otherwise, never a silent fallback to simulation;
 *  - LIVE is never available in this build.
 *
 * No live voice provider is claimed anywhere. See the Phase 4D activation
 * runbook for exactly what a real provider requires.
 */

export class VoiceAdapterError extends Error {
  constructor(message: string, readonly code: 'CREDENTIALS_MISSING' | 'LIVE_NOT_AVAILABLE') {
    super(message);
    this.name = 'VoiceAdapterError';
  }
}

export function createVoiceAdapter(mode: 'SIMULATION' | 'SANDBOX' | 'LIVE', environment: NodeJS.ProcessEnv = process.env): VoiceAdapter {
  if (mode === 'SIMULATION') return new SimulationVoiceAdapter();

  if (mode === 'SANDBOX') {
    const credentials = readVoiceCredentials(environment);
    if (!credentials) {
      throw new VoiceAdapterError(
        'Voice Sandbox credentials are not configured (VOYARA_VOICE_PROVIDER_ACCOUNT_ID / _API_KEY / _WEBHOOK_SECRET). ' +
        'Refusing to construct the adapter rather than falling back to simulation.',
        'CREDENTIALS_MISSING'
      );
    }
    // No real SANDBOX voice adapter implementation exists yet — even with
    // credentials present, this build has nothing to construct. Reported
    // honestly rather than fabricating a connection.
    throw new VoiceAdapterError(
      'Voice credentials are configured, but no real Sandbox voice adapter implementation exists in this build yet.',
      'CREDENTIALS_MISSING'
    );
  }

  throw new VoiceAdapterError('No LIVE voice adapter is available in this build; live capability is not claimed.', 'LIVE_NOT_AVAILABLE');
}
