import { z } from 'zod';
import { sha256 } from '@/server/bos/canonical-json';

/**
 * Phase 4F — plan authority and versioning.
 *
 * Mirrors the exact discipline already proven for `contracts` (Phase 4E)
 * and `message_send_policies` (Phase 4C): a plan can only grant
 * entitlements once it is genuinely ACTIVE, and ACTIVE always requires a
 * real human approver and a matching content hash, re-verified at the
 * moment of every use — not just checked once at approval time.
 *
 * The locked founder-approved catalog (prices, plan codes) is baked into
 * `LOCKED_PLAN_PRICES` below and is NEVER modifiable by any function in
 * this file — `draftPlanVersion` refuses to draft a plan whose price
 * doesn't match this table exactly. Changing a price requires editing this
 * source file (a code change, reviewed like any other), not a runtime
 * operation.
 */

export const planCodes = [
  'PERSONAL_SMART', 'PERSONAL_PLUS', 'PERSONAL_PREMIUM', 'PERSONAL_BLACK',
  'CORPORATE_STARTER', 'CORPORATE_STANDARD', 'CORPORATE_PROFESSIONAL', 'CORPORATE_ENTERPRISE'
] as const;
export type PlanCode = (typeof planCodes)[number];

export const planTypes = ['PERSONAL', 'CORPORATE'] as const;
export type PlanType = (typeof planTypes)[number];

export const billingCycles = ['MONTHLY', 'ANNUAL'] as const;
export type BillingCycle = (typeof billingCycles)[number];

export const planVersionStatuses = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type PlanVersionStatus = (typeof planVersionStatuses)[number];

/** The founder-locked catalog. Prices in minor units (qəpik), matching the
 *  approved landing page exactly. `null` for Enterprise — its price is
 *  never public; it is set per-contract on the corporate account instead. */
export const LOCKED_PLAN_PRICES: Record<PlanCode, Record<BillingCycle, number | null>> = {
  PERSONAL_SMART: { MONTHLY: 1900, ANNUAL: 19000 },
  PERSONAL_PLUS: { MONTHLY: 3900, ANNUAL: 39000 },
  PERSONAL_PREMIUM: { MONTHLY: 6900, ANNUAL: 69000 },
  PERSONAL_BLACK: { MONTHLY: 29900, ANNUAL: 299000 },
  CORPORATE_STARTER: { MONTHLY: 14900, ANNUAL: null },
  CORPORATE_STANDARD: { MONTHLY: 29900, ANNUAL: null },
  CORPORATE_PROFESSIONAL: { MONTHLY: 59900, ANNUAL: null },
  CORPORATE_ENTERPRISE: { MONTHLY: null, ANNUAL: null }
};

export const planVersionSchema = z.object({
  planVersionId: z.uuid(),
  planCode: z.enum(planCodes),
  planType: z.enum(planTypes),
  billingCycle: z.enum(billingCycles),
  priceMinorUnits: z.number().int().nonnegative(),
  currency: z.string().length(3),
  benefits: z.array(z.string()),
  usageLimits: z.record(z.string(), z.unknown()),
  servicePrivileges: z.array(z.string()),
  concierge_level: z.string().nullable().optional(),
  seatOrTravellerLimit: z.number().int().positive().nullable(),
  activationDate: z.string().nullable(),
  retirementDate: z.string().nullable(),
  status: z.enum(planVersionStatuses),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  contentHash: z.string().nullable(),
  version: z.number().int().positive(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict().refine(
  (p) => p.status !== 'ACTIVE' || (p.approvedBy !== null && p.approvedAt !== null && p.contentHash !== null),
  { message: 'an ACTIVE plan version must carry a human approver, approval timestamp, and content hash' }
).refine(
  (p) => p.planCode !== 'CORPORATE_ENTERPRISE' || p.status !== 'ACTIVE' || p.priceMinorUnits === 0,
  { message: 'Enterprise pricing must never be published — it is priced via a custom contract reference' }
);
export type PlanVersion = z.infer<typeof planVersionSchema>;

export class PlanAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'NOT_FOUND' | 'PRICE_MISMATCH' | 'NOT_ACTIVE' | 'STALE_HASH' | 'RETIRED' | 'DUPLICATE_ACTIVE'
  ) {
    super(message);
    this.name = 'PlanAuthorityError';
  }
}

export function planHashInput(plan: {
  planCode: PlanCode; billingCycle: BillingCycle; priceMinorUnits: number; currency: string;
  benefits: readonly string[]; usageLimits: Record<string, unknown>; servicePrivileges: readonly string[]; version: number;
}) {
  return {
    planCode: plan.planCode, billingCycle: plan.billingCycle, priceMinorUnits: plan.priceMinorUnits, currency: plan.currency,
    benefits: [...plan.benefits].sort(), usageLimits: plan.usageLimits, servicePrivileges: [...plan.servicePrivileges].sort(), version: plan.version
  };
}

export function verifyPlanIsActiveAuthority(plan: PlanVersion, now: Date): void {
  if (plan.status === 'RETIRED') throw new PlanAuthorityError(`Plan ${plan.planCode} (${plan.billingCycle}) is retired.`, 'RETIRED');
  if (plan.status !== 'ACTIVE') throw new PlanAuthorityError(`Plan ${plan.planCode} (${plan.billingCycle}) is not active (status: ${plan.status}).`, 'NOT_ACTIVE');
  if (plan.retirementDate && new Date(plan.retirementDate).getTime() < now.getTime()) {
    throw new PlanAuthorityError(`Plan ${plan.planCode} has passed its retirement date.`, 'RETIRED');
  }
  const recomputed = sha256(planHashInput(plan));
  if (recomputed !== plan.contentHash) {
    throw new PlanAuthorityError(`Plan ${plan.planCode}'s content hash no longer matches what was approved.`, 'STALE_HASH');
  }
}
