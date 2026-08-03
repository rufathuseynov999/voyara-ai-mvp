import type { MessageSendPolicy } from './risk-policy-contract';

/** Phase 4C — message-send policy store port. */
export interface PolicyStore {
  loadActivePolicy(): Promise<MessageSendPolicy | null>;
  savePolicy(policy: MessageSendPolicy): Promise<void>;
  recordLlmRun(run: { runId: string; conversationId: string; messageId: string | null; modelTier: 'CHEAP' | 'STRONG'; modelName: string; simulated: boolean; correlationId: string }): Promise<void>;
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly policies: MessageSendPolicy[] = [];
  private readonly llmRuns: Array<{ runId: string; conversationId: string; messageId: string | null; modelTier: string; modelName: string; simulated: boolean }> = [];

  async loadActivePolicy(): Promise<MessageSendPolicy | null> {
    return this.policies.find((p) => p.active) ?? null;
  }

  async savePolicy(policy: MessageSendPolicy): Promise<void> {
    if (policy.active) {
      // Only one active policy at a time — activating a new one deactivates
      // any prior active policy, mirroring how a real founder-approval
      // workflow would supersede an old version rather than run two
      // policies concurrently.
      for (let i = 0; i < this.policies.length; i++) {
        if (this.policies[i].active) this.policies[i] = { ...this.policies[i], active: false };
      }
    }
    const existingIndex = this.policies.findIndex((p) => p.policyId === policy.policyId);
    if (existingIndex >= 0) this.policies[existingIndex] = policy;
    else this.policies.push(policy);
  }

  async recordLlmRun(run: { runId: string; conversationId: string; messageId: string | null; modelTier: 'CHEAP' | 'STRONG'; modelName: string; simulated: boolean }): Promise<void> {
    this.llmRuns.push(run);
  }

  /** Test helpers. */
  countLlmRuns(): number {
    return this.llmRuns.length;
  }
}
