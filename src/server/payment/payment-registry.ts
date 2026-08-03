import { readHostedPaymentCredentials, readIntegrationConfig } from '@/config/env-core';
import type { PaymentAdapter } from './integration-contract';
import { SimulationPaymentAdapter } from './simulation-payment-adapter';
import { HostedCheckoutPaymentAdapter } from './providers/hosted-checkout/hosted-checkout-adapter';
import type { IntegrationMode } from '@/server/supplier/contract';

/**
 * Payment adapter registry / factory. Same fail-closed discipline as the
 * supplier registry (Phase 3C Part 2):
 *  - SIMULATION loads only the simulation adapter.
 *  - SANDBOX loads only the generic 'hosted-checkout' adapter, and only when
 *    real, non-placeholder credentials are configured — a missing credential
 *    throws CREDENTIALS_MISSING rather than falling back to simulation.
 *  - LIVE is never available for any adapter id in this build.
 *
 * No specific payment provider has been approved by the founder (checked
 * explicitly — see the Phase 3C Part 3 checkpoint). 'hosted-checkout' is a
 * provider-neutral reference adapter, not a claim that any named provider is
 * connected — see hosted-checkout-contract.ts for the full honesty note.
 */

export class PaymentAdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'MODE_ADAPTER_MISMATCH' | 'LIVE_NOT_AVAILABLE' | 'UNSUPPORTED_ADAPTER' | 'CREDENTIALS_MISSING'
  ) {
    super(message);
    this.name = 'PaymentAdapterError';
  }
}

const SIMULATION_ADAPTER_IDS = new Set(['simulation', 'sim']);
const SANDBOX_ADAPTER_IDS = new Set(['hosted-checkout']);

export function createPaymentAdapter(
  mode: IntegrationMode,
  adapterId: string,
  environment: NodeJS.ProcessEnv = process.env
): PaymentAdapter {
  const normalizedId = adapterId.trim().toLowerCase();

  if (mode === 'SIMULATION') {
    if (!SIMULATION_ADAPTER_IDS.has(normalizedId)) {
      throw new PaymentAdapterError(
        `Simulation mode may only load the simulation payment adapter (got '${adapterId}').`,
        'MODE_ADAPTER_MISMATCH'
      );
    }
    return new SimulationPaymentAdapter();
  }

  if (mode === 'SANDBOX') {
    if (!SANDBOX_ADAPTER_IDS.has(normalizedId)) {
      throw new PaymentAdapterError(
        `No Sandbox payment adapter named '${adapterId}' is available; the only provider-neutral reference adapter is 'hosted-checkout'.`,
        'UNSUPPORTED_ADAPTER'
      );
    }
    const credentials = readHostedPaymentCredentials(environment);
    if (!credentials) {
      throw new PaymentAdapterError(
        'Hosted payment credentials are not configured (VOYARA_PAYMENT_PROVIDER_NAME / VOYARA_PAYMENT_MERCHANT_ID / ' +
        'VOYARA_PAYMENT_API_KEY / VOYARA_PAYMENT_WEBHOOK_SIGNING_SECRET / VOYARA_PAYMENT_BASE_URL). Refusing to construct ' +
        'the adapter rather than falling back to simulation or constructing one that would fail on its first call.',
        'CREDENTIALS_MISSING'
      );
    }
    return new HostedCheckoutPaymentAdapter(credentials);
  }

  throw new PaymentAdapterError(
    `No LIVE payment adapter is available in this build; live capability is not claimed.`,
    'LIVE_NOT_AVAILABLE'
  );
}

export function resolvePaymentAdapter(environment: NodeJS.ProcessEnv = process.env): PaymentAdapter {
  const config = readIntegrationConfig(environment);
  return createPaymentAdapter(config.paymentMode, config.paymentAdapter, environment);
}
