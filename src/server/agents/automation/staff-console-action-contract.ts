export class StaffConsoleActionError extends Error {
  constructor(message: string, readonly code: 'NOT_IMPLEMENTED' | 'VALIDATION') {
    super(message);
    this.name = 'StaffConsoleActionError';
  }
}

import type { SupabaseAutomationStore } from './supabase-automation-store';
import type { SupabaseFounderControlStore } from './supabase-founder-control-store';

/** `Object.assign(automationStore, founderControlStore)` does NOT copy
 *  class methods defined on a prototype — only own enumerable properties.
 *  This was a genuine, previously-shipped defect: the combined "store"
 *  silently lost every `FounderControlStore` method (`loadFeatureFlag`,
 *  etc.), which `checkAutomationGateExtended` then failed to find at
 *  runtime — caught by actually running a real end-to-end test, not
 *  assumed correct from a clean typecheck. This class properly composes
 *  both real stores via explicit delegation instead. Lives in this plain
 *  module (not the 'use server' actions file) so tests can import it too. */
export class CombinedAutomationAndFounderControlStore {
  constructor(private readonly automation: SupabaseAutomationStore, private readonly founder: SupabaseFounderControlStore) {}
  saveWorkflowVersion(...args: Parameters<SupabaseAutomationStore['saveWorkflowVersion']>) { return this.automation.saveWorkflowVersion(...args); }
  loadWorkflowVersion(...args: Parameters<SupabaseAutomationStore['loadWorkflowVersion']>) { return this.automation.loadWorkflowVersion(...args); }
  saveWorkflowVersionHistory(...args: Parameters<SupabaseAutomationStore['saveWorkflowVersionHistory']>) { return this.automation.saveWorkflowVersionHistory(...args); }
  saveWorkflowRun(...args: Parameters<SupabaseAutomationStore['saveWorkflowRun']>) { return this.automation.saveWorkflowRun(...args); }
  loadWorkflowRun(...args: Parameters<SupabaseAutomationStore['loadWorkflowRun']>) { return this.automation.loadWorkflowRun(...args); }
  reserveWorkflowIdempotencyKey(...args: Parameters<SupabaseAutomationStore['reserveWorkflowIdempotencyKey']>) { return this.automation.reserveWorkflowIdempotencyKey(...args); }
  saveWorkflowStep(...args: Parameters<SupabaseAutomationStore['saveWorkflowStep']>) { return this.automation.saveWorkflowStep(...args); }
  loadWorkflowStep(...args: Parameters<SupabaseAutomationStore['loadWorkflowStep']>) { return this.automation.loadWorkflowStep(...args); }
  recordExecutionEvent(...args: Parameters<SupabaseAutomationStore['recordExecutionEvent']>) { return this.automation.recordExecutionEvent(...args); }
  loadPauseControl(...args: Parameters<SupabaseAutomationStore['loadPauseControl']>) { return this.automation.loadPauseControl(...args); }
  savePauseControl(...args: Parameters<SupabaseAutomationStore['savePauseControl']>) { return this.automation.savePauseControl(...args); }
  recordPauseEvent(...args: Parameters<SupabaseAutomationStore['recordPauseEvent']>) { return this.automation.recordPauseEvent(...args); }
  loadEmergencyStopState(...args: Parameters<SupabaseAutomationStore['loadEmergencyStopState']>) { return this.automation.loadEmergencyStopState(...args); }
  saveEmergencyStopState(...args: Parameters<SupabaseAutomationStore['saveEmergencyStopState']>) { return this.automation.saveEmergencyStopState(...args); }
  recordEmergencyStopEvent(...args: Parameters<SupabaseAutomationStore['recordEmergencyStopEvent']>) { return this.automation.recordEmergencyStopEvent(...args); }
  reserveWebhookOrDuplicateGuard(...args: Parameters<SupabaseAutomationStore['reserveWebhookOrDuplicateGuard']>) { return this.automation.reserveWebhookOrDuplicateGuard(...args); }
  saveAutomationPolicy(...args: Parameters<SupabaseAutomationStore['saveAutomationPolicy']>) { return this.automation.saveAutomationPolicy(...args); }
  loadAutomationPolicy(...args: Parameters<SupabaseAutomationStore['loadAutomationPolicy']>) { return this.automation.loadAutomationPolicy(...args); }
  findActiveAutomationPolicyByCode(...args: Parameters<SupabaseAutomationStore['findActiveAutomationPolicyByCode']>) { return this.automation.findActiveAutomationPolicyByCode(...args); }
  saveAutomationPolicyHistory(...args: Parameters<SupabaseAutomationStore['saveAutomationPolicyHistory']>) { return this.automation.saveAutomationPolicyHistory(...args); }
  loadWorkingHoursPolicy(...args: Parameters<SupabaseFounderControlStore['loadWorkingHoursPolicy']>) { return this.founder.loadWorkingHoursPolicy(...args); }
  saveWorkingHoursPolicy(...args: Parameters<SupabaseFounderControlStore['saveWorkingHoursPolicy']>) { return this.founder.saveWorkingHoursPolicy(...args); }
  findActiveWorkingHoursPolicyByCode(...args: Parameters<SupabaseFounderControlStore['findActiveWorkingHoursPolicyByCode']>) { return this.founder.findActiveWorkingHoursPolicyByCode(...args); }
  loadFeatureFlag(...args: Parameters<SupabaseFounderControlStore['loadFeatureFlag']>) { return this.founder.loadFeatureFlag(...args); }
  saveFeatureFlag(...args: Parameters<SupabaseFounderControlStore['saveFeatureFlag']>) { return this.founder.saveFeatureFlag(...args); }
  recordFounderControlEvent(...args: Parameters<SupabaseFounderControlStore['recordFounderControlEvent']>) { return this.founder.recordFounderControlEvent(...args); }
}
