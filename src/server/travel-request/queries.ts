import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import {
  travelRequestContentSchema,
  type CustomerTravelRequestSummary,
  type StaffTravelRequestQueueItem,
  type TravelRequestContent,
  type TravelRequestStatus
} from './contract';

type RequestRow = {
  id: string;
  customer_id: string;
  status: TravelRequestStatus;
  current_version: number;
  assigned_staff_id: string | null;
  submitted_at: string | null;
  updated_at: string;
};

type VersionRow = {
  travel_request_id: string;
  version_number: number;
  canonical_payload: unknown;
  payload_hash: string;
};

export async function loadCustomerTravelRequests(viewer: Viewer): Promise<{
  draft: { id: string; version: number; content: TravelRequestContent } | null;
  recent: CustomerTravelRequestSummary[];
}> {
  if (viewer.source !== 'supabase') return { draft: null, recent: [] };
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { draft: null, recent: [] };

  const { data, error } = await supabase
    .from('travel_requests')
    .select('id, customer_id, status, current_version, assigned_staff_id, submitted_at, updated_at')
    .eq('customer_id', viewer.id)
    .order('updated_at', { ascending: false })
    .limit(5);
  if (error) return { draft: null, recent: [] };

  const rows = (data ?? []) as RequestRow[];
  const recent = rows.map((row) => ({
    id: row.id,
    status: row.status,
    currentVersion: row.current_version,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at
  }));

  const draftRow = rows.find((row) => row.status === 'DRAFT');
  if (!draftRow || draftRow.current_version < 1) return { draft: null, recent };

  const { data: versionData, error: versionError } = await supabase
    .from('travel_request_versions')
    .select('travel_request_id, version_number, canonical_payload, payload_hash')
    .eq('travel_request_id', draftRow.id)
    .eq('version_number', draftRow.current_version)
    .maybeSingle();
  if (versionError || !versionData) return { draft: null, recent };

  const content = travelRequestContentSchema.safeParse((versionData as VersionRow).canonical_payload);
  return {
    draft: content.success && sha256(content.data) === (versionData as VersionRow).payload_hash
      ? { id: draftRow.id, version: draftRow.current_version, content: content.data }
      : null,
    recent
  };
}

export async function loadStaffTravelRequestQueue(viewer: Viewer): Promise<StaffTravelRequestQueueItem[]> {
  if (viewer.source !== 'supabase' || viewer.assuranceLevel !== 'aal2') return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('travel_requests')
    .select('id, customer_id, status, current_version, assigned_staff_id, submitted_at, updated_at')
    .neq('status', 'DRAFT')
    .order('submitted_at', { ascending: true })
    .limit(100);
  if (error) return [];

  const requests = (data ?? []) as RequestRow[];
  if (requests.length === 0) return [];

  const { data: versionsData, error: versionsError } = await supabase
    .from('travel_request_versions')
    .select('travel_request_id, version_number, canonical_payload, payload_hash')
    .in('travel_request_id', requests.map(({ id }) => id));
  if (versionsError) return [];

  const versions = new Map(
    ((versionsData ?? []) as VersionRow[]).map((version) => [`${version.travel_request_id}:${version.version_number}`, version])
  );

  return requests.flatMap((request) => {
    const version = versions.get(`${request.id}:${request.current_version}`);
    if (!version) return [];
    const content = travelRequestContentSchema.safeParse(version.canonical_payload);
    if (!content.success || sha256(content.data) !== version.payload_hash) return [];
    return [{
      id: request.id,
      customerId: request.customer_id,
      status: request.status,
      currentVersion: request.current_version,
      assignedStaffId: request.assigned_staff_id,
      submittedAt: request.submitted_at,
      updatedAt: request.updated_at,
      destination: content.data.destination,
      departureCity: content.data.departureCity,
      departureDate: content.data.departureDate,
      returnDate: content.data.returnDate,
      travelers: content.data.travelers,
      budgetAzn: content.data.budgetAzn,
      tripPurpose: content.data.tripPurpose,
      notes: content.data.notes,
      locale: content.data.locale,
      payloadHash: version.payload_hash
    }];
  });
}
