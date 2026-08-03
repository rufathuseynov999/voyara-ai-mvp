import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { corporateMemberships, personalMemberships } from '@/lib/memberships';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import {
  crmTaskEventTypes,
  crmTaskStatuses,
  crmTaskTypes,
  supplierConfigurationStatuses,
  supplierOperationalChannels,
  supplierServiceCategories,
  type AdministrationMembershipPlan,
  type AdministrationPipelineItem,
  type AdministrationSnapshot,
  type AdministrationSupplier,
  type AdministrationSupplierVersion,
  type AdministrationTask,
  type AdministrationTaskEvent,
  type AdministrationTeamMember,
  type CrmPipelineStage
} from './contract';

type Row = Record<string, unknown>;

const pipelineStages: readonly CrmPipelineStage[] = [
  'TRAVEL_REQUEST_INTAKE', 'COMMERCIAL_DRAFT', 'COMMERCIAL_APPROVAL',
  'PROPOSAL_PUBLISHED', 'CUSTOMER_ACCEPTED', 'PAYMENT_PENDING', 'PAYMENT_READY',
  'BOOKING_OPERATIONS', 'BOOKING_VERIFICATION', 'VOUCHER_ISSUED'
];

function membershipPayload(plan: Omit<AdministrationMembershipPlan, 'versionNumber' | 'payloadHash'>) {
  return {
    schemaVersion: 'membership-plan-v1',
    planCode: plan.planCode,
    audience: plan.audience,
    displayName: plan.displayName,
    currency: plan.currency,
    monthlyMinor: plan.monthlyMinor,
    annualMinor: plan.annualMinor,
    pricingModel: plan.pricingModel,
    ratificationSource: 'FOUNDER_BASELINE'
  };
}

export function approvedMembershipCatalogue(): AdministrationMembershipPlan[] {
  const plans: Omit<AdministrationMembershipPlan, 'versionNumber' | 'payloadHash'>[] = [
    ...personalMemberships.map((plan) => ({
      planCode: plan.code,
      audience: 'PERSONAL' as const,
      displayName: plan.name,
      currency: 'AZN' as const,
      monthlyMinor: plan.monthlyAzn * 100,
      annualMinor: plan.annualAzn * 100,
      pricingModel: 'FIXED' as const
    })),
    ...corporateMemberships.map((plan) => ({
      planCode: plan.code,
      audience: 'CORPORATE' as const,
      displayName: plan.name,
      currency: 'AZN' as const,
      monthlyMinor: plan.monthlyAzn === null ? null : plan.monthlyAzn * 100,
      annualMinor: null,
      pricingModel: plan.monthlyAzn === null ? 'CUSTOM' as const : 'FIXED' as const
    }))
  ];
  return plans.map((plan) => ({ ...plan, versionNumber: 1, payloadHash: sha256(membershipPayload(plan)) }));
}

function unavailableSnapshot(source: 'DEMO' | 'UNAVAILABLE'): AdministrationSnapshot {
  return {
    source,
    generatedAt: new Date().toISOString(),
    pipeline: [],
    tasks: [],
    suppliers: [],
    membershipPlans: approvedMembershipCatalogue(),
    team: [],
    controls: {
      roleAdministration: 'FOUNDER_ACCESS_CONSOLE',
      approvalLimits: 'NOT_CONFIGURED',
      refunds: 'BLOCKED_PENDING_FOUNDER_POLICY'
    }
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function oneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}

function mapPipeline(row: Row): AdministrationPipelineItem | null {
  const travelRequestId = text(row.travel_request_id);
  const customerId = text(row.customer_id);
  const requestVersion = integer(row.request_version);
  const requestHash = text(row.request_hash);
  const authorityStatus = text(row.authority_status);
  const authorityHash = text(row.authority_hash);
  const changedAt = text(row.changed_at);
  if (!travelRequestId || !customerId || requestVersion === null || !requestHash
    || !oneOf(pipelineStages, row.stage_code) || !authorityStatus || !authorityHash || !changedAt) return null;
  return {
    travelRequestId,
    customerId,
    requestVersion,
    requestHash,
    requestOwnerId: text(row.request_owner_id),
    stage: row.stage_code,
    authorityStatus,
    authorityHash,
    changedAt
  };
}

function mapTaskEvent(row: Row): (AdministrationTaskEvent & { taskId: string }) | null {
  const taskId = text(row.task_id);
  const version = integer(row.event_version);
  const note = text(row.note);
  const actorId = text(row.actor_id);
  const eventHash = text(row.event_hash);
  const occurredAt = text(row.occurred_at);
  if (!taskId || version === null || !oneOf(crmTaskEventTypes, row.event_type)
    || !note || !actorId || !eventHash || !occurredAt) return null;
  return { taskId, version, eventType: row.event_type, note, actorId, eventHash, occurredAt };
}

function mapTask(row: Row, events: AdministrationTaskEvent[]): AdministrationTask | null {
  const id = text(row.id);
  const travelRequestId = text(row.travel_request_id);
  const customerId = text(row.customer_id);
  const requestVersion = integer(row.request_version);
  const requestHash = text(row.request_hash);
  const title = text(row.title);
  const dueAt = text(row.due_at);
  const currentVersion = integer(row.current_version);
  const currentHash = text(row.current_hash);
  const updatedAt = text(row.updated_at);
  if (!id || !travelRequestId || !customerId || requestVersion === null || !requestHash
    || !oneOf(crmTaskTypes, row.task_type) || !title || !oneOf(crmTaskStatuses, row.status)
    || !dueAt || currentVersion === null || !currentHash || !updatedAt) return null;
  return {
    id, travelRequestId, customerId, requestVersion, requestHash,
    taskType: row.task_type, title, ownerId: text(row.owner_id), status: row.status,
    dueAt, currentVersion, currentHash, updatedAt, events
  };
}

function mapSupplierVersion(row: Row): (AdministrationSupplierVersion & { supplierId: string }) | null {
  const supplierId = text(row.supplier_id);
  const versionNumber = integer(row.version_number);
  const configurationHash = text(row.configuration_hash);
  const reason = text(row.reason);
  const createdBy = text(row.created_by);
  const createdAt = text(row.created_at);
  if (!supplierId || versionNumber === null || !configurationHash || !reason || !createdBy || !createdAt) return null;
  return {
    supplierId, versionNumber, configurationHash,
    previousVersionHash: text(row.previous_version_hash), reason, createdBy, createdAt
  };
}

function mapSupplier(row: Row, versions: AdministrationSupplierVersion[]): AdministrationSupplier | null {
  const id = text(row.id);
  const code = text(row.code);
  const displayName = text(row.display_name);
  const operationsNote = typeof row.operations_note === 'string' ? row.operations_note : null;
  const currentVersion = integer(row.current_version);
  const currentHash = text(row.current_hash);
  const updatedAt = text(row.updated_at);
  if (!id || !code || !displayName || operationsNote === null
    || !oneOf(supplierServiceCategories, row.service_category)
    || !oneOf(supplierOperationalChannels, row.operational_channel)
    || !oneOf(supplierConfigurationStatuses, row.status)
    || currentVersion === null || !currentHash || !updatedAt) return null;
  return {
    id, code, displayName, serviceCategory: row.service_category,
    operationalChannel: row.operational_channel, status: row.status, operationsNote,
    currentVersion, currentHash, updatedAt, versions
  };
}

function mapMembership(row: Row): AdministrationMembershipPlan | null {
  const planCode = text(row.plan_code);
  const displayName = text(row.display_name);
  const versionNumber = integer(row.version_number);
  const payloadHash = text(row.payload_hash);
  const monthlyMinor = row.monthly_minor === null ? null : integer(row.monthly_minor);
  const annualMinor = row.annual_minor === null ? null : integer(row.annual_minor);
  if (!planCode || !displayName || !oneOf(['PERSONAL', 'CORPORATE'] as const, row.audience)
    || row.currency !== 'AZN' || !oneOf(['FIXED', 'CUSTOM'] as const, row.pricing_model)
    || versionNumber === null || !payloadHash
    || (row.monthly_minor !== null && monthlyMinor === null)
    || (row.annual_minor !== null && annualMinor === null)) return null;
  return {
    planCode, audience: row.audience, displayName, currency: 'AZN', monthlyMinor, annualMinor,
    pricingModel: row.pricing_model, versionNumber, payloadHash
  };
}

export async function loadPublicMembershipCatalogue(): Promise<AdministrationMembershipPlan[]> {
  const fallback = approvedMembershipCatalogue();
  const supabase = await createServerSupabaseClient();
  if (!supabase) return fallback;
  const { data, error } = await supabase.from('membership_plan_catalogue')
    .select('*')
    .order('audience')
    .order('display_order');
  if (error) return fallback;
  const catalogue = ((data ?? []) as Row[]).map(mapMembership).filter((value) => value !== null);
  if (catalogue.length !== fallback.length) return fallback;
  const expectedHashes = new Map(fallback.map((plan) => [plan.planCode, plan.payloadHash]));
  return catalogue.every((plan) => expectedHashes.get(plan.planCode) === plan.payloadHash)
    ? catalogue
    : fallback;
}

function mapTeam(row: Row): AdministrationTeamMember | null {
  const id = text(row.user_id);
  const displayName = text(row.display_name);
  const roles = text(row.roles);
  return id && displayName && roles ? { id, displayName, roles } : null;
}

export async function loadAdministrationSnapshot(viewer: Viewer): Promise<AdministrationSnapshot> {
  if (viewer.source === 'demo') return unavailableSnapshot('DEMO');
  if (viewer.assuranceLevel !== 'aal2') return unavailableSnapshot('UNAVAILABLE');
  const admin = createAdminSupabaseClient();
  if (!admin) return unavailableSnapshot('UNAVAILABLE');

  const [pipelineResult, tasksResult, eventsResult, suppliersResult, versionsResult, membershipsResult, teamResult] = await Promise.all([
    admin.from('administration_crm_pipeline').select('*').order('changed_at', { ascending: false }).limit(100),
    admin.from('crm_tasks').select('*').order('due_at').limit(200),
    admin.from('crm_task_events').select('*').order('event_version').limit(1000),
    admin.from('supplier_configuration_catalogue').select('*').order('display_name').limit(200),
    admin.from('supplier_configuration_versions').select('*').order('version_number', { ascending: false }).limit(1000),
    admin.from('membership_plan_catalogue').select('*').order('audience').order('display_order').limit(20),
    admin.from('administration_team_directory').select('*').order('display_name').limit(100)
  ]);
  const results = [pipelineResult, tasksResult, eventsResult, suppliersResult, versionsResult, membershipsResult, teamResult];
  if (results.some(({ error }) => error)) return unavailableSnapshot('UNAVAILABLE');

  const taskEvents = ((eventsResult.data ?? []) as Row[]).map(mapTaskEvent).filter((value) => value !== null);
  const supplierVersions = ((versionsResult.data ?? []) as Row[]).map(mapSupplierVersion).filter((value) => value !== null);
  const tasks = ((tasksResult.data ?? []) as Row[]).flatMap((row) => {
    const id = text(row.id);
    const task = mapTask(row, taskEvents.filter((event) => event.taskId === id).map(({ taskId: _, ...event }) => event));
    return task ? [task] : [];
  });
  const suppliers = ((suppliersResult.data ?? []) as Row[]).flatMap((row) => {
    const id = text(row.id);
    const supplier = mapSupplier(row, supplierVersions.filter((version) => version.supplierId === id)
      .map(({ supplierId: _, ...version }) => version));
    return supplier ? [supplier] : [];
  });

  const membershipPlans = ((membershipsResult.data ?? []) as Row[]).map(mapMembership).filter((value) => value !== null);
  if (membershipPlans.length !== 8) return unavailableSnapshot('UNAVAILABLE');

  return {
    source: 'POSTGRESQL',
    generatedAt: new Date().toISOString(),
    pipeline: ((pipelineResult.data ?? []) as Row[]).map(mapPipeline).filter((value) => value !== null),
    tasks,
    suppliers,
    membershipPlans,
    team: ((teamResult.data ?? []) as Row[]).map(mapTeam).filter((value) => value !== null),
    controls: {
      roleAdministration: 'FOUNDER_ACCESS_CONSOLE',
      approvalLimits: 'NOT_CONFIGURED',
      refunds: 'BLOCKED_PENDING_FOUNDER_POLICY'
    }
  };
}
