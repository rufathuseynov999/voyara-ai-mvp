import { randomUUID } from 'node:crypto';
import { sha256 } from '@/server/bos/canonical-json';
import { AutomationAuthorityError } from './automation-contract';
import { checkAutomationGate, type AutomationContext } from './automation-service';
import { requireLevel1PolicyAuthority, type PolicyContext } from './risk-policy-engine';

/**
 * Phase 4G — founder control services built on the Migration 25 schema.
 *
 * `checkAutomationGateExtended` implements the exact 8-point check order
 * specified: emergency stop, global pause, agent pause, channel pause,
 * workflow pause, working-hours policy, feature flag, risk-policy
 * authorization. It reuses `checkAutomationGate` unchanged for the first
 * three checks rather than duplicating that logic — every existing call
 * site that only needs the original 3-point check keeps working exactly
 * as before; this is a strict superset for callers that need the full
 * founder-control surface.
 */

export type WorkingHoursSchedule = {
  [isoWeekday: string]: Array<{ startMinute: number; endMinute: number }>;
};

export type WorkingHoursPolicy = {
  policyId: string;
  policyCode: string;
  timezone: string;
  schedule: WorkingHoursSchedule;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  approvedBy: string | null;
  approvedAt: string | null;
  contentHash: string | null;
  version: number;
  correlationId: string;
};

export type FeatureFlag = { flagCode: string; enabled: boolean };

export interface FounderControlStore {
  loadWorkingHoursPolicy(policyId: string): Promise<WorkingHoursPolicy | null>;
  saveWorkingHoursPolicy(policy: WorkingHoursPolicy): Promise<void>;
  findActiveWorkingHoursPolicyByCode(policyCode: string): Promise<WorkingHoursPolicy | null>;
  loadFeatureFlag(flagCode: string): Promise<FeatureFlag | null>;
  saveFeatureFlag(flag: FeatureFlag, changedBy: string): Promise<void>;
  recordFounderControlEvent(event: { eventId: string; controlKind: string; controlKey: string | null; action: string; actorId: string; reasonCode?: string | null; correlationId: string }): Promise<void>;
}

export class InMemoryFounderControlStore implements FounderControlStore {
  private readonly workingHoursPolicies = new Map<string, WorkingHoursPolicy>();
  private readonly featureFlags = new Map<string, FeatureFlag>();
  private readonly controlEvents: Array<{ eventId: string; controlKind: string; controlKey: string | null; action: string; actorId: string }> = [];

  async loadWorkingHoursPolicy(policyId: string): Promise<WorkingHoursPolicy | null> { return this.workingHoursPolicies.get(policyId) ?? null; }
  async saveWorkingHoursPolicy(policy: WorkingHoursPolicy): Promise<void> { this.workingHoursPolicies.set(policy.policyId, policy); }
  async findActiveWorkingHoursPolicyByCode(policyCode: string): Promise<WorkingHoursPolicy | null> {
    for (const p of this.workingHoursPolicies.values()) if (p.policyCode === policyCode && p.status === 'ACTIVE') return p;
    return null;
  }
  async loadFeatureFlag(flagCode: string): Promise<FeatureFlag | null> { return this.featureFlags.get(flagCode) ?? null; }
  async saveFeatureFlag(flag: FeatureFlag): Promise<void> { this.featureFlags.set(flag.flagCode, flag); }
  async recordFounderControlEvent(event: { eventId: string; controlKind: string; controlKey: string | null; action: string; actorId: string }): Promise<void> {
    this.controlEvents.push(event);
  }

  controlEventsFor(controlKind: string) { return this.controlEvents.filter((e) => e.controlKind === controlKind); }
}

export type FounderControlContext = { store: FounderControlStore; correlationId: string; now: () => Date };

function workingHoursHashInput(p: { policyCode: string; timezone: string; schedule: WorkingHoursSchedule; version: number }) {
  return { policyCode: p.policyCode, timezone: p.timezone, schedule: p.schedule, version: p.version };
}

export class FounderControlError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'STALE_HASH' | 'OUTSIDE_WORKING_HOURS' | 'FEATURE_DISABLED') {
    super(message);
    this.name = 'FounderControlError';
  }
}

export async function draftWorkingHoursPolicy(ctx: FounderControlContext, input: { policyCode: string; timezone: string; schedule: WorkingHoursSchedule }): Promise<{ policyId: string }> {
  const policyId = randomUUID();
  const policy: WorkingHoursPolicy = { policyId, ...input, status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null, version: 1, correlationId: ctx.correlationId };
  await ctx.store.saveWorkingHoursPolicy(policy);
  return { policyId };
}

export async function approveAndActivateWorkingHoursPolicy(ctx: FounderControlContext, policyId: string, approvedBy: string): Promise<void> {
  if (!approvedBy) throw new FounderControlError('A real human approver is required.', 'VALIDATION');
  const policy = await ctx.store.loadWorkingHoursPolicy(policyId);
  if (!policy) throw new FounderControlError('Working-hours policy not found.', 'NOT_FOUND');
  const contentHash = sha256(workingHoursHashInput(policy));
  const activated: WorkingHoursPolicy = { ...policy, status: 'ACTIVE', approvedBy, approvedAt: ctx.now().toISOString(), contentHash };
  await ctx.store.saveWorkingHoursPolicy(activated);
  await ctx.store.recordFounderControlEvent({ eventId: randomUUID(), controlKind: 'WORKING_HOURS', controlKey: policy.policyCode, action: 'APPROVED', actorId: approvedBy, correlationId: ctx.correlationId });
}

export async function reviseWorkingHoursPolicy(ctx: FounderControlContext, policyId: string, revisedSchedule: WorkingHoursSchedule): Promise<{ newVersion: number }> {
  const policy = await ctx.store.loadWorkingHoursPolicy(policyId);
  if (!policy) throw new FounderControlError('Working-hours policy not found.', 'NOT_FOUND');
  const newVersion = policy.version + 1;
  const revised: WorkingHoursPolicy = { ...policy, schedule: revisedSchedule, status: 'DRAFT', approvedBy: null, approvedAt: null, contentHash: null, version: newVersion };
  await ctx.store.saveWorkingHoursPolicy(revised);
  return { newVersion };
}

export async function requireActiveWorkingHoursPolicy(ctx: FounderControlContext, policyCode: string): Promise<WorkingHoursPolicy> {
  const policy = await ctx.store.findActiveWorkingHoursPolicyByCode(policyCode);
  if (!policy) throw new FounderControlError(`No active working-hours policy found for "${policyCode}".`, 'NOT_ACTIVE');
  const recomputed = sha256(workingHoursHashInput(policy));
  if (recomputed !== policy.contentHash) throw new FounderControlError(`Working-hours policy "${policyCode}"'s content hash no longer matches what was approved.`, 'STALE_HASH');
  return policy;
}

export function isWithinWorkingHours(schedule: WorkingHoursSchedule, isoWeekday: number, minuteOfDay: number): boolean {
  const windows = schedule[String(isoWeekday)] ?? [];
  return windows.some((w) => minuteOfDay >= w.startMinute && minuteOfDay < w.endMinute);
}

export async function requireWithinWorkingHours(ctx: FounderControlContext, policyCode: string, isoWeekday: number, minuteOfDay: number): Promise<void> {
  const policy = await requireActiveWorkingHoursPolicy(ctx, policyCode);
  if (!isWithinWorkingHours(policy.schedule, isoWeekday, minuteOfDay)) {
    throw new FounderControlError(`Outside working hours for policy "${policyCode}".`, 'OUTSIDE_WORKING_HOURS');
  }
}

export async function setFeatureFlag(ctx: FounderControlContext, flagCode: string, enabled: boolean, changedBy: string): Promise<void> {
  if (!changedBy) throw new FounderControlError('A real human actor is required to change a feature flag.', 'VALIDATION');
  await ctx.store.saveFeatureFlag({ flagCode, enabled }, changedBy);
  await ctx.store.recordFounderControlEvent({ eventId: randomUUID(), controlKind: 'FEATURE_FLAG', controlKey: flagCode, action: enabled ? 'ENABLED' : 'DISABLED', actorId: changedBy, correlationId: ctx.correlationId });
}

export async function requireFeatureEnabled(ctx: FounderControlContext, flagCode: string): Promise<void> {
  const flag = await ctx.store.loadFeatureFlag(flagCode);
  if (!flag || !flag.enabled) throw new FounderControlError(`Feature "${flagCode}" is disabled.`, 'FEATURE_DISABLED');
}

export async function checkAutomationGateExtended(
  ctx: AutomationContext & FounderControlContext,
  input: {
    agentCode: string | null;
    channel: string | null;
    workflowCode: string | null;
    workingHoursPolicyCode: string | null;
    isoWeekday?: number;
    minuteOfDay?: number;
    requiredFeatureFlag: string | null;
    level1PolicyCode: string | null;
  }
): Promise<void> {
  await checkAutomationGate(ctx, input.agentCode);

  if (input.channel) {
    const channelPause = await ctx.store.loadPauseControl('CHANNEL', input.channel);
    if (channelPause?.paused) throw new AutomationAuthorityError(`Channel "${input.channel}" is paused: ${channelPause.reason}`, 'AGENT_PAUSED');
  }

  if (input.workflowCode) {
    const workflowPause = await ctx.store.loadPauseControl('WORKFLOW', input.workflowCode);
    if (workflowPause?.paused) throw new AutomationAuthorityError(`Workflow "${input.workflowCode}" is paused: ${workflowPause.reason}`, 'AGENT_PAUSED');
  }

  if (input.workingHoursPolicyCode && input.isoWeekday !== undefined && input.minuteOfDay !== undefined) {
    await requireWithinWorkingHours(ctx, input.workingHoursPolicyCode, input.isoWeekday, input.minuteOfDay);
  }

  if (input.requiredFeatureFlag) {
    await requireFeatureEnabled(ctx, input.requiredFeatureFlag);
  }

  if (input.level1PolicyCode) {
    const policyCtx: PolicyContext = { store: ctx.store, correlationId: ctx.correlationId, now: ctx.now };
    await requireLevel1PolicyAuthority(policyCtx, input.level1PolicyCode);
  }
}
