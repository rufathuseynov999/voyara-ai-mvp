import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import { quotationCanonicalPayloadSchema } from '@/server/commercial/contract';
import {
  paymentEvidenceCanonicalPayloadSchema,
  paymentRequestStatuses,
  type CustomerPaymentRequestView,
  type FinancePaymentCase,
  type PaymentRequestStatus
} from './contract';

type PaymentRequestRow = {
  id: string;
  quotation_id: string;
  quotation_version: number;
  quotation_hash: string;
  customer_id: string;
  locale: string;
  currency: string;
  amount_minor: number;
  status: PaymentRequestStatus;
  current_evidence_id: string | null;
  current_evidence_hash: string | null;
  current_verification_id: string | null;
  current_verification_hash: string | null;
  allocation_id: string | null;
  allocation_hash: string | null;
  created_at: string;
  updated_at: string;
  evidence_received_at: string | null;
  review_started_at: string | null;
  verified_at: string | null;
  allocated_at: string | null;
  readiness_evaluated_at: string | null;
};

function isLocale(value: string): value is Locale {
  return (['az', 'ru', 'en'] as const).includes(value as Locale);
}

function mapCustomerPayment(row: PaymentRequestRow): CustomerPaymentRequestView | null {
  if (!isLocale(row.locale) || row.currency !== 'AZN' || !paymentRequestStatuses.includes(row.status)) return null;
  const amountMinor = Number(row.amount_minor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return {
    id: row.id,
    quotationId: row.quotation_id,
    versionNumber: row.quotation_version,
    quotationHash: row.quotation_hash,
    locale: row.locale,
    currency: 'AZN',
    amountMinor,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidenceReceivedAt: row.evidence_received_at,
    reviewStartedAt: row.review_started_at,
    verifiedAt: row.verified_at,
    allocatedAt: row.allocated_at,
    readinessEvaluatedAt: row.readiness_evaluated_at
  };
}

const paymentSelect = [
  'id', 'quotation_id', 'quotation_version', 'quotation_hash', 'customer_id',
  'locale', 'currency', 'amount_minor', 'status', 'current_evidence_id',
  'current_evidence_hash', 'current_verification_id', 'current_verification_hash',
  'allocation_id', 'allocation_hash', 'created_at', 'updated_at',
  'evidence_received_at', 'review_started_at', 'verified_at', 'allocated_at',
  'readiness_evaluated_at'
].join(', ');

export async function loadCustomerPaymentRequests(
  viewer: Viewer,
  locale: Locale
): Promise<{ payments: CustomerPaymentRequestView[]; availableLocales: Locale[] }> {
  if (viewer.source !== 'supabase' || !viewer.roles.includes('customer')) {
    return { payments: [], availableLocales: [] };
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { payments: [], availableLocales: [] };

  const { data, error } = await supabase
    .from('payment_requests')
    .select(paymentSelect)
    .eq('customer_id', viewer.id)
    .order('created_at', { ascending: false });
  if (error) return { payments: [], availableLocales: [] };
  const mapped = ((data ?? []) as unknown as PaymentRequestRow[])
    .map(mapCustomerPayment)
    .filter((payment): payment is CustomerPaymentRequestView => payment !== null);
  const availableLocales = [...new Set(mapped.map(({ locale: value }) => value))];
  return {
    payments: mapped.filter((payment) => payment.locale === locale),
    availableLocales
  };
}

type QuotationRow = {
  id: string;
  current_version: number;
  current_hash: string;
  customer_id: string;
  accepted_at: string;
};
type QuotationVersionRow = {
  quotation_id: string;
  version_number: number;
  canonical_payload: unknown;
  payload_hash: string;
};
type EvidenceRow = {
  id: string;
  payment_request_id: string;
  canonical_payload: unknown;
  evidence_hash: string;
  created_at: string;
};
type VerificationRow = {
  id: string;
  payment_request_id: string;
  verification_hash: string;
  decision: 'VERIFY' | 'REJECT';
  reason: string;
  decided_at: string;
};
type AllocationRow = {
  id: string;
  payment_request_id: string;
  allocation_hash: string;
  amount_minor: number;
  allocated_at: string;
};

export async function loadFinancePaymentCases(viewer: Viewer): Promise<FinancePaymentCase[]> {
  if (
    viewer.source !== 'supabase'
    || viewer.assuranceLevel !== 'aal2'
    || !viewer.roles.some((role) => ['finance', 'admin', 'founder'].includes(role))
  ) return [];
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const { data: quoteData, error: quoteError } = await supabase
    .from('commercial_quotations')
    .select('id, current_version, current_hash, customer_id, accepted_at')
    .eq('status', 'ACCEPTED')
    .order('accepted_at', { ascending: true })
    .limit(100);
  if (quoteError) return [];
  const quotes = (quoteData ?? []) as QuotationRow[];
  if (quotes.length === 0) return [];
  const quoteIds = quotes.map(({ id }) => id);

  const [versionResult, paymentResult] = await Promise.all([
    supabase
      .from('quotation_versions')
      .select('quotation_id, version_number, canonical_payload, payload_hash')
      .in('quotation_id', quoteIds),
    supabase
      .from('payment_requests')
      .select(paymentSelect)
      .in('quotation_id', quoteIds)
  ]);
  if (versionResult.error || paymentResult.error) return [];
  const versions = (versionResult.data ?? []) as QuotationVersionRow[];
  const payments = (paymentResult.data ?? []) as unknown as PaymentRequestRow[];
  const paymentByQuotation = new Map(payments.map((payment) => [payment.quotation_id, payment]));
  const evidenceIds = payments.flatMap(({ current_evidence_id }) => current_evidence_id ? [current_evidence_id] : []);
  const verificationIds = payments.flatMap(({ current_verification_id }) => current_verification_id ? [current_verification_id] : []);
  const allocationIds = payments.flatMap(({ allocation_id }) => allocation_id ? [allocation_id] : []);

  const [evidenceResult, verificationResult, allocationResult] = await Promise.all([
    evidenceIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('payment_evidence_versions')
        .select('id, payment_request_id, canonical_payload, evidence_hash, created_at')
        .in('id', evidenceIds),
    verificationIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('payment_verification_decisions')
        .select('id, payment_request_id, verification_hash, decision, reason, decided_at')
        .in('id', verificationIds),
    allocationIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('fund_allocations')
        .select('id, payment_request_id, allocation_hash, amount_minor, allocated_at')
        .in('id', allocationIds)
  ]);
  if (evidenceResult.error || verificationResult.error || allocationResult.error) return [];

  const evidenceMap = new Map(((evidenceResult.data ?? []) as EvidenceRow[]).map((item) => [item.id, item]));
  const verificationMap = new Map(((verificationResult.data ?? []) as VerificationRow[]).map((item) => [item.id, item]));
  const allocationMap = new Map(((allocationResult.data ?? []) as AllocationRow[]).map((item) => [item.id, item]));
  const versionMap = new Map(versions.map((version) => [`${version.quotation_id}:${version.version_number}`, version]));

  return quotes.flatMap((quote) => {
    const version = versionMap.get(`${quote.id}:${quote.current_version}`);
    if (!version || version.payload_hash !== quote.current_hash) return [];
    const payload = quotationCanonicalPayloadSchema.safeParse(version.canonical_payload);
    if (!payload.success || sha256(payload.data) !== version.payload_hash) return [];

    const paymentRow = paymentByQuotation.get(quote.id);
    let payment: FinancePaymentCase['payment'] = null;
    if (paymentRow) {
      const safe = mapCustomerPayment(paymentRow);
      if (!safe || safe.quotationHash !== quote.current_hash || safe.versionNumber !== quote.current_version) return [];
      const evidenceRow = paymentRow.current_evidence_id ? evidenceMap.get(paymentRow.current_evidence_id) : null;
      const parsedEvidence = evidenceRow
        ? paymentEvidenceCanonicalPayloadSchema.safeParse(evidenceRow.canonical_payload)
        : null;
      if (
        evidenceRow
        && (!parsedEvidence?.success || sha256(parsedEvidence.data) !== evidenceRow.evidence_hash)
      ) return [];
      const verification = paymentRow.current_verification_id
        ? verificationMap.get(paymentRow.current_verification_id)
        : null;
      const allocation = paymentRow.allocation_id ? allocationMap.get(paymentRow.allocation_id) : null;
      payment = {
        ...safe,
        customerId: paymentRow.customer_id,
        currentEvidence: evidenceRow && parsedEvidence?.success ? {
          id: evidenceRow.id,
          evidenceHash: evidenceRow.evidence_hash,
          sourceKind: parsedEvidence.data.sourceKind,
          channel: parsedEvidence.data.channel,
          amountMinor: parsedEvidence.data.amountMinor,
          observedAt: parsedEvidence.data.observedAt,
          externalReference: parsedEvidence.data.externalReference,
          note: parsedEvidence.data.note,
          createdAt: evidenceRow.created_at
        } : null,
        verification: verification ? {
          id: verification.id,
          verificationHash: verification.verification_hash,
          decision: verification.decision,
          reason: verification.reason,
          decidedAt: verification.decided_at
        } : null,
        allocation: allocation ? {
          id: allocation.id,
          allocationHash: allocation.allocation_hash,
          amountMinor: Number(allocation.amount_minor),
          allocatedAt: allocation.allocated_at
        } : null
      };
    }

    return [{
      quotation: {
        id: quote.id,
        versionNumber: quote.current_version,
        payloadHash: quote.current_hash,
        customerId: quote.customer_id,
        locale: payload.data.customer.locale,
        title: payload.data.customer.title,
        amountMinor: payload.data.customer.totalMinor,
        currency: 'AZN',
        acceptedAt: quote.accepted_at
      },
      payment
    } satisfies FinancePaymentCase];
  });
}
