import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  draftWorkingHoursPolicy, approveAndActivateWorkingHoursPolicy, reviseWorkingHoursPolicy, requireActiveWorkingHoursPolicy,
  isWithinWorkingHours, requireWithinWorkingHours, setFeatureFlag, requireFeatureEnabled, checkAutomationGateExtended,
  FounderControlError, type FounderControlContext, type WorkingHoursSchedule, type WorkingHoursPolicy, type FeatureFlag
} from '@/server/agents/automation/founder-controls';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { pauseChannel, pauseWorkflow, activateEmergencyStop, pauseGlobal, type AutomationContext } from '@/server/agents/automation/automation-service';
import { draftAutomationPolicy, approveAndActivateAutomationPolicy } from '@/server/agents/automation/risk-policy-engine';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';
import { AutomationPolicyError } from '@/server/agents/automation/automation-policy-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

class CombinedStore extends InMemoryAutomationStore {
  private readonly workingHoursPolicies = new Map<string, WorkingHoursPolicy>();
  private readonly featureFlags = new Map<string, FeatureFlag>();
  private readonly controlEvents: Array<{ eventId: string; controlKind: string; controlKey: string | null; action: string; actorId: string }> = [];

  async loadWorkingHoursPolicy(policyId: string) { return this.workingHoursPolicies.get(policyId) ?? null; }
  async saveWorkingHoursPolicy(policy: WorkingHoursPolicy) { this.workingHoursPolicies.set(policy.policyId, policy); }
  async findActiveWorkingHoursPolicyByCode(policyCode: string) {
    for (const p of this.workingHoursPolicies.values()) if (p.policyCode === policyCode && p.status === 'ACTIVE') return p;
    return null;
  }
  async loadFeatureFlag(flagCode: string) { return this.featureFlags.get(flagCode) ?? null; }
  async saveFeatureFlag(flag: FeatureFlag) { this.featureFlags.set(flag.flagCode, flag); }
  async recordFounderControlEvent(event: { eventId: string; controlKind: string; controlKey: string | null; action: string; actorId: string }) { this.controlEvents.push(event); }
}

function ctx(): AutomationContext & FounderControlContext & { store: CombinedStore } {
  const store = new CombinedStore();
  return { store, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

const BUSINESS_HOURS: WorkingHoursSchedule = { '6': [{ startMinute: 540, endMinute: 1020 }] };

test('an active working-hours policy requires real approval and a matching content hash', async () => {
  const c = ctx();
  const { policyId } = await draftWorkingHoursPolicy(c, { policyCode: 'default.hours', timezone: 'Asia/Baku', schedule: BUSINESS_HOURS });
  await approveAndActivateWorkingHoursPolicy(c, policyId, randomUUID());
  const policy = await requireActiveWorkingHoursPolicy(c, 'default.hours');
  assert.equal(policy.status, 'ACTIVE');
  assert.ok(policy.contentHash);
});

test('a DRAFT working-hours policy is refused as authority', async () => {
  const c = ctx();
  await draftWorkingHoursPolicy(c, { policyCode: 'unapproved.hours', timezone: 'Asia/Baku', schedule: BUSINESS_HOURS });
  await assert.rejects(
    () => requireActiveWorkingHoursPolicy(c, 'unapproved.hours'),
    (e: unknown) => e instanceof FounderControlError && e.code === 'NOT_ACTIVE'
  );
});

test('revising an active working-hours policy invalidates the approval until re-approved', async () => {
  const c = ctx();
  const { policyId } = await draftWorkingHoursPolicy(c, { policyCode: 'revise.hours', timezone: 'Asia/Baku', schedule: BUSINESS_HOURS });
  await approveAndActivateWorkingHoursPolicy(c, policyId, randomUUID());
  await reviseWorkingHoursPolicy(c, policyId, { '6': [{ startMinute: 0, endMinute: 1439 }] });
  await assert.rejects(
    () => requireActiveWorkingHoursPolicy(c, 'revise.hours'),
    (e: unknown) => e instanceof FounderControlError && e.code === 'NOT_ACTIVE'
  );
});

test('isWithinWorkingHours correctly evaluates a minute-of-day against the schedule', () => {
  assert.equal(isWithinWorkingHours(BUSINESS_HOURS, 6, 600), true);
  assert.equal(isWithinWorkingHours(BUSINESS_HOURS, 6, 100), false);
  assert.equal(isWithinWorkingHours(BUSINESS_HOURS, 1, 600), false);
});

test('requireWithinWorkingHours refuses outside the approved schedule', async () => {
  const c = ctx();
  const { policyId } = await draftWorkingHoursPolicy(c, { policyCode: 'strict.hours', timezone: 'Asia/Baku', schedule: BUSINESS_HOURS });
  await approveAndActivateWorkingHoursPolicy(c, policyId, randomUUID());
  await assert.rejects(
    () => requireWithinWorkingHours(c, 'strict.hours', 6, 100),
    (e: unknown) => e instanceof FounderControlError && e.code === 'OUTSIDE_WORKING_HOURS'
  );
});

test('a feature flag that was never set defaults to disabled', async () => {
  const c = ctx();
  await assert.rejects(
    () => requireFeatureEnabled(c, 'never.configured.feature'),
    (e: unknown) => e instanceof FounderControlError && e.code === 'FEATURE_DISABLED'
  );
});

test('setFeatureFlag requires a real human actor', async () => {
  const c = ctx();
  await assert.rejects(
    () => setFeatureFlag(c, 'test.feature', true, ''),
    (e: unknown) => e instanceof FounderControlError && e.code === 'VALIDATION'
  );
});

test('an explicitly enabled feature flag passes requireFeatureEnabled', async () => {
  const c = ctx();
  await setFeatureFlag(c, 'test.feature.enabled', true, randomUUID());
  await assert.doesNotReject(() => requireFeatureEnabled(c, 'test.feature.enabled'));
});

test('a paused channel blocks the extended gate for that channel', async () => {
  const c = ctx();
  await pauseChannel(c, 'WHATSAPP', randomUUID(), 'INCIDENT');
  await assert.rejects(
    () => checkAutomationGateExtended(c, { agentCode: null, channel: 'WHATSAPP', workflowCode: null, workingHoursPolicyCode: null, requiredFeatureFlag: null, level1PolicyCode: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'AGENT_PAUSED'
  );
});

test('pausing one channel does not affect a different channel', async () => {
  const c = ctx();
  await pauseChannel(c, 'WHATSAPP', randomUUID(), 'INCIDENT');
  await assert.doesNotReject(
    () => checkAutomationGateExtended(c, { agentCode: null, channel: 'VOICE', workflowCode: null, workingHoursPolicyCode: null, requiredFeatureFlag: null, level1PolicyCode: null })
  );
});

test('a paused workflow blocks the extended gate for that workflow', async () => {
  const c = ctx();
  await pauseWorkflow(c, 'customer.journey.v1', randomUUID(), 'MAINTENANCE');
  await assert.rejects(
    () => checkAutomationGateExtended(c, { agentCode: null, channel: null, workflowCode: 'customer.journey.v1', workingHoursPolicyCode: null, requiredFeatureFlag: null, level1PolicyCode: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'AGENT_PAUSED'
  );
});

test('emergency stop blocks the extended gate even when channel/workflow/feature/working-hours would otherwise all pass', async () => {
  const c = ctx();
  await setFeatureFlag(c, 'ok.feature', true, randomUUID());
  const { policyId } = await draftWorkingHoursPolicy(c, { policyCode: 'ok.hours', timezone: 'Asia/Baku', schedule: BUSINESS_HOURS });
  await approveAndActivateWorkingHoursPolicy(c, policyId, randomUUID());
  await activateEmergencyStop(c, randomUUID(), 'CRITICAL_INCIDENT');
  await assert.rejects(
    () => checkAutomationGateExtended(c, {
      agentCode: null, channel: null, workflowCode: null, workingHoursPolicyCode: 'ok.hours',
      isoWeekday: 6, minuteOfDay: 600, requiredFeatureFlag: 'ok.feature', level1PolicyCode: null
    }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
});

test('global pause blocks the extended gate even when channel/workflow/feature/working-hours would otherwise all pass', async () => {
  const c = ctx();
  await setFeatureFlag(c, 'ok.feature2', true, randomUUID());
  await pauseGlobal(c, randomUUID(), 'MAINTENANCE_WINDOW');
  await assert.rejects(
    () => checkAutomationGateExtended(c, { agentCode: null, channel: null, workflowCode: null, workingHoursPolicyCode: null, requiredFeatureFlag: 'ok.feature2', level1PolicyCode: null }),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'GLOBALLY_PAUSED'
  );
});

test('the extended gate passes cleanly when every configured check is satisfied', async () => {
  const c = ctx();
  await setFeatureFlag(c, 'all.ok.feature', true, randomUUID());
  const { policyId } = await draftWorkingHoursPolicy(c, { policyCode: 'all.ok.hours', timezone: 'Asia/Baku', schedule: BUSINESS_HOURS });
  await approveAndActivateWorkingHoursPolicy(c, policyId, randomUUID());
  const { policyId: level1PolicyId } = await draftAutomationPolicy(c, { policyCode: 'all.ok.level1', scope: 'TEST', rules: {} });
  await approveAndActivateAutomationPolicy(c, level1PolicyId, randomUUID());

  await assert.doesNotReject(() => checkAutomationGateExtended(c, {
    agentCode: null, channel: 'VOICE', workflowCode: 'some.workflow', workingHoursPolicyCode: 'all.ok.hours',
    isoWeekday: 6, minuteOfDay: 600, requiredFeatureFlag: 'all.ok.feature', level1PolicyCode: 'all.ok.level1'
  }));
});

test('the extended gate refuses when the risk-policy authorization (point 8) fails, even if every earlier point passes', async () => {
  const c = ctx();
  await assert.rejects(
    () => checkAutomationGateExtended(c, {
      agentCode: null, channel: null, workflowCode: null, workingHoursPolicyCode: null,
      requiredFeatureFlag: null, level1PolicyCode: 'nonexistent.policy'
    }),
    (e: unknown) => e instanceof AutomationPolicyError && e.code === 'NOT_ACTIVE'
  );
});
