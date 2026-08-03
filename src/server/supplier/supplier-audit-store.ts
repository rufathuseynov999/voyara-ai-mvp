import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { CommercialSource, IntegrationMode, SupplierErrorKind, SupplierOperation } from './contract';

/**
 * Phase 3C Part 2 — sanitized supplier request/response audit persistence.
 *
 * Writes to `supplier_requests` / `supplier_responses` (schema already
 * defined in Phase 3A's foundation migration, unused until now). The schema
 * itself has no column for a raw body, header, URL, or credential — there is
 * no way to accidentally persist one through this path; only the metadata
 * shape below can ever be written.
 *
 * Deliberately NOT marked 'server-only': like orchestration-service.ts, this
 * stays importable by the hermetic test suite. It touches Supabase only
 * inside its functions, never at module load, so importing it is always safe.
 */

export type SupplierRequestRecord = {
  requestId: string;
  operation: SupplierOperation;
  mode: IntegrationMode;
  supplierId: string;
  correlationId: string;
  actorId: string;
};

export type SupplierResponseRecord = {
  requestId: string;
  ok: boolean;
  errorKind: SupplierErrorKind | null;
  supplierTraceId: string | null;
  source: CommercialSource;
  simulated: boolean;
};

export async function recordSupplierRequest(record: SupplierRequestRecord): Promise<void> {
  const admin = createAdminSupabaseClient();
  if (!admin) return; // No Supabase configured (e.g. hermetic unit tests) — audit is best-effort, never blocking.
  const { error } = await admin.from('supplier_requests').insert({
    id: record.requestId,
    operation: record.operation,
    mode: record.mode,
    supplier_id: record.supplierId,
    correlation_id: record.correlationId,
    actor_id: record.actorId
  });
  if (error) throw new Error(`SUPPLIER_REQUEST_AUDIT_FAILED:${error.code}`);
}

export async function recordSupplierResponse(record: SupplierResponseRecord): Promise<void> {
  const admin = createAdminSupabaseClient();
  if (!admin) return;
  const { error } = await admin.from('supplier_responses').insert({
    supplier_request_id: record.requestId,
    ok: record.ok,
    error_kind: record.errorKind,
    supplier_trace_id: record.supplierTraceId,
    source: record.source,
    simulated: record.simulated
  });
  if (error) throw new Error(`SUPPLIER_RESPONSE_AUDIT_FAILED:${error.code}`);
}
