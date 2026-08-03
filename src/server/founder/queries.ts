import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import {
  founderDecisionCodes,
  founderExceptionCodes,
  founderMetricCodes,
  founderPipelineCodes,
  founderSourceCodes,
  type FounderCommandCenterSnapshot,
  type FounderDecisionItem,
  type FounderExceptionItem,
  type FounderFinancialMetric,
  type FounderPipelineStage,
  type FounderSourceFreshness,
  type FounderWorkload
} from './contract';

type UnknownRow = Record<string, unknown>;

function safeInteger(value: unknown, allowNegative = false): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || (!allowNegative && parsed < 0)) return null;
  return parsed;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}

function unavailableSnapshot(
  reasonCode: Exclude<FounderCommandCenterSnapshot['reasonCode'], 'AUTHORITATIVE_POSTGRES_READ_MODEL'>
): FounderCommandCenterSnapshot {
  return {
    dataState: 'UNAVAILABLE',
    reasonCode,
    generatedAt: new Date().toISOString(),
    metrics: founderMetricCodes.map((metricCode, displayOrder) => ({
      displayOrder: displayOrder + 1,
      metricCode,
      availability: 'UNAVAILABLE',
      amountMinor: null,
      currency: 'AZN',
      basisCode: reasonCode,
      sourceRecordCount: 0,
      sourceUpdatedAt: null
    })),
    decisions: [],
    exceptions: [],
    pipeline: [],
    workloads: [],
    sourceFreshness: []
  };
}

function mapMetric(row: UnknownRow): FounderFinancialMetric | null {
  const displayOrder = safeInteger(row.display_order);
  const amountMinor = row.amount_minor === null ? null : safeInteger(row.amount_minor, true);
  const sourceRecordCount = safeInteger(row.source_record_count);
  if (
    displayOrder === null
    || !isOneOf(founderMetricCodes, row.metric_code)
    || !isOneOf(['AVAILABLE', 'UNAVAILABLE'] as const, row.availability)
    || row.currency !== 'AZN'
    || !nonEmptyString(row.basis_code)
    || sourceRecordCount === null
    || (row.amount_minor !== null && amountMinor === null)
  ) return null;
  return {
    displayOrder,
    metricCode: row.metric_code,
    availability: row.availability,
    amountMinor,
    currency: 'AZN',
    basisCode: row.basis_code as string,
    sourceRecordCount,
    sourceUpdatedAt: nonEmptyString(row.source_updated_at)
  };
}

function mapDecision(row: UnknownRow): FounderDecisionItem | null {
  const priorityOrder = safeInteger(row.priority_order);
  const entityId = nonEmptyString(row.entity_id);
  const statusCode = nonEmptyString(row.status_code);
  const waitingSince = nonEmptyString(row.waiting_since);
  const targetPath = nonEmptyString(row.target_path);
  const amountMinor = row.amount_minor === null ? null : safeInteger(row.amount_minor, true);
  if (
    priorityOrder === null || !isOneOf(founderDecisionCodes, row.queue_code)
    || !entityId || !statusCode || !waitingSince || !targetPath
    || (row.amount_minor !== null && amountMinor === null)
    || ![null, 'AZN'].includes(row.currency as never)
  ) return null;
  return {
    priorityOrder,
    queueCode: row.queue_code,
    entityId,
    statusCode,
    amountMinor,
    currency: row.currency as 'AZN' | null,
    waitingSince,
    targetPath
  };
}

function mapException(row: UnknownRow): FounderExceptionItem | null {
  const severityOrder = safeInteger(row.severity_order);
  const entityId = nonEmptyString(row.entity_id);
  const statusCode = nonEmptyString(row.status_code);
  const occurredAt = nonEmptyString(row.occurred_at);
  const targetPath = nonEmptyString(row.target_path);
  const amountMinor = row.amount_minor === null ? null : safeInteger(row.amount_minor, true);
  if (
    severityOrder === null || !isOneOf(founderExceptionCodes, row.exception_code)
    || !entityId || !statusCode || !isOneOf(['CRITICAL', 'HIGH'] as const, row.severity)
    || !occurredAt || !targetPath || (row.amount_minor !== null && amountMinor === null)
    || ![null, 'AZN'].includes(row.currency as never)
  ) return null;
  return {
    severityOrder,
    exceptionCode: row.exception_code,
    entityId,
    statusCode,
    severity: row.severity,
    amountMinor,
    currency: row.currency as 'AZN' | null,
    occurredAt,
    targetPath
  };
}

function mapPipeline(row: UnknownRow): FounderPipelineStage | null {
  const stageOrder = safeInteger(row.stage_order);
  const itemCount = safeInteger(row.item_count);
  const amountMinor = row.amount_minor === null ? null : safeInteger(row.amount_minor, true);
  if (
    stageOrder === null || itemCount === null || !isOneOf(founderPipelineCodes, row.stage_code)
    || (row.amount_minor !== null && amountMinor === null)
    || ![null, 'AZN'].includes(row.currency as never)
  ) return null;
  return {
    stageOrder,
    stageCode: row.stage_code,
    itemCount,
    amountMinor,
    currency: row.currency as 'AZN' | null
  };
}

function mapWorkload(row: UnknownRow): FounderWorkload | null {
  const counts = [
    row.total_items, row.travel_request_items, row.payment_items,
    row.booking_items, row.support_items
  ].map((value) => safeInteger(value));
  const displayName = nonEmptyString(row.display_name);
  const roleSummary = nonEmptyString(row.role_summary);
  const actorId = row.actor_id === null ? null : nonEmptyString(row.actor_id);
  if (
    counts.some((value) => value === null) || !displayName || !roleSummary
    || (row.actor_id !== null && actorId === null)
  ) return null;
  return {
    actorId,
    displayName,
    roleSummary,
    totalItems: counts[0]!,
    travelRequestItems: counts[1]!,
    paymentItems: counts[2]!,
    bookingItems: counts[3]!,
    supportItems: counts[4]!
  };
}

function mapSource(row: UnknownRow): FounderSourceFreshness | null {
  const sourceOrder = safeInteger(row.source_order);
  const recordCount = safeInteger(row.record_count);
  if (
    sourceOrder === null || recordCount === null || !isOneOf(founderSourceCodes, row.source_code)
    || !isOneOf(['AVAILABLE', 'NO_RECORDS', 'NOT_IMPLEMENTED'] as const, row.source_status)
  ) return null;
  return {
    sourceOrder,
    sourceCode: row.source_code,
    sourceStatus: row.source_status,
    recordCount,
    lastChangedAt: nonEmptyString(row.last_changed_at)
  };
}

export async function loadFounderCommandCenter(
  viewer: Viewer
): Promise<FounderCommandCenterSnapshot> {
  if (viewer.source === 'demo') return unavailableSnapshot('DEMO_NOT_AUTHORITATIVE');
  if (viewer.assuranceLevel !== 'aal2' || !viewer.roles.includes('founder')) {
    return unavailableSnapshot('READ_MODEL_UNAVAILABLE');
  }
  const admin = createAdminSupabaseClient();
  if (!admin) return unavailableSnapshot('SERVER_CONFIGURATION_REQUIRED');

  const [metrics, decisions, exceptions, pipeline, workloads, sources] = await Promise.all([
    admin.from('founder_financial_metrics').select('*').order('display_order'),
    admin.from('founder_decision_queue').select('*').order('priority_order').order('waiting_since').limit(100),
    admin.from('founder_critical_exceptions').select('*').order('severity_order').order('occurred_at').limit(100),
    admin.from('founder_pipeline_summary').select('*').order('stage_order'),
    admin.from('founder_team_workload').select('*').order('total_items', { ascending: false }).limit(100),
    admin.from('founder_source_freshness').select('*').order('source_order')
  ]);
  if ([metrics, decisions, exceptions, pipeline, workloads, sources].some(({ error }) => error)) {
    return unavailableSnapshot('READ_MODEL_UNAVAILABLE');
  }

  const mappedMetrics = ((metrics.data ?? []) as UnknownRow[]).map(mapMetric).filter((item) => item !== null);
  const mappedDecisions = ((decisions.data ?? []) as UnknownRow[]).map(mapDecision).filter((item) => item !== null);
  const mappedExceptions = ((exceptions.data ?? []) as UnknownRow[]).map(mapException).filter((item) => item !== null);
  const mappedPipeline = ((pipeline.data ?? []) as UnknownRow[]).map(mapPipeline).filter((item) => item !== null);
  const mappedWorkloads = ((workloads.data ?? []) as UnknownRow[]).map(mapWorkload).filter((item) => item !== null);
  const mappedSources = ((sources.data ?? []) as UnknownRow[]).map(mapSource).filter((item) => item !== null);

  if (
    mappedMetrics.length !== founderMetricCodes.length
    || new Set(mappedMetrics.map(({ metricCode }) => metricCode)).size !== founderMetricCodes.length
    || mappedDecisions.length !== (decisions.data ?? []).length
    || mappedExceptions.length !== (exceptions.data ?? []).length
    || mappedPipeline.length !== founderPipelineCodes.length
    || new Set(mappedPipeline.map(({ stageCode }) => stageCode)).size !== founderPipelineCodes.length
    || mappedWorkloads.length !== (workloads.data ?? []).length
    || mappedSources.length !== founderSourceCodes.length
    || new Set(mappedSources.map(({ sourceCode }) => sourceCode)).size !== founderSourceCodes.length
  ) return unavailableSnapshot('READ_MODEL_UNAVAILABLE');

  return {
    dataState: 'LIVE',
    reasonCode: 'AUTHORITATIVE_POSTGRES_READ_MODEL',
    generatedAt: new Date().toISOString(),
    metrics: mappedMetrics,
    decisions: mappedDecisions,
    exceptions: mappedExceptions,
    pipeline: mappedPipeline,
    workloads: mappedWorkloads,
    sourceFreshness: mappedSources
  };
}
