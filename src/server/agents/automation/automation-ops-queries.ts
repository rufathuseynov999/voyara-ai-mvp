import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Phase 4G — read-only Founder/COO automation reporting. Every function
 * here is a plain SELECT against real Migration 21–25 tables — nothing in
 * this file writes anything, matching the exact same AAL2-staff-only
 * read-model pattern already proven for loadSupplierOpsSnapshot (Phase 4E)
 * and loadSubscriptionOpsSnapshot (Phase 4F): the caller (a staff page
 * already behind requireAssuranceLevel) is trusted to have enforced
 * authorization; this module only shapes the read.
 *
 * Nothing here estimates. Every count comes from a real row count against
 * a real table; a metric this module cannot compute from authoritative
 * data is `null` (unavailable) — never a guessed number, never zero
 * standing in for "unknown."
 */

export type AutomationOpsSnapshot = {
  workflowTotalsByStatus: Record<string, number> | null;
  completedWorkflows: number | null;
  failedWorkflows: number | null;
  pausedWorkflows: number | null;
  deadLetteredWorkflows: number | null;
  approvalBacklog: number | null;
  slaBreaches: number | null;
  leadsAwaitingResponse: number | null;
  proposalsAwaitingApproval: number | null;
  paymentLinkStatus: Record<string, number> | null;
  supplierTaskBacklog: number | null;
  bookingDeadlinesNext7Days: number | null;
  ticketingDeadlinesNext7Days: number | null;
  subscriptionRisks: { gracePeriod: number; paymentFailed: number } | null;
  corporateWorkload: number | null;
  channelVolumes: Record<string, number> | null;
  humanTakeoverRate: number | null;
  unresolvedOperationalRisks: number | null;
  dataAvailability: 'complete' | 'partial' | 'unavailable';
  unavailableReasons: string[];
};

const UNAVAILABLE_SNAPSHOT: AutomationOpsSnapshot = {
  workflowTotalsByStatus: null, completedWorkflows: null, failedWorkflows: null, pausedWorkflows: null,
  deadLetteredWorkflows: null, approvalBacklog: null, slaBreaches: null, leadsAwaitingResponse: null,
  proposalsAwaitingApproval: null, paymentLinkStatus: null, supplierTaskBacklog: null,
  bookingDeadlinesNext7Days: null, ticketingDeadlinesNext7Days: null, subscriptionRisks: null,
  corporateWorkload: null, channelVolumes: null, humanTakeoverRate: null, unresolvedOperationalRisks: null,
  dataAvailability: 'unavailable', unavailableReasons: ['No database connection is available.']
};

export async function loadAutomationOpsSnapshot(): Promise<AutomationOpsSnapshot> {
  const admin = createAdminSupabaseClient();
  if (!admin) return UNAVAILABLE_SNAPSHOT;

  const unavailableReasons: string[] = [];

  let workflowTotalsByStatus: Record<string, number> | null = null;
  let completedWorkflows: number | null = null;
  let failedWorkflows: number | null = null;
  let pausedWorkflows: number | null = null;
  {
    const { data, error } = await admin.from('workflow_runs').select('status');
    if (error || !data) {
      unavailableReasons.push('Workflow totals: could not read workflow_runs.');
    } else {
      const totals: Record<string, number> = {};
      for (const row of data) totals[row.status] = (totals[row.status] ?? 0) + 1;
      workflowTotalsByStatus = totals;
      completedWorkflows = totals.COMPLETED ?? 0;
      failedWorkflows = totals.FAILED ?? 0;
      pausedWorkflows = totals.PAUSED ?? 0;
    }
  }

  let deadLetteredWorkflows: number | null = null;
  {
    const { count, error } = await admin.from('dead_letter_records').select('id', { count: 'exact', head: true }).eq('resolved', false);
    if (error) unavailableReasons.push('Dead-lettered workflows: could not read dead_letter_records.');
    else deadLetteredWorkflows = count ?? 0;
  }

  let approvalBacklog: number | null = null;
  {
    const { count, error } = await admin.from('workflow_steps').select('id', { count: 'exact', head: true }).eq('action_level', 'LEVEL_2').eq('status', 'AWAITING_APPROVAL');
    if (error) unavailableReasons.push('Approval backlog: could not read workflow_steps.');
    else approvalBacklog = count ?? 0;
  }

  let proposalsAwaitingApproval: number | null = null;
  {
    const { count, error } = await admin.from('commercial_quotations').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL');
    if (error) unavailableReasons.push('Proposals awaiting approval: could not read commercial_quotations.');
    else proposalsAwaitingApproval = count ?? 0;
  }

  let paymentLinkStatus: Record<string, number> | null = null;
  {
    const { data, error } = await admin.from('payment_link_requests').select('status');
    if (error || !data) {
      unavailableReasons.push('Payment-link status: could not read payment_link_requests.');
    } else {
      const totals: Record<string, number> = {};
      for (const row of data) totals[row.status] = (totals[row.status] ?? 0) + 1;
      paymentLinkStatus = totals;
    }
  }

  let supplierTaskBacklog: number | null = null;
  {
    const { count, error } = await admin.from('portal_tasks').select('id', { count: 'exact', head: true }).not('status', 'in', '("CONFIRMED","CANCELLED")');
    if (error) unavailableReasons.push('Supplier-task backlog: could not read portal_tasks.');
    else supplierTaskBacklog = count ?? 0;
  }

  let subscriptionRisks: { gracePeriod: number; paymentFailed: number } | null = null;
  {
    const [gp, pf] = await Promise.all([
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'GRACE_PERIOD'),
      admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'PAYMENT_FAILED')
    ]);
    if (gp.error || pf.error) unavailableReasons.push('Subscription risks: could not read subscriptions.');
    else subscriptionRisks = { gracePeriod: gp.count ?? 0, paymentFailed: pf.count ?? 0 };
  }

  let corporateWorkload: number | null = null;
  {
    const { count, error } = await admin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').not('corporate_account_id', 'is', null);
    if (error) unavailableReasons.push('Corporate workload: could not read subscriptions.');
    else corporateWorkload = count ?? 0;
  }

  let channelVolumes: Record<string, number> | null = null;
  let humanTakeoverRate: number | null = null;
  {
    const { data, error } = await admin.from('conversations').select('channel, handover_status');
    if (error || !data) {
      unavailableReasons.push('Channel volumes / takeover rate: could not read conversations.');
    } else {
      const totals: Record<string, number> = {};
      let humanCount = 0;
      for (const row of data) {
        totals[row.channel] = (totals[row.channel] ?? 0) + 1;
        if (row.handover_status === 'HUMAN') humanCount++;
      }
      channelVolumes = totals;
      humanTakeoverRate = data.length > 0 ? Math.round((humanCount / data.length) * 10000) / 100 : null;
    }
  }

  let leadsAwaitingResponse: number | null = null;
  {
    const { data, error } = await admin.from('conversations').select('id, handover_status, last_inbound_at, last_message_at').eq('handover_status', 'HUMAN').not('last_inbound_at', 'is', null);
    if (error || !data) {
      unavailableReasons.push('Leads awaiting response: could not read conversations.');
    } else {
      leadsAwaitingResponse = data.filter((r) => !r.last_message_at || new Date(r.last_message_at) <= new Date(r.last_inbound_at)).length;
    }
  }

  unavailableReasons.push('SLA breaches: no dedicated SLA-deadline table exists in this schema yet.');
  unavailableReasons.push('Booking/ticketing deadlines: no dedicated deadline-tracking table exists in this schema yet.');
  unavailableReasons.push('Unresolved operational risks: no dedicated operational-risk table exists in this schema yet.');

  const dataAvailability: AutomationOpsSnapshot['dataAvailability'] = unavailableReasons.length === 0 ? 'complete' : (workflowTotalsByStatus !== null ? 'partial' : 'unavailable');

  return {
    workflowTotalsByStatus, completedWorkflows, failedWorkflows, pausedWorkflows, deadLetteredWorkflows,
    approvalBacklog, slaBreaches: null, leadsAwaitingResponse, proposalsAwaitingApproval, paymentLinkStatus,
    supplierTaskBacklog, bookingDeadlinesNext7Days: null, ticketingDeadlinesNext7Days: null, subscriptionRisks,
    corporateWorkload, channelVolumes, humanTakeoverRate, unresolvedOperationalRisks: null,
    dataAvailability, unavailableReasons
  };
}
