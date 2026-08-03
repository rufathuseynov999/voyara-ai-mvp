import { z } from 'zod';
import { sha256 } from '@/server/bos/canonical-json';

/**
 * Phase 4G — automation policy contract.
 *
 * A Level 1 (autonomous) action may only execute under an ACTIVE, approved
 * automation policy — mirroring the exact discipline already proven for
 * message_send_policies (Phase 4C), contracts (Phase 4E), and plan_versions
 * (Phase 4F). Changing a policy's rules without a new version/re-approval
 * invalidates it immediately via stale-hash rejection — a policy that was
 * approved yesterday does not silently keep authorizing today's different
 * content.
 */

export const automationPolicyStatuses = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type AutomationPolicyStatus = (typeof automationPolicyStatuses)[number];

export const automationPolicySchema = z.object({
  policyId: z.uuid(),
  policyCode: z.string().min(1),
  scope: z.string().min(1),
  rules: z.record(z.string(), z.unknown()),
  status: z.enum(automationPolicyStatuses),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  contentHash: z.string().nullable(),
  version: z.number().int().positive(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict().refine(
  (p) => p.status !== 'ACTIVE' || (p.approvedBy !== null && p.approvedAt !== null && p.contentHash !== null),
  { message: 'an ACTIVE automation policy must carry a human approver, approval timestamp, and content hash' }
);
export type AutomationPolicy = z.infer<typeof automationPolicySchema>;

export class AutomationPolicyError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'STALE_HASH' | 'RETIRED') {
    super(message);
    this.name = 'AutomationPolicyError';
  }
}

export function automationPolicyHashInput(p: { policyCode: string; scope: string; rules: Record<string, unknown>; version: number }) {
  return { policyCode: p.policyCode, scope: p.scope, rules: p.rules, version: p.version };
}

export function verifyAutomationPolicyIsActiveAuthority(policy: AutomationPolicy): void {
  if (policy.status === 'RETIRED') throw new AutomationPolicyError(`Automation policy "${policy.policyCode}" is retired.`, 'RETIRED');
  if (policy.status !== 'ACTIVE') throw new AutomationPolicyError(`Automation policy "${policy.policyCode}" is not active (status: ${policy.status}).`, 'NOT_ACTIVE');
  const recomputed = sha256(automationPolicyHashInput(policy));
  if (recomputed !== policy.contentHash) {
    throw new AutomationPolicyError(`Automation policy "${policy.policyCode}"'s content hash no longer matches what was approved.`, 'STALE_HASH');
  }
}
