import { readHotelbedsCredentials, readIntegrationConfig } from '@/config/env-core';
import type { SupplierAdapter } from './adapter';
import { SimulationSupplierAdapter } from './simulation-adapter';
import { HotelbedsSupplierAdapter } from './suppliers/hotelbeds/hotelbeds-adapter';
import type { IntegrationMode } from './contract';

/**
 * Supplier adapter registry / factory.
 *
 * Fail-closed rules (Phase 3A Part 2, extended Phase 3C Part 2):
 *  - SIMULATION mode may load ONLY the simulation adapter.
 *  - An unsupported adapter id throws (no silent default).
 *  - SANDBOX mode may load ONLY 'hotelbeds' (the one supplier controlled-
 *    activated in Phase 3C Part 2) and ONLY when real, non-placeholder
 *    Hotelbeds credentials are present — a missing or placeholder credential
 *    throws CREDENTIALS_MISSING rather than silently falling back to
 *    simulation, or worse, constructing an adapter that would fail on its
 *    first real call instead of at startup.
 *  - LIVE mode is never available for any adapter id in this build. No live
 *    supplier capability is claimed anywhere — this is unchanged from Phase
 *    3A/3B and Phase 3C Part 2 does not relax it.
 */

export class SupplierAdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'UNSUPPORTED_ADAPTER' | 'MODE_ADAPTER_MISMATCH' | 'LIVE_NOT_AVAILABLE' | 'CREDENTIALS_MISSING'
  ) {
    super(message);
    this.name = 'SupplierAdapterError';
  }
}

/** Adapter ids known to this build. */
const SIMULATION_ADAPTER_IDS = new Set(['simulation', 'sim']);
const SANDBOX_ADAPTER_IDS = new Set(['hotelbeds']);

/** System actor attributed to supplier calls when no authenticated actor is
 *  available to the caller (e.g. a health check run outside a request). Real
 *  per-command calls pass the acting viewer's id — see resolveSupplierAdapter. */
const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000000';

export function createSupplierAdapter(
  mode: IntegrationMode,
  adapterId: string,
  actorId: string = SYSTEM_ACTOR_ID,
  environment: NodeJS.ProcessEnv = process.env
): SupplierAdapter {
  const normalizedId = adapterId.trim().toLowerCase();

  if (mode === 'SIMULATION') {
    if (!SIMULATION_ADAPTER_IDS.has(normalizedId)) {
      throw new SupplierAdapterError(
        `Simulation mode may only load the simulation adapter (got '${adapterId}').`,
        'MODE_ADAPTER_MISMATCH'
      );
    }
    return new SimulationSupplierAdapter();
  }

  if (mode === 'SANDBOX') {
    if (!SANDBOX_ADAPTER_IDS.has(normalizedId)) {
      throw new SupplierAdapterError(
        `No Sandbox adapter named '${adapterId}' is available; the only controlled-activated supplier is 'hotelbeds'.`,
        'UNSUPPORTED_ADAPTER'
      );
    }
    const credentials = readHotelbedsCredentials(environment);
    if (!credentials) {
      throw new SupplierAdapterError(
        'Hotelbeds Sandbox credentials are not configured (VOYARA_HOTELBEDS_API_KEY / VOYARA_HOTELBEDS_API_SECRET). ' +
        'Refusing to construct the adapter rather than falling back to simulation or constructing one that would fail on its first call.',
        'CREDENTIALS_MISSING'
      );
    }
    return new HotelbedsSupplierAdapter(credentials, { actorId });
  }

  // LIVE: no live adapter exists in this build for any supplier. Do NOT fall
  // back to simulation or sandbox — fail closed with an explicit error.
  throw new SupplierAdapterError(
    `No LIVE supplier adapter is available in this build; live capability is not claimed.`,
    'LIVE_NOT_AVAILABLE'
  );
}

/** Resolve the adapter from the validated environment integration config.
 *  `actorId`, when supplied, is the acting viewer's id and is attributed to
 *  every supplier call this adapter instance makes (see
 *  supplier-audit-store.ts); omit it only outside a request context. */
export function resolveSupplierAdapter(
  environment: NodeJS.ProcessEnv = process.env,
  actorId?: string
): SupplierAdapter {
  const config = readIntegrationConfig(environment);
  return createSupplierAdapter(config.supplierMode, config.supplierAdapter, actorId, environment);
}
