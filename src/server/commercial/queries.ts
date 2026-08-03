import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import { travelRequestContentSchema } from '@/server/travel-request/contract';
import {
  quotationCanonicalPayloadSchema,
  quotationCustomerPayloadSchema,
  quotationStatuses,
  type CommercialStaffCase,
  type PublishedProposalView,
  type QuotationStatus
} from './contract';

type RequestRow = {
  id: string;
  customer_id: string;
  assigned_staff_id: string;
  current_version: number;
};

type RequestVersionRow = {
  travel_request_id: string;
  version_number: number;
  canonical_payload: unknown;
  payload_hash: string;
};

type QuotationRow = {
  id: string;
  travel_request_id: string;
  status: QuotationStatus;
  current_version: number;
  current_hash: string | null;
};

type QuotationVersionRow = {
  quotation_id: string;
  version_number: number;
  canonical_payload: unknown;
  payload_hash: string;
};

type DecisionRow = {
  quotation_id: string;
  version_number: number;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  decided_at: string;
};

export async function loadCommercialStaffCases(viewer: Viewer): Promise<CommercialStaffCase[]> {
  if (viewer.source !== 'supabase' || viewer.assuranceLevel !== 'aal2') return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  let requestQuery = supabase
    .from('travel_requests')
    .select('id, customer_id, assigned_staff_id, current_version')
    .eq('status', 'HUMAN_REVIEW')
    .order('updated_at', { ascending: true })
    .limit(100);
  if (!viewer.roles.includes('founder')) requestQuery = requestQuery.eq('assigned_staff_id', viewer.id);
  const { data: requestData, error: requestError } = await requestQuery;
  if (requestError) return [];
  const requests = (requestData ?? []) as RequestRow[];
  if (requests.length === 0) return [];

  const requestIds = requests.map(({ id }) => id);
  const [requestVersionsResult, quotationsResult] = await Promise.all([
    supabase
      .from('travel_request_versions')
      .select('travel_request_id, version_number, canonical_payload, payload_hash')
      .in('travel_request_id', requestIds),
    supabase
      .from('commercial_quotations')
      .select('id, travel_request_id, status, current_version, current_hash')
      .in('travel_request_id', requestIds)
  ]);
  if (requestVersionsResult.error || quotationsResult.error) return [];

  const requestVersions = new Map(
    ((requestVersionsResult.data ?? []) as RequestVersionRow[]).map((version) => [
      `${version.travel_request_id}:${version.version_number}`,
      version
    ])
  );
  const quotations = (quotationsResult.data ?? []) as QuotationRow[];
  const quoteByRequest = new Map(quotations.map((quotation) => [quotation.travel_request_id, quotation]));
  const quotationIds = quotations.map(({ id }) => id);

  let quotationVersions: QuotationVersionRow[] = [];
  let decisions: DecisionRow[] = [];
  if (quotationIds.length > 0) {
    const [quotationVersionsResult, decisionsResult] = await Promise.all([
      supabase
        .from('quotation_versions')
        .select('quotation_id, version_number, canonical_payload, payload_hash')
        .in('quotation_id', quotationIds),
      supabase
        .from('commercial_approval_decisions')
        .select('quotation_id, version_number, decision, reason, decided_at')
        .in('quotation_id', quotationIds)
        .order('decided_at', { ascending: false })
    ]);
    if (quotationVersionsResult.error || decisionsResult.error) return [];
    quotationVersions = (quotationVersionsResult.data ?? []) as QuotationVersionRow[];
    decisions = (decisionsResult.data ?? []) as DecisionRow[];
  }

  const quotationVersionMap = new Map(
    quotationVersions.map((version) => [`${version.quotation_id}:${version.version_number}`, version])
  );

  return requests.flatMap((request) => {
    const requestVersion = requestVersions.get(`${request.id}:${request.current_version}`);
    if (!requestVersion) return [];
    const requestContent = travelRequestContentSchema.safeParse(requestVersion.canonical_payload);
    if (!requestContent.success || sha256(requestContent.data) !== requestVersion.payload_hash) return [];

    const quotation = quoteByRequest.get(request.id);
    let mappedQuotation: CommercialStaffCase['quotation'] = null;
    if (quotation && quotation.current_version > 0 && quotation.current_hash) {
      if (!quotationStatuses.includes(quotation.status)) return [];
      const quotationVersion = quotationVersionMap.get(`${quotation.id}:${quotation.current_version}`);
      if (!quotationVersion || quotationVersion.payload_hash !== quotation.current_hash) return [];
      const payload = quotationCanonicalPayloadSchema.safeParse(quotationVersion.canonical_payload);
      if (!payload.success || sha256(payload.data) !== quotationVersion.payload_hash) return [];
      const lastDecision = decisions.find((decision) => decision.quotation_id === quotation.id) ?? null;
      mappedQuotation = {
        id: quotation.id,
        status: quotation.status,
        versionNumber: quotation.current_version,
        payloadHash: quotation.current_hash,
        payload: payload.data,
        lastDecision: lastDecision ? {
          decision: lastDecision.decision,
          reason: lastDecision.reason,
          decidedAt: lastDecision.decided_at
        } : null
      };
    }

    return [{
      travelRequest: {
        id: request.id,
        customerId: request.customer_id,
        assignedStaffId: request.assigned_staff_id,
        versionNumber: request.current_version,
        payloadHash: requestVersion.payload_hash,
        destination: requestContent.data.destination,
        departureCity: requestContent.data.departureCity,
        departureDate: requestContent.data.departureDate,
        returnDate: requestContent.data.returnDate,
        budgetAzn: requestContent.data.budgetAzn,
        locale: requestContent.data.locale
      },
      quotation: mappedQuotation
    }];
  });
}

type PublishedRow = {
  id: string;
  quotation_id: string;
  version_number: number;
  payload_hash: string;
  customer_payload: unknown;
  locale: Locale;
  valid_until: string;
  published_at: string;
};

type AcceptanceRow = {
  quotation_id: string;
  accepted_at: string | null;
};

export async function loadCustomerPublishedProposals(
  viewer: Viewer,
  locale: Locale
): Promise<{ proposals: PublishedProposalView[]; availableLocales: Locale[] }> {
  if (viewer.source !== 'supabase' || !viewer.roles.includes('customer')) {
    return { proposals: [], availableLocales: [] };
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { proposals: [], availableLocales: [] };

  const { data: publishedData, error: publishedError } = await supabase
    .from('published_proposals')
    .select('id, quotation_id, version_number, payload_hash, customer_payload, locale, valid_until, published_at')
    .eq('customer_id', viewer.id)
    .order('published_at', { ascending: false });
  if (publishedError) return { proposals: [], availableLocales: [] };
  const published = (publishedData ?? []) as PublishedRow[];
  if (published.length === 0) return { proposals: [], availableLocales: [] };

  const { data: acceptanceData, error: acceptanceError } = await supabase
    .from('customer_quotation_acceptances')
    .select('quotation_id, accepted_at')
    .in('quotation_id', published.map(({ quotation_id }) => quotation_id));
  if (acceptanceError) return { proposals: [], availableLocales: [] };
  const acceptanceMap = new Map(
    ((acceptanceData ?? []) as AcceptanceRow[]).map((acceptance) => [acceptance.quotation_id, acceptance])
  );
  const availableLocales = [...new Set(published.map((proposal) => proposal.locale))]
    .filter((value): value is Locale => localesInclude(value));

  const proposals = published.flatMap((proposal) => {
    if (proposal.locale !== locale) return [];
    const customer = quotationCustomerPayloadSchema.safeParse(proposal.customer_payload);
    const acceptance = acceptanceMap.get(proposal.quotation_id);
    if (!customer.success) return [];
    return [{
      id: proposal.id,
      quotationId: proposal.quotation_id,
      versionNumber: proposal.version_number,
      payloadHash: proposal.payload_hash,
      status: acceptance ? 'ACCEPTED' : 'PUBLISHED',
      customer: customer.data,
      locale: proposal.locale,
      validUntil: proposal.valid_until,
      publishedAt: proposal.published_at,
      acceptedAt: acceptance?.accepted_at ?? null
    } satisfies PublishedProposalView];
  });
  return { proposals, availableLocales };
}

function localesInclude(value: string): value is Locale {
  return (['az', 'ru', 'en'] as const).includes(value as Locale);
}
