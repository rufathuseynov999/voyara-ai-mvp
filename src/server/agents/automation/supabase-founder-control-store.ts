import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { FounderControlStore, WorkingHoursPolicy, FeatureFlag } from './founder-controls';

/**
 * Phase 4G — the complete production Supabase-backed FounderControlStore,
 * replacing the earlier throwing-stub version. Every method is now a
 * genuine implementation against the real Migration 25 tables
 * (`working_hours_policies`, `automation_feature_flags`,
 * `founder_control_events`), inspected directly before writing this file.
 */

class FounderControlStoreUnavailableError extends Error {
  constructor() {
    super('FOUNDER_CONTROL_STORE_UNAVAILABLE');
    this.name = 'FounderControlStoreUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new FounderControlStoreUnavailableError();
  return client;
}

function iso(value: string | null): string | null { return value ? new Date(value).toISOString() : null; }

export class SupabaseFounderControlStore implements FounderControlStore {
  async loadWorkingHoursPolicy(policyId: string): Promise<WorkingHoursPolicy | null> {
    const { data, error } = await admin().from('working_hours_policies').select('*').eq('id', policyId).maybeSingle();
    if (error) throw new Error(`WORKING_HOURS_POLICY_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return {
      policyId: data.id, policyCode: data.policy_code, timezone: data.timezone, schedule: data.schedule, status: data.status,
      approvedBy: data.approved_by, approvedAt: iso(data.approved_at), contentHash: data.content_hash, version: data.version,
      correlationId: data.correlation_id
    };
  }

  async saveWorkingHoursPolicy(policy: WorkingHoursPolicy): Promise<void> {
    const { error } = await admin().from('working_hours_policies').upsert({
      id: policy.policyId, policy_code: policy.policyCode, timezone: policy.timezone, schedule: policy.schedule,
      status: policy.status, approved_by: policy.approvedBy, approved_at: policy.approvedAt, content_hash: policy.contentHash,
      version: policy.version, correlation_id: policy.correlationId
    });
    if (error) throw new Error(`WORKING_HOURS_POLICY_SAVE_FAILED: ${error.message}`);
  }

  async findActiveWorkingHoursPolicyByCode(policyCode: string): Promise<WorkingHoursPolicy | null> {
    const { data, error } = await admin().from('working_hours_policies').select('*').eq('policy_code', policyCode).eq('status', 'ACTIVE').maybeSingle();
    if (error) throw new Error(`WORKING_HOURS_POLICY_ACTIVE_LOOKUP_FAILED: ${error.message}`);
    if (!data) return null;
    return {
      policyId: data.id, policyCode: data.policy_code, timezone: data.timezone, schedule: data.schedule, status: data.status,
      approvedBy: data.approved_by, approvedAt: iso(data.approved_at), contentHash: data.content_hash, version: data.version,
      correlationId: data.correlation_id
    };
  }

  async loadFeatureFlag(flagCode: string): Promise<FeatureFlag | null> {
    const { data, error } = await admin().from('automation_feature_flags').select('flag_code, enabled').eq('flag_code', flagCode).maybeSingle();
    if (error) throw new Error(`FEATURE_FLAG_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return { flagCode: data.flag_code, enabled: data.enabled };
  }

  async saveFeatureFlag(flag: FeatureFlag, changedBy: string): Promise<void> {
    if (!changedBy) throw new Error('A real human actor is required to change a feature flag.');
    const { randomUUID } = await import('node:crypto');
    const { error } = await admin().from('automation_feature_flags').upsert(
      { id: randomUUID(), flag_code: flag.flagCode, enabled: flag.enabled, updated_by: changedBy, correlation_id: `flag-change-${flag.flagCode}` },
      { onConflict: 'flag_code' }
    );
    if (error) throw new Error(`FEATURE_FLAG_SAVE_FAILED: ${error.message}`);
  }

  async recordFounderControlEvent(event: { eventId: string; controlKind: string; controlKey: string | null; action: string; actorId: string; reasonCode?: string | null; correlationId: string }): Promise<void> {
    const { error } = await admin().from('founder_control_events').insert({
      id: event.eventId, control_kind: event.controlKind, control_key: event.controlKey, action: event.action,
      actor_id: event.actorId, reason_code: event.reasonCode ?? null, correlation_id: event.correlationId
    });
    if (error) throw new Error(`FOUNDER_CONTROL_EVENT_RECORD_FAILED: ${error.message}`);
  }
}
