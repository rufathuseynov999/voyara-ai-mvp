import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import {
  crmTaskEventCanonicalPayloadSchema,
  supplierConfigurationCanonicalPayloadSchema,
  type AdministrationCommand,
  type AdministrationCommandResult,
  type CrmTaskEventType,
  type CrmTaskStatus,
  type CrmTaskType
} from './contract';

type TravelRequestRow = {
  id: string;
  customer_id: string;
  status: string;
  current_version: number;
};

type RequestVersionRow = {
  travel_request_id: string;
  version_number: number;
  payload_hash: string;
};

type TaskRow = {
  id: string;
  travel_request_id: string;
  customer_id: string;
  request_version: number;
  request_hash: string;
  task_type: CrmTaskType;
  title: string;
  owner_id: string | null;
  status: CrmTaskStatus;
  due_at: string;
};

type SupplierRow = {
  id: string;
  code: string;
};

async function loadTravelRequest(travelRequestId: string): Promise<{
  request: TravelRequestRow;
  version: RequestVersionRow;
}> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('ADMINISTRATION_CONFIGURATION_UNAVAILABLE');
  const requestResult = await admin.from('travel_requests')
    .select('id, customer_id, status, current_version')
    .eq('id', travelRequestId)
    .maybeSingle();
  if (requestResult.error || !requestResult.data) throw new Error('TRAVEL_REQUEST_NOT_FOUND');
  const request = requestResult.data as unknown as TravelRequestRow;
  const versionResult = await admin.from('travel_request_versions')
    .select('travel_request_id, version_number, payload_hash')
    .eq('travel_request_id', request.id)
    .eq('version_number', request.current_version)
    .maybeSingle();
  if (versionResult.error || !versionResult.data) throw new Error('TRAVEL_REQUEST_VERSION_NOT_FOUND');
  return { request, version: versionResult.data as unknown as RequestVersionRow };
}

async function loadTask(taskId: string): Promise<TaskRow> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('ADMINISTRATION_CONFIGURATION_UNAVAILABLE');
  const { data, error } = await admin.from('crm_tasks')
    .select([
      'id', 'travel_request_id', 'customer_id', 'request_version', 'request_hash',
      'task_type', 'title', 'owner_id', 'status', 'due_at'
    ].join(', '))
    .eq('id', taskId)
    .maybeSingle();
  if (error || !data) throw new Error('CRM_TASK_NOT_FOUND');
  return data as unknown as TaskRow;
}

async function loadSupplier(supplierId: string): Promise<SupplierRow> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('ADMINISTRATION_CONFIGURATION_UNAVAILABLE');
  const { data, error } = await admin.from('supplier_registry')
    .select('id, code')
    .eq('id', supplierId)
    .maybeSingle();
  if (error || !data) throw new Error('SUPPLIER_CONFIGURATION_NOT_FOUND');
  return data as unknown as SupplierRow;
}

type CrmTaskMutationCommand = Extract<AdministrationCommand, {
  action: 'crm.task.claim' | 'crm.task.status.set' | 'crm.task.reassign' | 'crm.task.cancel'
}>;

function taskMutation(input: CrmTaskMutationCommand, task: TaskRow, viewer: Viewer) {
  let eventType: CrmTaskEventType;
  let ownerId = task.owner_id;
  let status = task.status;
  let note: string;

  switch (input.action) {
    case 'crm.task.claim':
      eventType = 'TASK_CLAIMED';
      ownerId = viewer.id;
      note = 'Task claimed by an accountable human operator.';
      break;
    case 'crm.task.status.set':
      eventType = 'TASK_STATUS_CHANGED';
      status = input.nextStatus;
      note = input.note;
      break;
    case 'crm.task.reassign':
      eventType = 'TASK_REASSIGNED';
      ownerId = input.ownerId;
      note = input.reason;
      break;
    case 'crm.task.cancel':
      eventType = 'TASK_CANCELLED';
      status = 'CANCELLED';
      note = input.reason;
      break;
  }

  return crmTaskEventCanonicalPayloadSchema.parse({
    schemaVersion: 'crm-task-event-v1',
    taskId: task.id,
    travelRequestId: task.travel_request_id,
    travelRequestVersion: task.request_version,
    travelRequestHash: task.request_hash,
    customerId: task.customer_id,
    eventVersion: input.expectedVersion + 1,
    previousEventHash: input.expectedHash,
    eventType,
    taskType: task.task_type,
    title: task.title,
    ownerId,
    status,
    dueAt: new Date(task.due_at).toISOString(),
    note,
    authorityDomainsUnaffected: true
  });
}

export async function executeAdministrationCommand(
  viewer: Viewer,
  input: AdministrationCommand,
  idempotencyKey: string
): Promise<AdministrationCommandResult> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('ADMINISTRATION_CONFIGURATION_UNAVAILABLE');
  const commandId = randomUUID();
  let payload: Record<string, unknown>;

  if (input.action === 'crm.task.create') {
    const { request, version } = await loadTravelRequest(input.travelRequestId);
    const taskId = randomUUID();
    const eventPayload = crmTaskEventCanonicalPayloadSchema.parse({
      schemaVersion: 'crm-task-event-v1',
      taskId,
      travelRequestId: request.id,
      travelRequestVersion: request.current_version,
      travelRequestHash: version.payload_hash,
      customerId: request.customer_id,
      eventVersion: 1,
      previousEventHash: '',
      eventType: 'TASK_CREATED',
      taskType: input.taskType,
      title: input.title,
      ownerId: input.ownerId,
      status: 'OPEN',
      dueAt: new Date(input.dueAt).toISOString(),
      note: input.note,
      authorityDomainsUnaffected: true
    });
    payload = { taskId, taskEventPayload: eventPayload, taskEventHash: sha256(eventPayload) };
  } else if (
    input.action === 'crm.task.claim'
    || input.action === 'crm.task.status.set'
    || input.action === 'crm.task.reassign'
    || input.action === 'crm.task.cancel'
  ) {
    const task = await loadTask(input.taskId);
    const eventPayload = taskMutation(input, task, viewer);
    payload = {
      taskId: task.id,
      expectedVersion: input.expectedVersion,
      expectedHash: input.expectedHash,
      taskEventPayload: eventPayload,
      taskEventHash: sha256(eventPayload)
    };
  } else if (input.action === 'supplier.configuration.create') {
    const supplierId = randomUUID();
    const configurationPayload = supplierConfigurationCanonicalPayloadSchema.parse({
      schemaVersion: 'supplier-configuration-v1',
      supplierId,
      versionNumber: 1,
      previousVersionHash: '',
      code: input.code,
      displayName: input.displayName,
      serviceCategory: input.serviceCategory,
      operationalChannel: input.operationalChannel,
      status: input.status,
      operationsNote: input.operationsNote,
      reason: 'Initial accountable manual Supplier configuration.',
      containsCredentials: false
    });
    payload = {
      supplierId,
      configurationPayload,
      configurationHash: sha256(configurationPayload)
    };
  } else {
    const supplier = await loadSupplier(input.supplierId);
    const configurationPayload = supplierConfigurationCanonicalPayloadSchema.parse({
      schemaVersion: 'supplier-configuration-v1',
      supplierId: supplier.id,
      versionNumber: input.expectedVersion + 1,
      previousVersionHash: input.expectedHash,
      code: supplier.code,
      displayName: input.displayName,
      serviceCategory: input.serviceCategory,
      operationalChannel: input.operationalChannel,
      status: input.status,
      operationsNote: input.operationsNote,
      reason: input.reason,
      containsCredentials: false
    });
    payload = {
      supplierId: supplier.id,
      expectedVersion: input.expectedVersion,
      expectedHash: input.expectedHash,
      configurationPayload,
      configurationHash: sha256(configurationPayload)
    };
  }

  const { data, error } = await admin.rpc('execute_administration_command', {
    p_command_id: commandId,
    p_idempotency_key: idempotencyKey,
    p_command_name: input.action,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1_000).toISOString(),
    p_payload: payload,
    p_payload_hash: sha256(input)
  });
  if (error) throw new Error(`ADMINISTRATION_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);
  return data as AdministrationCommandResult;
}
