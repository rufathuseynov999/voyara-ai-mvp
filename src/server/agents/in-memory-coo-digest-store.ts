import type { CooDigest } from './coo-agent-contract';
import type { CooDigestStore } from './coo-digest-store';
import type { OperationalSignalsSource } from './coo-agent-contract';

export class InMemoryCooDigestStore implements CooDigestStore {
  private readonly digests: CooDigest[] = [];

  async saveDigest(digest: CooDigest): Promise<void> {
    this.digests.push(digest);
  }

  async listRecentDigests(accountId: string, limit: number): Promise<CooDigest[]> {
    return this.digests
      .filter((d) => d.accountId === accountId)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
      .slice(0, limit);
  }

  count(): number {
    return this.digests.length;
  }
}

/** Fixture signals source for hermetic tests — fully in control of every
 *  count, no database involved. */
export class FixtureOperationalSignalsSource implements OperationalSignalsSource {
  constructor(private readonly counts: {
    pendingApprovals?: number;
    paymentMismatches?: number;
    expiringOffers?: number;
    escalatedConversations?: number;
    pendingHumanConversations?: number;
  } = {}) {}

  async countPendingApprovals(): Promise<number> { return this.counts.pendingApprovals ?? 0; }
  async countPaymentMismatches(): Promise<number> { return this.counts.paymentMismatches ?? 0; }
  async countExpiringOffers(): Promise<number> { return this.counts.expiringOffers ?? 0; }
  async countEscalatedConversations(): Promise<number> { return this.counts.escalatedConversations ?? 0; }
  async countPendingHumanConversations(): Promise<number> { return this.counts.pendingHumanConversations ?? 0; }
}
