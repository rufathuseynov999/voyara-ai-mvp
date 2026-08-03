import type { WorkflowVersion, WorkflowStep, WorkflowRunStatus } from './automation-contract';
import type { AutomationPolicy } from './automation-policy-contract';

export type WorkflowRun = {
  workflowRunId: string;
  workflowVersionId: string;
  subjectType: string;
  subjectId: string | null;
  status: WorkflowRunStatus;
  currentStepIndex: number;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowExecutionEvent = {
  eventId: string;
  workflowRunId: string;
  workflowStepId: string | null;
  kind: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  correlationId: string;
  reasonCode?: string | null;
};

export type PauseScope = 'GLOBAL' | 'AGENT' | 'CHANNEL' | 'WORKFLOW';

export type PauseControl = {
  scope: PauseScope;
  scopeKey: string | null;
  paused: boolean;
  pausedBy: string | null;
  pausedAt: string | null;
  reason: string | null;
  resumedBy: string | null;
  resumedAt: string | null;
};

export type EmergencyStopState = {
  active: boolean;
  activatedBy: string | null;
  activatedAt: string | null;
  reason: string | null;
};

export interface AutomationStore {
  saveWorkflowVersion(version: WorkflowVersion): Promise<void>;
  loadWorkflowVersion(workflowVersionId: string): Promise<WorkflowVersion | null>;
  saveWorkflowVersionHistory(entry: { historyId: string; workflowVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string; correlationId: string }): Promise<void>;

  saveWorkflowRun(run: WorkflowRun): Promise<void>;
  loadWorkflowRun(workflowRunId: string): Promise<WorkflowRun | null>;
  reserveWorkflowIdempotencyKey(key: string, workflowRunId: string): Promise<{ winner: boolean; workflowRunId: string }>;

  saveWorkflowStep(step: WorkflowStep): Promise<void>;
  loadWorkflowStep(stepId: string): Promise<WorkflowStep | null>;
  recordExecutionEvent(event: WorkflowExecutionEvent): Promise<void>;

  loadPauseControl(scope: PauseScope, scopeKey: string | null): Promise<PauseControl | null>;
  savePauseControl(control: PauseControl): Promise<void>;
  recordPauseEvent(event: { eventId: string; scope: PauseScope; scopeKey: string | null; kind: 'PAUSED' | 'RESUMED'; actorId: string; reasonCode?: string | null; correlationId: string }): Promise<void>;

  loadEmergencyStopState(): Promise<EmergencyStopState>;
  saveEmergencyStopState(state: EmergencyStopState): Promise<void>;
  recordEmergencyStopEvent(event: { eventId: string; kind: 'ACTIVATED' | 'DEACTIVATED'; actorId: string; reasonCode?: string | null; correlationId: string }): Promise<void>;

  reserveWebhookOrDuplicateGuard(key: string): Promise<{ winner: boolean }>;

  saveAutomationPolicy(policy: AutomationPolicy): Promise<void>;
  loadAutomationPolicy(policyId: string): Promise<AutomationPolicy | null>;
  findActiveAutomationPolicyByCode(policyCode: string): Promise<AutomationPolicy | null>;
  saveAutomationPolicyHistory(entry: { historyId: string; automationPolicyId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string; correlationId: string }): Promise<void>;
}

export class InMemoryAutomationStore implements AutomationStore {
  private readonly workflowVersions = new Map<string, WorkflowVersion>();
  private readonly workflowVersionHistory: Array<{ historyId: string; workflowVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string }> = [];
  private readonly workflowRuns = new Map<string, WorkflowRun>();
  private readonly idempotencyKeys = new Map<string, string>();
  private readonly workflowSteps = new Map<string, WorkflowStep>();
  private readonly executionEvents: WorkflowExecutionEvent[] = [];
  private readonly pauseControls = new Map<string, PauseControl>();
  private readonly pauseEvents: Array<{ eventId: string; scope: string; scopeKey: string | null; kind: string; actorId: string }> = [];
  private emergencyStop: EmergencyStopState = { active: false, activatedBy: null, activatedAt: null, reason: null };
  private readonly emergencyStopEvents: Array<{ eventId: string; kind: string; actorId: string }> = [];
  private readonly duplicateGuardKeys = new Set<string>();
  private readonly automationPolicies = new Map<string, AutomationPolicy>();
  private readonly automationPolicyHistory: Array<{ historyId: string; automationPolicyId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string }> = [];

  async saveWorkflowVersion(version: WorkflowVersion): Promise<void> { this.workflowVersions.set(version.workflowVersionId, version); }
  async loadWorkflowVersion(workflowVersionId: string): Promise<WorkflowVersion | null> { return this.workflowVersions.get(workflowVersionId) ?? null; }
  async saveWorkflowVersionHistory(entry: { historyId: string; workflowVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string }): Promise<void> {
    this.workflowVersionHistory.push(entry);
  }

  async saveWorkflowRun(run: WorkflowRun): Promise<void> { this.workflowRuns.set(run.workflowRunId, run); }
  async loadWorkflowRun(workflowRunId: string): Promise<WorkflowRun | null> { return this.workflowRuns.get(workflowRunId) ?? null; }
  async reserveWorkflowIdempotencyKey(key: string, workflowRunId: string): Promise<{ winner: boolean; workflowRunId: string }> {
    const existing = this.idempotencyKeys.get(key);
    if (existing) return { winner: false, workflowRunId: existing };
    this.idempotencyKeys.set(key, workflowRunId);
    return { winner: true, workflowRunId };
  }

  async saveWorkflowStep(step: WorkflowStep): Promise<void> { this.workflowSteps.set(step.stepId, step); }
  async loadWorkflowStep(stepId: string): Promise<WorkflowStep | null> { return this.workflowSteps.get(stepId) ?? null; }
  async recordExecutionEvent(event: WorkflowExecutionEvent): Promise<void> { this.executionEvents.push(event); }

  private pauseKey(scope: PauseScope, scopeKey: string | null): string { return scope === 'GLOBAL' ? 'GLOBAL' : `${scope}:${scopeKey}`; }
  async loadPauseControl(scope: PauseScope, scopeKey: string | null): Promise<PauseControl | null> {
    return this.pauseControls.get(this.pauseKey(scope, scopeKey)) ?? null;
  }
  async savePauseControl(control: PauseControl): Promise<void> {
    this.pauseControls.set(this.pauseKey(control.scope, control.scopeKey), control);
  }
  async recordPauseEvent(event: { eventId: string; scope: PauseScope; scopeKey: string | null; kind: 'PAUSED' | 'RESUMED'; actorId: string }): Promise<void> {
    this.pauseEvents.push(event);
  }

  async loadEmergencyStopState(): Promise<EmergencyStopState> { return this.emergencyStop; }
  async saveEmergencyStopState(state: EmergencyStopState): Promise<void> { this.emergencyStop = state; }
  async recordEmergencyStopEvent(event: { eventId: string; kind: 'ACTIVATED' | 'DEACTIVATED'; actorId: string }): Promise<void> {
    this.emergencyStopEvents.push(event);
  }

  async reserveWebhookOrDuplicateGuard(key: string): Promise<{ winner: boolean }> {
    if (this.duplicateGuardKeys.has(key)) return { winner: false };
    this.duplicateGuardKeys.add(key);
    return { winner: true };
  }

  async saveAutomationPolicy(policy: AutomationPolicy): Promise<void> { this.automationPolicies.set(policy.policyId, policy); }
  async loadAutomationPolicy(policyId: string): Promise<AutomationPolicy | null> { return this.automationPolicies.get(policyId) ?? null; }
  async findActiveAutomationPolicyByCode(policyCode: string): Promise<AutomationPolicy | null> {
    for (const policy of this.automationPolicies.values()) {
      if (policy.policyCode === policyCode && policy.status === 'ACTIVE') return policy;
    }
    return null;
  }
  async saveAutomationPolicyHistory(entry: { historyId: string; automationPolicyId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string }): Promise<void> {
    this.automationPolicyHistory.push(entry);
  }

  executionEventsFor(workflowRunId: string): WorkflowExecutionEvent[] {
    return this.executionEvents.filter((e) => e.workflowRunId === workflowRunId);
  }
  /** Test helper — finds a step's id by its run and step index, mirroring
   *  how a real query against workflow_steps (unique on (workflow_run_id,
   *  step_index)) would resolve it. */
  stepIdForRunAndIndex(workflowRunId: string, stepIndex: number): string | null {
    for (const step of this.workflowSteps.values()) {
      if (step.workflowRunId === workflowRunId && step.stepIndex === stepIndex) return step.stepId;
    }
    return null;
  }
  workflowVersionHistoryFor(workflowVersionId: string) {
    return this.workflowVersionHistory.filter((h) => h.workflowVersionId === workflowVersionId);
  }
  allPauseEvents() { return this.pauseEvents; }
  allEmergencyStopEvents() { return this.emergencyStopEvents; }
}
