import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { portalTaskSchema, type PortalTask } from './portal-task-contract';
import type { PortalTaskStore, PortalTaskEventRecord } from './portal-task-store';

/**
 * Phase 4G — Supabase/PostgreSQL implementation of the PortalTaskStore
 * port, persisting into the real Phase 4E tables (`portal_tasks`,
 * `portal_task_events`, `portal_task_idempotency_keys`) inspected directly
 * from `20260730090000_task021_phase4e_rtravel_supplier_operations.sql`
 * before writing this file. Mirrors SupabaseQuoteStore's own conventions
 * (fail-closed `admin()` helper, service-role write path, reserve-first
 * idempotency via the real PRIMARY KEY) rather than inventing a new
 * pattern.
 *
 * This class changes nothing about the PortalTaskStore interface itself —
 * every method signature is identical to InMemoryPortalTaskStore's. Only
 * the persistence target changes.
 */

class PortalTaskStoreUnavailableError extends Error {
  constructor() {
    super('PORTAL_TASK_STORE_UNAVAILABLE');
    this.name = 'PortalTaskStoreUnavailableError';
  }
}

function admin() {
  const client = createAdminSupabaseClient();
  if (!client) throw new PortalTaskStoreUnavailableError();
  return client;
}

type PortalTaskRow = {
  id: string; supplier_id: string; contract_id: string | null; conversation_id: string | null; contact_id: string;
  status: string; booking_data: Record<string, unknown>; proposed_markup: number | null;
  checklist: Array<{ step: string; completed: boolean }>; assigned_owner_id: string | null;
  supplier_confirmation_reference: string | null; voucher_metadata: Record<string, unknown> | null;
  correlation_id: string; created_at: string; updated_at: string;
};

function rowToTask(row: PortalTaskRow): PortalTask {
  return portalTaskSchema.parse({
    portalTaskId: row.id, supplierId: row.supplier_id, contractId: row.contract_id, conversationId: row.conversation_id,
    contactId: row.contact_id, status: row.status, bookingData: row.booking_data, proposedMarkup: row.proposed_markup,
    checklist: row.checklist, assignedOwnerId: row.assigned_owner_id, supplierConfirmationReference: row.supplier_confirmation_reference,
    voucherMetadata: row.voucher_metadata, correlationId: row.correlation_id,
    // Postgres returns timestamptz values with an offset (e.g. +00:00) or
    // microsecond precision, not the exact `...Z` millisecond ISO format
    // the schema's z.iso.datetime() enforces — normalize via a real Date
    // round-trip rather than passing the raw driver string through.
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
  });
}

export class SupabasePortalTaskStore implements PortalTaskStore {
  async saveTask(task: PortalTask): Promise<void> {
    const { error } = await admin().from('portal_tasks').upsert({
      id: task.portalTaskId, supplier_id: task.supplierId, contract_id: task.contractId, conversation_id: task.conversationId,
      contact_id: task.contactId, status: task.status, booking_data: task.bookingData, proposed_markup: task.proposedMarkup,
      checklist: task.checklist, assigned_owner_id: task.assignedOwnerId, supplier_confirmation_reference: task.supplierConfirmationReference,
      voucher_metadata: task.voucherMetadata, correlation_id: task.correlationId, created_at: task.createdAt, updated_at: task.updatedAt
    });
    if (error) throw new Error(`PORTAL_TASK_SAVE_FAILED: ${error.message}`);
  }

  async loadTask(portalTaskId: string): Promise<PortalTask | null> {
    const { data, error } = await admin().from('portal_tasks').select('*').eq('id', portalTaskId).maybeSingle();
    if (error) throw new Error(`PORTAL_TASK_LOAD_FAILED: ${error.message}`);
    if (!data) return null;
    return rowToTask(data as PortalTaskRow);
  }

  async recordTaskEvent(event: PortalTaskEventRecord): Promise<void> {
    const { error } = await admin().from('portal_task_events').insert({
      id: event.eventId, portal_task_id: event.portalTaskId, kind: event.kind, actor_id: event.actorId,
      actor_kind: event.actorKind, correlation_id: event.correlationId, reason_code: event.reasonCode ?? null
    });
    if (error) throw new Error(`PORTAL_TASK_EVENT_RECORD_FAILED: ${error.message}`);
  }

  async reserveIdempotencyKey(key: string, portalTaskId: string, correlationId: string): Promise<{ winner: boolean; portalTaskId: string }> {
    const { error } = await admin().from('portal_task_idempotency_keys').insert({ idempotency_key: key, portal_task_id: portalTaskId, correlation_id: correlationId });
    if (!error) return { winner: true, portalTaskId };

    const isDuplicateKey = (error as { code?: string }).code === '23505';
    if (!isDuplicateKey) throw new Error(`PORTAL_TASK_IDEMPOTENCY_RESERVE_FAILED: ${error.message}`);

    const { data, error: readError } = await admin().from('portal_task_idempotency_keys').select('portal_task_id').eq('idempotency_key', key).maybeSingle();
    if (readError || !data) throw new Error(`PORTAL_TASK_IDEMPOTENCY_READBACK_FAILED: ${readError?.message ?? 'no row found'}`);
    return { winner: false, portalTaskId: (data as { portal_task_id: string }).portal_task_id };
  }
}
