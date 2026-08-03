import { randomUUID } from 'node:crypto';
import type { ChannelAdapter, ChannelResult } from './channel-adapter';
import type { ChannelKind } from './agent-contract';

/**
 * Phase 4A — simulation channel adapter. No network call, ever. Exists so the
 * operating layer's send path (which only ever fires after human approval)
 * can be exercised end to end without any external channel account.
 */
export class SimulationChannelAdapter implements ChannelAdapter {
  readonly mode = 'SIMULATION' as const;
  readonly simulated = true;

  constructor(readonly channel: ChannelKind = 'SIMULATION', private readonly clock: () => Date = () => new Date()) {}

  async sendOutbound(params: { contactExternalId: string; body: string; correlationId: string }): Promise<ChannelResult<{ externalMessageId: string }>> {
    if (!params.body || params.body.length > 4_000) {
      return { ok: false, error: { kind: 'VALIDATION', code: 'INVALID_BODY' } };
    }
    return { ok: true, value: { externalMessageId: `sim-msg-${randomUUID()}` } };
  }

  async health() {
    return { channel: this.channel, healthy: true, checkedAt: this.clock().toISOString() };
  }
}
