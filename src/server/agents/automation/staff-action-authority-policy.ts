/**
 * Phase 4G — the explicit staff-action authority policy.
 *
 * Every gate point applied by the staff console's approval/retry actions
 * is stated HERE, by name, with a reason — never represented as an
 * unexplained `null` argument at the call site. Four distinct states are
 * tracked and never conflated:
 *
 * - `NOT_APPLICABLE`      — this control genuinely does not apply to this
 *                           kind of action, by policy (e.g. working hours
 *                           for incident response, Level-1 risk-policy
 *                           authority for a Level-2 human-approved step).
 * - `NO_CONTEXT`          — the control would apply if the relevant
 *                           context existed, but this specific step/run
 *                           carries none (e.g. no channel is associated).
 * - `MISSING_CONFIGURATION` — the control applies and context exists, but
 *                           no approved configuration exists to check
 *                           against (fails closed at the real control
 *                           layer, not here).
 * - `CONFIGURED`          — the control applies, context exists, and a
 *                           real configuration will be checked.
 */

export type StaffActionGatePointStatus = 'NOT_APPLICABLE' | 'NO_CONTEXT' | 'MISSING_CONFIGURATION' | 'CONFIGURED';

export type StaffActionGatePoint = {
  point: 'EMERGENCY_STOP' | 'GLOBAL_PAUSE' | 'AGENT_PAUSE' | 'CHANNEL_PAUSE' | 'WORKFLOW_PAUSE' | 'WORKING_HOURS' | 'FEATURE_FLAG' | 'RISK_POLICY_AUTHORITY';
  status: StaffActionGatePointStatus;
  reasonCode: string;
};

export type StaffActionAuthorityContext = {
  agentCode: string | null;
  channel: string | null;
  workflowCode: string | null;
};

export const STAFF_CONSOLE_AUTOMATION_FLAG_CODE = 'staff_console_automation_actions';

export function buildStaffActionGatePlan(context: StaffActionAuthorityContext): StaffActionGatePoint[] {
  return [
    { point: 'EMERGENCY_STOP', status: 'CONFIGURED', reasonCode: 'ALWAYS_APPLICABLE' },
    { point: 'GLOBAL_PAUSE', status: 'CONFIGURED', reasonCode: 'ALWAYS_APPLICABLE' },
    {
      point: 'AGENT_PAUSE',
      status: context.agentCode ? 'CONFIGURED' : 'NO_CONTEXT',
      reasonCode: context.agentCode ? 'CONFIGURED' : 'NO_ASSOCIATED_AGENT'
    },
    {
      point: 'CHANNEL_PAUSE',
      status: context.channel ? 'CONFIGURED' : 'NO_CONTEXT',
      reasonCode: context.channel ? 'CONFIGURED' : 'NO_ASSOCIATED_CHANNEL'
    },
    {
      point: 'WORKFLOW_PAUSE',
      status: context.workflowCode ? 'CONFIGURED' : 'NO_CONTEXT',
      reasonCode: context.workflowCode ? 'CONFIGURED' : 'NO_ASSOCIATED_WORKFLOW'
    },
    { point: 'WORKING_HOURS', status: 'NOT_APPLICABLE', reasonCode: 'STAFF_MANUAL_ACTION_WORKING_HOURS_EXEMPT' },
    { point: 'FEATURE_FLAG', status: 'CONFIGURED', reasonCode: 'CONFIGURED' },
    { point: 'RISK_POLICY_AUTHORITY', status: 'NOT_APPLICABLE', reasonCode: 'LEVEL_2_HUMAN_AUTHORITY' }
  ];
}

export function gatePlanToExtendedGateInput(plan: StaffActionGatePoint[], context: StaffActionAuthorityContext) {
  const agentPoint = plan.find((p) => p.point === 'AGENT_PAUSE')!;
  const channelPoint = plan.find((p) => p.point === 'CHANNEL_PAUSE')!;
  const workflowPoint = plan.find((p) => p.point === 'WORKFLOW_PAUSE')!;
  const featureFlagPoint = plan.find((p) => p.point === 'FEATURE_FLAG')!;

  return {
    agentCode: agentPoint.status === 'CONFIGURED' ? context.agentCode : null,
    channel: channelPoint.status === 'CONFIGURED' ? context.channel : null,
    workflowCode: workflowPoint.status === 'CONFIGURED' ? context.workflowCode : null,
    workingHoursPolicyCode: null,
    requiredFeatureFlag: featureFlagPoint.status === 'CONFIGURED' ? STAFF_CONSOLE_AUTOMATION_FLAG_CODE : null,
    level1PolicyCode: null
  };
}
