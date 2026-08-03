import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import type { AutomationStore } from './automation-store';
import {
  AutomationPolicyError, automationPolicySchema, automationPolicyHashInput, verifyAutomationPolicyIsActiveAuthority,
  type AutomationPolicy
} from './automation-policy-contract';
import { checkAutomationGate, completeLevel2Step, type AutomationContext } from './automation-service';

/**
 * Phase 4G — deterministic Level 0–3 risk/approval engine. Reuses the
 * existing approval-by-content-hash architecture (proven across contracts,
 * plans, and workflow versions) rather than inventing a parallel one; the
 * Level 2 execution path reuses `completeLevel2Step` unchanged.
 *
 *   LEVEL_0 — read-only. Executes automatically; there is nothing to
 *             authorize because nothing is written. `assertLevel0ReadOnly`
 *             is a documentation/assertion helper, not a gate — a genuine
 *             read has no side effect to gate.
 *   LEVEL_1 — autonomous, but ONLY under an ACTIVE, approved automation
 *             policy. `requireLevel1PolicyAuthority` re-verifies the
 *             policy's hash at the moment of every use — a policy edited
 *             without a new version/re-approval stops authorizing
 *             immediately (stale-hash rejection), exactly like contracts
 *             and plan versions.
 *   LEVEL_2 — requires a real, single-use human approval before executing.
 *             `completeLevel2Step` (already built) is reused unchanged as
 *             the execution path.
 *   LEVEL_3 — never exposes an execution path. There is no function in
 *             this file, or anywhere else in this codebase, that can
 *             execute a Level 3 action — proven both behaviorally and by
 *             structural source-scan tests.
 */

export type PolicyContext = { store: AutomationStore; correlationId: string; now: () => Date };

export function assertLevel0ReadOnly(actionCode: string): { level: 'LEVEL_0'; actionCode: string; autoExecute: true } {
  return { level: 'LEVEL_0', actionCode, autoExecute: true };
}

export async function draftAutomationPolicy(ctx: PolicyContext, input: { policyCode: string; scope: string; rules: Record<string, unknown> }): Promise<{ policyId: string }> {
  const policyId = randomUUID();
  const now = ctx.now().toISOString();
  const policy: AutomationPolicy = {
    policyId, policyCode: input.policyCode, scope: input.scope, rules: input.rules, status: 'DRAFT',
    approvedBy: null, approvedAt: null, contentHash: null, version: 1, correlationId: ctx.correlationId, createdAt: now, updatedAt: now
  };
  const parsed = automationPolicySchema.safeParse(policy);
  if (!parsed.success) throw new AutomationPolicyError('Invalid automation policy draft.', 'VALIDATION');
  await ctx.store.saveAutomationPolicy(policy);
  return { policyId };
}

export async function approveAndActivateAutomationPolicy(ctx: PolicyContext, policyId: string, approvedBy: string): Promise<void> {
  if (!approvedBy) throw new AutomationPolicyError('A real human approver is required.', 'VALIDATION');
  const policy = await ctx.store.loadAutomationPolicy(policyId);
  if (!policy) throw new AutomationPolicyError('Automation policy not found.', 'NOT_FOUND');

  const contentHash = sha256(automationPolicyHashInput(policy));
  const now = ctx.now().toISOString();
  const activated: AutomationPolicy = { ...policy, status: 'ACTIVE', approvedBy, approvedAt: now, contentHash, updatedAt: now };
  const parsed = automationPolicySchema.safeParse(activated);
  if (!parsed.success) throw new AutomationPolicyError('Policy failed validation on activation.', 'VALIDATION');

  await ctx.store.saveAutomationPolicy(activated);
  await ctx.store.saveAutomationPolicyHistory({
    historyId: randomUUID(), automationPolicyId: policyId, version: activated.version, contentHash,
    snapshot: automationPolicyHashInput(activated), createdBy: approvedBy, correlationId: ctx.correlationId
  });
}

export async function reviseAutomationPolicy(ctx: PolicyContext, policyId: string, revisedRules: Record<string, unknown>): Promise<{ newVersion: number }> {
  const policy = await ctx.store.loadAutomationPolicy(policyId);
  if (!policy) throw new AutomationPolicyError('Automation policy not found.', 'NOT_FOUND');
  const newVersion = policy.version + 1;
  const now = ctx.now().toISOString();
  const revised: AutomationPolicy = { ...policy, rules: revisedRules, status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null, version: newVersion, updatedAt: now };
  await ctx.store.saveAutomationPolicy(revised);
  return { newVersion };
}

export async function requireLevel1PolicyAuthority(ctx: PolicyContext, policyCode: string): Promise<AutomationPolicy> {
  const policy = await ctx.store.findActiveAutomationPolicyByCode(policyCode);
  if (!policy) throw new AutomationPolicyError(`No active automation policy found for "${policyCode}".`, 'NOT_ACTIVE');
  verifyAutomationPolicyIsActiveAuthority(policy);
  return policy;
}

export async function executeLevel1Action<T>(
  ctx: PolicyContext & { agentCode: string | null },
  policyCode: string,
  action: (policy: AutomationPolicy) => Promise<T>
): Promise<T> {
  const gateCtx: AutomationContext = { store: ctx.store, correlationId: ctx.correlationId, now: ctx.now };
  await checkAutomationGate(gateCtx, ctx.agentCode);
  const policy = await requireLevel1PolicyAuthority(ctx, policyCode);
  return action(policy);
}

export async function executeLevel2Action(ctx: AutomationContext, stepId: string, approvedBy: string): Promise<void> {
  await completeLevel2Step(ctx, stepId, approvedBy);
}

/** There is no `executeLevel3Action` function. This is not an oversight —
 *  see automation-service.ts's own structural test proving no
 *  `completeLevel3*` function exists anywhere in this codebase. Level 3
 *  actions have no execution path by design, not by a runtime check that
 *  could be bypassed. */
