import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';
import type { Viewer } from '@/server/auth/viewer';
import {
  supportCaseCategories,
  supportCaseStatuses,
  supportEscalationLevels,
  supportEventTypes,
  supportPriorities,
  type CustomerSupportCase,
  type CustomerSupportEventView,
  type StaffSupportCase,
  type StaffSupportEventView
} from './contract';

type CaseRow = {
  id: string;
  booking_id: string;
  voucher_id: string;
  voucher_version: number;
  voucher_hash: string;
  customer_id: string;
  locale: string;
  category: string;
  subject: string;
  status: string;
  priority: string;
  escalation_level?: string;
  owner_id?: string | null;
  case_authority_hash?: string;
  current_event_sequence?: number;
  current_event_hash?: string;
  opened_at: string;
  updated_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
};

type EventRow = {
  id: string;
  case_id: string;
  event_sequence: number;
  event_type: string;
  visibility: string;
  message: string;
  actor_id?: string;
  actor_kind?: string;
  event_hash?: string;
  occurred_at: string;
};

const customerCaseColumns = [
  'id', 'booking_id', 'voucher_id', 'voucher_version', 'voucher_hash',
  'customer_id', 'locale', 'category', 'subject', 'status', 'priority',
  'opened_at', 'updated_at', 'first_response_at', 'resolved_at', 'closed_at'
].join(', ');

const staffCaseColumns = [
  customerCaseColumns, 'escalation_level', 'owner_id', 'case_authority_hash',
  'current_event_sequence', 'current_event_hash'
].join(', ');

const customerEventColumns = [
  'id', 'case_id', 'event_sequence', 'event_type', 'visibility', 'message', 'occurred_at'
].join(', ');

const staffEventColumns = [
  customerEventColumns, 'actor_id', 'actor_kind', 'event_hash'
].join(', ');

function validCase(row: CaseRow): boolean {
  return (
    ['az', 'ru', 'en'].includes(row.locale)
    && supportCaseCategories.includes(row.category as never)
    && supportCaseStatuses.includes(row.status as never)
    && supportPriorities.includes(row.priority as never)
  );
}

function mapCustomerEvent(row: EventRow): CustomerSupportEventView | null {
  if (
    row.visibility !== 'CUSTOMER'
    || !supportEventTypes.includes(row.event_type as never)
    || row.event_type === 'INTERNAL_NOTE'
  ) return null;
  return {
    id: row.id,
    sequence: row.event_sequence,
    eventType: row.event_type as CustomerSupportEventView['eventType'],
    message: row.message,
    occurredAt: row.occurred_at
  };
}

function mapCustomerCase(row: CaseRow, events: CustomerSupportEventView[]): CustomerSupportCase {
  return {
    id: row.id,
    bookingId: row.booking_id,
    voucherId: row.voucher_id,
    voucherVersion: row.voucher_version,
    voucherHash: row.voucher_hash,
    locale: row.locale as Locale,
    category: row.category as CustomerSupportCase['category'],
    subject: row.subject,
    status: row.status as CustomerSupportCase['status'],
    priority: row.priority as CustomerSupportCase['priority'],
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    events
  };
}

export async function loadCustomerSupportCases(
  viewer: Viewer,
  locale: Locale
): Promise<CustomerSupportCase[]> {
  if (viewer.source !== 'supabase' || !viewer.roles.includes('customer')) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('support_cases')
    .select(customerCaseColumns)
    .eq('customer_id', viewer.id)
    .eq('locale', locale)
    .order('opened_at', { ascending: false })
    .limit(100);
  if (error) return [];
  const cases = ((data ?? []) as unknown as CaseRow[]).filter(validCase);
  if (cases.length === 0) return [];
  const { data: eventData, error: eventError } = await supabase
    .from('support_case_events')
    .select(customerEventColumns)
    .in('case_id', cases.map(({ id }) => id))
    .eq('visibility', 'CUSTOMER')
    .order('event_sequence', { ascending: true });
  if (eventError) return [];
  const eventsByCase = new Map<string, CustomerSupportEventView[]>();
  for (const row of (eventData ?? []) as unknown as EventRow[]) {
    const event = mapCustomerEvent(row);
    if (!event) continue;
    eventsByCase.set(row.case_id, [...(eventsByCase.get(row.case_id) ?? []), event]);
  }
  return cases.map((row) => mapCustomerCase(row, eventsByCase.get(row.id) ?? []));
}

export async function loadStaffSupportCases(viewer: Viewer): Promise<StaffSupportCase[]> {
  if (
    viewer.source !== 'supabase'
    || viewer.assuranceLevel !== 'aal2'
    || !viewer.roles.some((role) => ['staff', 'manager', 'admin', 'founder'].includes(role))
  ) return [];
  const admin = createAdminSupabaseClient();
  if (!admin) return [];
  const { data, error } = await admin
    .from('support_cases')
    .select(staffCaseColumns)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) return [];
  const cases = ((data ?? []) as unknown as CaseRow[]).filter((row) =>
    validCase(row)
    && supportEscalationLevels.includes(row.escalation_level as never)
    && typeof row.case_authority_hash === 'string'
    && typeof row.current_event_sequence === 'number'
    && typeof row.current_event_hash === 'string'
  );
  if (cases.length === 0) return [];
  const { data: eventData, error: eventError } = await admin
    .from('support_case_events')
    .select(staffEventColumns)
    .in('case_id', cases.map(({ id }) => id))
    .order('event_sequence', { ascending: true });
  if (eventError) return [];
  const eventsByCase = new Map<string, StaffSupportEventView[]>();
  for (const row of (eventData ?? []) as unknown as EventRow[]) {
    if (
      !supportEventTypes.includes(row.event_type as never)
      || !['CUSTOMER', 'INTERNAL'].includes(row.visibility)
      || !['CUSTOMER', 'STAFF'].includes(row.actor_kind ?? '')
      || !row.actor_id || !row.event_hash
    ) continue;
    const event: StaffSupportEventView = {
      id: row.id,
      sequence: row.event_sequence,
      eventType: row.event_type as StaffSupportEventView['eventType'],
      visibility: row.visibility as StaffSupportEventView['visibility'],
      message: row.message,
      actorId: row.actor_id,
      actorKind: row.actor_kind as StaffSupportEventView['actorKind'],
      eventHash: row.event_hash,
      occurredAt: row.occurred_at
    };
    eventsByCase.set(row.case_id, [...(eventsByCase.get(row.case_id) ?? []), event]);
  }
  return cases.map((row) => ({
    ...mapCustomerCase(row, []),
    customerId: row.customer_id,
    ownerId: row.owner_id ?? null,
    escalationLevel: row.escalation_level as StaffSupportCase['escalationLevel'],
    caseAuthorityHash: row.case_authority_hash!,
    currentEventSequence: row.current_event_sequence!,
    currentEventHash: row.current_event_hash!,
    events: eventsByCase.get(row.id) ?? []
  }));
}
