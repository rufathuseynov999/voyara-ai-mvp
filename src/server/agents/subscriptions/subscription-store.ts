export type SubscriptionStatus =
  | 'TRIAL' | 'PENDING_PAYMENT' | 'ACTIVE' | 'GRACE_PERIOD' | 'PAYMENT_FAILED' | 'PAUSED'
  | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED' | 'SCHEDULED_UPGRADE' | 'SCHEDULED_DOWNGRADE' | 'RENEWAL_PENDING';

export type Subscription = {
  subscriptionId: string;
  contactId: string | null;
  corporateAccountId: string | null;
  planVersionId: string;
  scheduledPlanVersionId: string | null;
  status: SubscriptionStatus;
  billingCycle: 'MONTHLY' | 'ANNUAL';
  startDate: string | null;
  currentPeriodEnd: string | null;
  nextPaymentDate: string | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndsAt: string | null;
  humanOverrideReason: string | null;
  humanOverrideBy: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type EntitlementGrant = {
  grantId: string;
  subscriptionId: string;
  planVersionId: string;
  benefitsSnapshot: string[];
  usageLimitsSnapshot: Record<string, unknown>;
  grantedAt: string;
  expiresAt: string | null;
  correlationId: string;
};

export type SubscriptionEventRecord = {
  eventId: string;
  subscriptionId: string;
  kind: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  correlationId: string;
  reasonCode?: string | null;
};

export interface SubscriptionStore {
  saveSubscription(subscription: Subscription): Promise<void>;
  loadSubscription(subscriptionId: string): Promise<Subscription | null>;
  findActiveSubscriptionForContact(contactId: string): Promise<Subscription | null>;
  recordSubscriptionEvent(event: SubscriptionEventRecord): Promise<void>;
  saveEntitlementGrant(grant: EntitlementGrant): Promise<void>;
  loadLatestEntitlementGrant(subscriptionId: string): Promise<EntitlementGrant | null>;
  recordUsage(subscriptionId: string, usageKey: string, amount: number, periodStart: string, periodEnd: string): Promise<void>;
  loadUsage(subscriptionId: string, usageKey: string, periodStart: string): Promise<number>;
}

export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly events: SubscriptionEventRecord[] = [];
  private readonly grants = new Map<string, EntitlementGrant[]>();
  private readonly usage = new Map<string, number>();

  async saveSubscription(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.subscriptionId, subscription);
  }
  async loadSubscription(subscriptionId: string): Promise<Subscription | null> {
    return this.subscriptions.get(subscriptionId) ?? null;
  }
  async findActiveSubscriptionForContact(contactId: string): Promise<Subscription | null> {
    for (const sub of this.subscriptions.values()) {
      if (sub.contactId === contactId && sub.status === 'ACTIVE') return sub;
    }
    return null;
  }
  async recordSubscriptionEvent(event: SubscriptionEventRecord): Promise<void> {
    this.events.push(event);
  }
  async saveEntitlementGrant(grant: EntitlementGrant): Promise<void> {
    const existing = this.grants.get(grant.subscriptionId) ?? [];
    existing.push(grant);
    this.grants.set(grant.subscriptionId, existing);
  }
  async loadLatestEntitlementGrant(subscriptionId: string): Promise<EntitlementGrant | null> {
    const list = this.grants.get(subscriptionId) ?? [];
    return list.length > 0 ? list[list.length - 1] : null;
  }
  async recordUsage(subscriptionId: string, usageKey: string, amount: number, periodStart: string): Promise<void> {
    const key = `${subscriptionId}:${usageKey}:${periodStart}`;
    this.usage.set(key, (this.usage.get(key) ?? 0) + amount);
  }
  async loadUsage(subscriptionId: string, usageKey: string, periodStart: string): Promise<number> {
    return this.usage.get(`${subscriptionId}:${usageKey}:${periodStart}`) ?? 0;
  }

  eventsFor(subscriptionId: string): SubscriptionEventRecord[] {
    return this.events.filter((e) => e.subscriptionId === subscriptionId);
  }
  allGrantsFor(subscriptionId: string): EntitlementGrant[] {
    return this.grants.get(subscriptionId) ?? [];
  }
}
