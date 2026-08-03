import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStaffActionGatePlan, gatePlanToExtendedGateInput } from '@/server/agents/automation/staff-action-authority-policy';

test('emergency stop and global pause are always CONFIGURED, regardless of context', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  assert.equal(plan.find((p) => p.point === 'EMERGENCY_STOP')?.status, 'CONFIGURED');
  assert.equal(plan.find((p) => p.point === 'GLOBAL_PAUSE')?.status, 'CONFIGURED');
});

test('working hours is NOT_APPLICABLE with the exact documented reason code', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  const point = plan.find((p) => p.point === 'WORKING_HOURS');
  assert.equal(point?.status, 'NOT_APPLICABLE');
  assert.equal(point?.reasonCode, 'STAFF_MANUAL_ACTION_WORKING_HOURS_EXEMPT');
});

test('risk-policy authority is NOT_APPLICABLE with the exact documented reason code', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  const point = plan.find((p) => p.point === 'RISK_POLICY_AUTHORITY');
  assert.equal(point?.status, 'NOT_APPLICABLE');
  assert.equal(point?.reasonCode, 'LEVEL_2_HUMAN_AUTHORITY');
});

test('agent pause is NO_CONTEXT (not NOT_APPLICABLE) when no agent is associated', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  const point = plan.find((p) => p.point === 'AGENT_PAUSE');
  assert.equal(point?.status, 'NO_CONTEXT');
  assert.equal(point?.reasonCode, 'NO_ASSOCIATED_AGENT');
});

test('agent pause is CONFIGURED when a real agent code is present', () => {
  const plan = buildStaffActionGatePlan({ agentCode: 'crm-agent', channel: null, workflowCode: null });
  const point = plan.find((p) => p.point === 'AGENT_PAUSE');
  assert.equal(point?.status, 'CONFIGURED');
  assert.equal(point?.reasonCode, 'CONFIGURED');
});

test('channel pause is NO_CONTEXT with the exact documented reason code when no channel is associated', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  const point = plan.find((p) => p.point === 'CHANNEL_PAUSE');
  assert.equal(point?.status, 'NO_CONTEXT');
  assert.equal(point?.reasonCode, 'NO_ASSOCIATED_CHANNEL');
});

test('channel pause is CONFIGURED when a real channel is present', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: 'WHATSAPP', workflowCode: null });
  const point = plan.find((p) => p.point === 'CHANNEL_PAUSE');
  assert.equal(point?.status, 'CONFIGURED');
});

test('workflow pause is NO_CONTEXT when no workflow code is derivable, and CONFIGURED when one is', () => {
  const withoutCode = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  assert.equal(withoutCode.find((p) => p.point === 'WORKFLOW_PAUSE')?.status, 'NO_CONTEXT');
  assert.equal(withoutCode.find((p) => p.point === 'WORKFLOW_PAUSE')?.reasonCode, 'NO_ASSOCIATED_WORKFLOW');

  const withCode = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: 'customer.journey.v1' });
  assert.equal(withCode.find((p) => p.point === 'WORKFLOW_PAUSE')?.status, 'CONFIGURED');
});

test('feature flag is always CONFIGURED — the real staff-console flag is always checked, never skipped', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  assert.equal(plan.find((p) => p.point === 'FEATURE_FLAG')?.status, 'CONFIGURED');
});

test('gatePlanToExtendedGateInput passes null for workingHoursPolicyCode and level1PolicyCode only', () => {
  const context = { agentCode: 'crm-agent', channel: 'WHATSAPP', workflowCode: 'customer.journey.v1' };
  const plan = buildStaffActionGatePlan(context);
  const input = gatePlanToExtendedGateInput(plan, context);
  assert.equal(input.workingHoursPolicyCode, null);
  assert.equal(input.level1PolicyCode, null);
});

test('gatePlanToExtendedGateInput passes the real context through for CONFIGURED points', () => {
  const context = { agentCode: 'crm-agent', channel: 'WHATSAPP', workflowCode: 'customer.journey.v1' };
  const plan = buildStaffActionGatePlan(context);
  const input = gatePlanToExtendedGateInput(plan, context);
  assert.equal(input.agentCode, 'crm-agent');
  assert.equal(input.channel, 'WHATSAPP');
  assert.equal(input.workflowCode, 'customer.journey.v1');
  assert.equal(input.requiredFeatureFlag, 'staff_console_automation_actions');
});

test('gatePlanToExtendedGateInput correctly nulls out agent/channel/workflow only when the plan genuinely marks them NO_CONTEXT', () => {
  const context = { agentCode: null, channel: null, workflowCode: null };
  const plan = buildStaffActionGatePlan(context);
  const input = gatePlanToExtendedGateInput(plan, context);
  assert.equal(input.agentCode, null);
  assert.equal(input.channel, null);
  assert.equal(input.workflowCode, null);
  assert.equal(input.requiredFeatureFlag, 'staff_console_automation_actions');
});

test('the gate plan always states exactly the 8 named points, in the documented order', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  assert.deepEqual(
    plan.map((p) => p.point),
    ['EMERGENCY_STOP', 'GLOBAL_PAUSE', 'AGENT_PAUSE', 'CHANNEL_PAUSE', 'WORKFLOW_PAUSE', 'WORKING_HOURS', 'FEATURE_FLAG', 'RISK_POLICY_AUTHORITY']
  );
});

test('every gate point has a real, non-empty reasonCode', () => {
  const plan = buildStaffActionGatePlan({ agentCode: null, channel: null, workflowCode: null });
  for (const point of plan) {
    assert.ok(point.reasonCode.length > 0, `point ${point.point} has no reason code`);
  }
});
