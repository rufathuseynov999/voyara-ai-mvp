import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { planVersionSchema, type PlanVersion } from './plan-authority';
import type { PlanStore } from './plan-store';

/**
 * Phase 4G — Supabase/PostgreSQL implementation of the PlanStore port,
 * persisting into the real Phase 4F `plan_versions` / `plan_version_history`
 * tables (Migration 22), inspected directly before writing this file.
 * Mirrors the same fail-closed `admin()` convention as every other
 * Supabase-backed store in this project — no silent in-memory fallback.
 */

class PlanStoreUnavailableError extends Error {
  constructor() {
    super('PLAN_STORE_UNAVAILABLE');
    this.name = 'PlanStoreUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new PlanStoreUnavailableError();
  return client;
}

type PlanVersionRow = {
  id: string; plan_code: string; plan_type: string; billing_cycle: string; price_minor_units: string | number;
  currency: string; benefits: string[]; usage_limits: Record<string, unknown>; service_privileges: string[];
  seat_or_traveller_limit: number | null; activation_date: string | null; retirement_date: string | null;
  status: string; approved_by: string | null; approved_at: string | null; content_hash: string | null;
  version: number; correlation_id: string; created_at: string; updated_at: string;
};

function rowToPlanVersion(row: PlanVersionRow): PlanVersion {
  return planVersionSchema.parse({
    planVersionId: row.id, planCode: row.plan_code, planType: row.plan_type, billingCycle: row.billing_cycle,
    priceMinorUnits: Number(row.price_minor_units), currency: row.currency, benefits: row.benefits,
    usageLimits: row.usage_limits, servicePrivileges: row.service_privileges, seatOrTravellerLimit: row.seat_or_traveller_limit,
    activationDate: row.activation_date, retirementDate: row.retirement_date, status: row.status,
    approvedBy: row.approved_by, approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    contentHash: row.content_hash, version: row.version, correlationId: row.correlation_id,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
  });
}

export class SupabasePlanStore implements PlanStore {
  async savePlanVersion(plan: PlanVersion): Promise<void> {
    const { error } = await admin().from('plan_versions').upsert({
      id: plan.planVersionId, plan_code: plan.planCode, plan_type: plan.planType, billing_cycle: plan.billingCycle,
      price_minor_units: plan.priceMinorUnits, currency: plan.currency, benefits: plan.benefits, usage_limits: plan.usageLimits,
      service_privileges: plan.servicePrivileges, seat_or_traveller_limit: plan.seatOrTravellerLimit,
      activation_date: plan.activationDate, retirement_date: plan.retirementDate, status: plan.status,
      approved_by: plan.approvedBy, approved_at: plan.approvedAt, content_hash: plan.contentHash, version: plan.version,
      correlation_id: plan.correlationId, created_at: plan.createdAt, updated_at: plan.updatedAt
    });
    if (error) throw new Error(`PLAN_VERSION_SAVE_FAILED: ${error.message}`);
  }

  async loadPlanVersion(planVersionId: string): Promise<PlanVersion | null> {
    const { data, error } = await admin().from('plan_versions').select('*').eq('id', planVersionId).maybeSingle();
    if (error) throw new Error(`PLAN_VERSION_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return rowToPlanVersion(data as PlanVersionRow);
  }

  async findActivePlan(planCode: PlanVersion['planCode'], billingCycle: PlanVersion['billingCycle']): Promise<PlanVersion | null> {
    const { data, error } = await admin().from('plan_versions').select('*')
      .eq('plan_code', planCode).eq('billing_cycle', billingCycle).eq('status', 'ACTIVE').maybeSingle();
    if (error) throw new Error(`PLAN_VERSION_ACTIVE_LOOKUP_FAILED: ${error.message}`);
    if (!data) return null;
    return rowToPlanVersion(data as PlanVersionRow);
  }

  async savePlanVersionHistory(entry: { historyId: string; planVersionId: string; version: number; contentHash: string; snapshot: Record<string, unknown>; createdBy: string; correlationId: string }): Promise<void> {
    const { error } = await admin().from('plan_version_history').insert({
      id: entry.historyId, plan_version_id: entry.planVersionId, version: entry.version, content_hash: entry.contentHash,
      snapshot: entry.snapshot, created_by: entry.createdBy, correlation_id: entry.correlationId
    });
    if (error) throw new Error(`PLAN_VERSION_HISTORY_SAVE_FAILED: ${error.message}`);
  }
}
