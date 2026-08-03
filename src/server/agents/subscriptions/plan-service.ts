import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { PlanStore } from './plan-store';
import {
  PlanAuthorityError, planHashInput, planVersionSchema, verifyPlanIsActiveAuthority,
  LOCKED_PLAN_PRICES, type PlanVersion, type PlanCode, type BillingCycle
} from './plan-authority';

/**
 * Phase 4F — plan authority service.
 *
 * `draftPlanVersion` is the ONLY way to create a plan version, and it
 * refuses any price that doesn't exactly match `LOCKED_PLAN_PRICES` — there
 * is no parameter or code path that lets a caller (human or AI) specify an
 * arbitrary price. This is the founder's locked catalog enforced in code,
 * not merely documented.
 */

export type PlanServiceContext = { store: PlanStore; correlationId: string; now: () => Date };

export type DraftPlanVersionInput = Omit<PlanVersion, 'planVersionId' | 'status' | 'approvedBy' | 'approvedAt' | 'contentHash' | 'version' | 'createdAt' | 'updatedAt' | 'correlationId'>;

export async function draftPlanVersion(ctx: PlanServiceContext, input: DraftPlanVersionInput): Promise<{ planVersionId: string }> {
  const lockedPrice = LOCKED_PLAN_PRICES[input.planCode][input.billingCycle];
  if (input.planCode === 'CORPORATE_ENTERPRISE') {
    // Enterprise has no public price — any draft price is accepted here
    // ONLY because it can never reach ACTIVE with a non-zero price (schema
    // refine + DB CHECK both enforce this); Enterprise terms are set via a
    // corporate account's own contract reference, never a published plan.
  } else if (lockedPrice === null || input.priceMinorUnits !== lockedPrice) {
    throw new PlanAuthorityError(
      `Price ${input.priceMinorUnits} does not match the founder-locked price for ${input.planCode} (${input.billingCycle}): ${lockedPrice}.`,
      'PRICE_MISMATCH'
    );
  }

  const planVersionId = randomUUID();
  const now = ctx.now().toISOString();
  const plan: PlanVersion = {
    ...input, planVersionId, status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null,
    version: 1, correlationId: ctx.correlationId, createdAt: now, updatedAt: now
  };
  const parsed = planVersionSchema.safeParse(plan);
  if (!parsed.success) throw new PlanAuthorityError('Invalid plan draft.', 'VALIDATION');

  await ctx.store.savePlanVersion(plan);
  return { planVersionId };
}

export async function approveAndActivatePlan(ctx: PlanServiceContext, planVersionId: string, approvedBy: string): Promise<void> {
  const plan = await ctx.store.loadPlanVersion(planVersionId);
  if (!plan) throw new PlanAuthorityError('Plan version not found.', 'NOT_FOUND');

  const contentHash = sha256(planHashInput(plan));
  const now = ctx.now().toISOString();
  const activated: PlanVersion = { ...plan, status: 'ACTIVE', approvedBy, approvedAt: now, contentHash, updatedAt: now };
  const parsed = planVersionSchema.safeParse(activated);
  if (!parsed.success) throw new PlanAuthorityError('Plan failed validation on activation.', 'VALIDATION');

  await ctx.store.savePlanVersion(activated);
  await ctx.store.savePlanVersionHistory({
    historyId: randomUUID(), planVersionId, version: activated.version, contentHash,
    snapshot: planHashInput(activated), createdBy: approvedBy, correlationId: ctx.correlationId
  });
}

export async function revisePlanVersion(
  ctx: PlanServiceContext,
  planVersionId: string,
  revisedFields: Partial<Pick<PlanVersion, 'benefits' | 'usageLimits' | 'servicePrivileges' | 'retirementDate'>>,
  revisedBy: string
): Promise<{ newVersion: number }> {
  const plan = await ctx.store.loadPlanVersion(planVersionId);
  if (!plan) throw new PlanAuthorityError('Plan version not found.', 'NOT_FOUND');

  const newVersion = plan.version + 1;
  const now = ctx.now().toISOString();
  const revised: PlanVersion = { ...plan, ...revisedFields, status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null, version: newVersion, updatedAt: now };
  await ctx.store.savePlanVersion(revised);
  return { newVersion };
}

export async function requireActivePlanAuthority(ctx: PlanServiceContext, planVersionId: string): Promise<PlanVersion> {
  const plan = await ctx.store.loadPlanVersion(planVersionId);
  if (!plan) throw new PlanAuthorityError('Plan version not found.', 'NOT_FOUND');
  verifyPlanIsActiveAuthority(plan, ctx.now());
  return plan;
}

export async function resolveActivePlan(ctx: PlanServiceContext, planCode: PlanCode, billingCycle: BillingCycle): Promise<PlanVersion | null> {
  return ctx.store.findActivePlan(planCode, billingCycle);
}
