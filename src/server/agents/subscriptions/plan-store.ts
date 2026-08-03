import type { PlanVersion } from './plan-authority';

export interface PlanStore {
  savePlanVersion(plan: PlanVersion): Promise<void>;
  loadPlanVersion(planVersionId: string): Promise<PlanVersion | null>;
  findActivePlan(planCode: PlanVersion['planCode'], billingCycle: PlanVersion['billingCycle']): Promise<PlanVersion | null>;
  savePlanVersionHistory(entry: { historyId: string; planVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string; correlationId: string }): Promise<void>;
}

export class InMemoryPlanStore implements PlanStore {
  private readonly plans = new Map<string, PlanVersion>();
  private readonly history: Array<{ historyId: string; planVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string }> = [];

  async savePlanVersion(plan: PlanVersion): Promise<void> {
    this.plans.set(plan.planVersionId, plan);
  }
  async loadPlanVersion(planVersionId: string): Promise<PlanVersion | null> {
    return this.plans.get(planVersionId) ?? null;
  }
  async findActivePlan(planCode: PlanVersion['planCode'], billingCycle: PlanVersion['billingCycle']): Promise<PlanVersion | null> {
    for (const plan of this.plans.values()) {
      if (plan.planCode === planCode && plan.billingCycle === billingCycle && plan.status === 'ACTIVE') return plan;
    }
    return null;
  }
  async savePlanVersionHistory(entry: { historyId: string; planVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string }): Promise<void> {
    this.history.push(entry);
  }

  historyFor(planVersionId: string) {
    return this.history.filter((h) => h.planVersionId === planVersionId);
  }
}
