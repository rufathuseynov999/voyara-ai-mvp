import { z } from 'zod';
import { sha256 } from '@/server/bos/canonical-json';

/**
 * Phase 4G — durable automation foundation contract.
 *
 * The action-level taxonomy is the central safety concept of this module:
 *   LEVEL_1 — autonomous; may complete without human approval
 *   LEVEL_2 — human approval required; `completeLevel2Step` is the ONLY
 *             function anywhere in this module that can mark a Level 2
 *             step COMPLETED, and it refuses without a real approver,
 *             timestamp, and content hash — enforced here AND again by the
 *             database's own CHECK constraint, as two independent layers.
 *   LEVEL_3 — structurally impossible to execute. There is no function
 *             anywhere in this codebase, in this module or any other, that
 *             can mark a Level 3 step COMPLETED — not gated by a flag, not
 *             reachable through any parameter combination. The database's
 *             own CHECK constraint refuses it unconditionally as a second,
 *             independent enforcement layer beneath the application code.
 */

export const workflowVersionStatuses = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type WorkflowVersionStatus = (typeof workflowVersionStatuses)[number];

export const workflowRunStatuses = ['PENDING', 'RUNNING', 'PAUSED', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'] as const;
export type WorkflowRunStatus = (typeof workflowRunStatuses)[number];

export const workflowStepStatuses = ['PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'SKIPPED'] as const;
export type WorkflowStepStatus = (typeof workflowStepStatuses)[number];

export const workflowActionLevels = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'] as const;
export type WorkflowActionLevel = (typeof workflowActionLevels)[number];

export const workflowVersionSchema = z.object({
  workflowVersionId: z.uuid(),
  workflowDefinitionId: z.uuid(),
  version: z.number().int().positive(),
  stepGraph: z.record(z.string(), z.unknown()),
  status: z.enum(workflowVersionStatuses),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  contentHash: z.string().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict().refine(
  (v) => v.status !== 'ACTIVE' || (v.approvedBy !== null && v.approvedAt !== null && v.contentHash !== null),
  { message: 'an ACTIVE workflow version must carry a human approver, approval timestamp, and content hash' }
);
export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

export const workflowStepSchema = z.object({
  stepId: z.uuid(),
  workflowRunId: z.uuid(),
  stepIndex: z.number().int().nonnegative(),
  stepCode: z.string().min(1),
  actionLevel: z.enum(workflowActionLevels),
  status: z.enum(workflowStepStatuses),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  approvalContentHash: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict().refine(
  (s) => s.actionLevel !== 'LEVEL_2' || s.status !== 'COMPLETED' || (s.approvedBy !== null && s.approvedAt !== null && s.approvalContentHash !== null),
  { message: 'a Level 2 step can only be COMPLETED with a real human approver, timestamp, and content hash' }
).refine(
  (s) => s.actionLevel !== 'LEVEL_3' || s.status !== 'COMPLETED',
  { message: 'a Level 3 step can never be COMPLETED — this is a structural impossibility, not a policy choice' }
);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export class AutomationAuthorityError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'VALIDATION' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'STALE_HASH' | 'RETIRED'
      | 'INVALID_TRANSITION' | 'MISSING_APPROVAL' | 'LEVEL_3_FORBIDDEN'
      | 'GLOBALLY_PAUSED' | 'AGENT_PAUSED' | 'EMERGENCY_STOP_ACTIVE' | 'DUPLICATE_EVENT'
      | 'MISSING_AUTHORITATIVE_PROPOSAL_MATERIAL' | 'UNSUPPORTED_PROPOSAL_TYPE' | 'NOT_CONFIGURED'
  ) {
    super(message);
    this.name = 'AutomationAuthorityError';
  }
}

export function workflowVersionHashInput(v: { workflowDefinitionId: string; version: number; stepGraph: Record<string, unknown> }) {
  return { workflowDefinitionId: v.workflowDefinitionId, version: v.version, stepGraph: v.stepGraph };
}

export function verifyWorkflowVersionIsActiveAuthority(version: WorkflowVersion): void {
  if (version.status === 'RETIRED') throw new AutomationAuthorityError('Workflow version is retired.', 'RETIRED');
  if (version.status !== 'ACTIVE') throw new AutomationAuthorityError(`Workflow version is not active (status: ${version.status}).`, 'NOT_ACTIVE');
  const recomputed = sha256(workflowVersionHashInput(version));
  if (recomputed !== version.contentHash) {
    throw new AutomationAuthorityError('Workflow version content hash no longer matches what was approved.', 'STALE_HASH');
  }
}

export function stepApprovalHashInput(step: { stepId: string; workflowRunId: string; stepCode: string; actionLevel: WorkflowActionLevel }) {
  return { stepId: step.stepId, workflowRunId: step.workflowRunId, stepCode: step.stepCode, actionLevel: step.actionLevel };
}
