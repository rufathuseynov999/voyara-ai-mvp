import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  assertLevel0ReadOnly, draftAutomationPolicy, approveAndActivateAutomationPolicy, reviseAutomationPolicy,
  requireLevel1PolicyAuthority, executeLevel1Action, executeLevel2Action, type PolicyContext
} from '@/server/agents/automation/risk-policy-engine';
import { AutomationPolicyError } from '@/server/agents/automation/automation-policy-contract';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { pauseGlobal, activateEmergencyStop, draftWorkflowVersion, approveAndActivateWorkflowVersion, createWorkflowRun, createStep, type AutomationContext } from '@/server/agents/automation/automation-service';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): PolicyContext & { store: InMemoryAutomationStore } {
  return { store: new InMemoryAutomationStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

test('Level 0 read-only work is classified as auto-executing with no gate to pass', () => {
  const result = assertLevel0ReadOnly('load.customer.profile');
  assert.equal(result.level, 'LEVEL_0');
  assert.equal(result.autoExecute, true);
});

test('Level 1 execution is refused when no active policy exists for the code', async () => {
  const c = ctx();
  await assert.rejects(
    () => requireLevel1PolicyAuthority(c, 'nonexistent.policy'),
    (e: unknown) => e instanceof AutomationPolicyError && e.code === 'NOT_ACTIVE'
  );
});

test('Level 1 execution succeeds once a policy is drafted and approved', async () => {
  const c = ctx();
  const { policyId } = await draftAutomationPolicy(c, { policyCode: 'send.low_risk_reminder', scope: 'MESSAGING', rules: { maxPerDay: 3 } });
  await approveAndActivateAutomationPolicy(c, policyId, randomUUID());
  const policy = await requireLevel1PolicyAuthority(c, 'send.low_risk_reminder');
  assert.equal(policy.status, 'ACTIVE');
});

test('executeLevel1Action refuses when the emergency stop is active, even with an approved policy', async () => {
  const c = ctx();
  const { policyId } = await draftAutomationPolicy(c, { policyCode: 'test.policy', scope: 'TEST', rules: {} });
  await approveAndActivateAutomationPolicy(c, policyId, randomUUID());
  const automationCtx: AutomationContext = { store: c.store, correlationId: c.correlationId, now: c.now };
  await activateEmergencyStop(automationCtx, randomUUID(), 'SAFETY_INCIDENT');
  await assert.rejects(
    () => executeLevel1Action({ ...c, agentCode: null }, 'test.policy', async () => 'executed'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
});

test('executeLevel1Action refuses when globally paused, even with an approved policy', async () => {
  const c = ctx();
  const { policyId } = await draftAutomationPolicy(c, { policyCode: 'test.policy2', scope: 'TEST', rules: {} });
  await approveAndActivateAutomationPolicy(c, policyId, randomUUID());
  const automationCtx: AutomationContext = { store: c.store, correlationId: c.correlationId, now: c.now };
  await pauseGlobal(automationCtx, randomUUID(), 'MAINTENANCE');
  await assert.rejects(
    () => executeLevel1Action({ ...c, agentCode: null }, 'test.policy2', async () => 'executed'),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'GLOBALLY_PAUSED'
  );
});

test('executeLevel1Action runs the action and returns its result once gate and policy both pass', async () => {
  const c = ctx();
  const { policyId } = await draftAutomationPolicy(c, { policyCode: 'test.policy3', scope: 'TEST', rules: {} });
  await approveAndActivateAutomationPolicy(c, policyId, randomUUID());
  const result = await executeLevel1Action({ ...c, agentCode: null }, 'test.policy3', async (policy) => `ran with ${policy.policyCode}`);
  assert.equal(result, 'ran with test.policy3');
});

test('revising a policy after approval invalidates it — Level 1 execution is refused until re-approved', async () => {
  const c = ctx();
  const { policyId } = await draftAutomationPolicy(c, { policyCode: 'test.revise', scope: 'TEST', rules: { limit: 5 } });
  await approveAndActivateAutomationPolicy(c, policyId, randomUUID());
  await requireLevel1PolicyAuthority(c, 'test.revise');

  await reviseAutomationPolicy(c, policyId, { limit: 100 });
  await assert.rejects(
    () => requireLevel1PolicyAuthority(c, 'test.revise'),
    (e: unknown) => e instanceof AutomationPolicyError && e.code === 'NOT_ACTIVE'
  );
});

test('tampering with an active policy\'s content without going through revision is caught by stale-hash rejection', async () => {
  const c = ctx();
  const { policyId } = await draftAutomationPolicy(c, { policyCode: 'test.tamper', scope: 'TEST', rules: { limit: 5 } });
  await approveAndActivateAutomationPolicy(c, policyId, randomUUID());
  const active = await c.store.loadAutomationPolicy(policyId);
  await c.store.saveAutomationPolicy({ ...active!, rules: { limit: 99999 } });
  await assert.rejects(
    () => requireLevel1PolicyAuthority(c, 'test.tamper'),
    (e: unknown) => e instanceof AutomationPolicyError && e.code === 'STALE_HASH'
  );
});

async function activeWorkflowRunWithLevel2Step(c: ReturnType<typeof ctx>) {
  const automationCtx: AutomationContext = { store: c.store, correlationId: c.correlationId, now: c.now };
  const { workflowVersionId } = await draftWorkflowVersion(automationCtx, { workflowDefinitionId: randomUUID(), version: 1, stepGraph: {} });
  await approveAndActivateWorkflowVersion(automationCtx, workflowVersionId, randomUUID());
  const { workflowRunId } = await createWorkflowRun(automationCtx, { workflowVersionId, subjectType: 'test', subjectId: null, agentCode: null }, `idem-${randomUUID()}`);
  const { stepId } = await createStep(automationCtx, workflowRunId, 0, 'sensitive.action', 'LEVEL_2');
  return { automationCtx, stepId };
}

test('a Level 2 approval is single-use: completing the same step twice is refused the second time', async () => {
  const c = ctx();
  const { automationCtx, stepId } = await activeWorkflowRunWithLevel2Step(c);
  const approver = randomUUID();
  await executeLevel2Action(automationCtx, stepId, approver);
  await assert.rejects(
    () => executeLevel2Action(automationCtx, stepId, approver),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('a Level 2 approval cannot be reused by a different approver either — single-use applies regardless of who retries', async () => {
  const c = ctx();
  const { automationCtx, stepId } = await activeWorkflowRunWithLevel2Step(c);
  await executeLevel2Action(automationCtx, stepId, randomUUID());
  await assert.rejects(
    () => executeLevel2Action(automationCtx, stepId, randomUUID()),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('no executeLevel3Action function exists in risk-policy-engine.ts', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/risk-policy-engine.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/export\s+(async\s+)?function\s+executeLevel3/i.test(codeOnly));
});

test('no function anywhere in the automation module exposes a Level 3 execution path', async () => {
  const { readFile } = await import('node:fs/promises');
  const files = ['automation-service.ts', 'risk-policy-engine.ts', 'workflow-runtime.ts'];
  for (const file of files) {
    const raw = await readFile(new URL(`../../src/server/agents/automation/${file}`, import.meta.url), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/completeLevel3|executeLevel3|runLevel3/i.test(codeOnly), `${file} must not expose a Level 3 execution path`);
  }
});
