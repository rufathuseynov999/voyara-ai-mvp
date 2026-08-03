import { z } from 'zod';
import { locales, type Locale } from '@/i18n/config';

export const quotationStatuses = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
  'ACCEPTED'
] as const;
export type QuotationStatus = (typeof quotationStatuses)[number];

export const quotationRiskFlags = [
  'PRICE_VOLATILITY',
  'SUPPLIER_UNVERIFIED',
  'LOW_MARGIN',
  'NON_REFUNDABLE',
  'MANUAL_CONFIRMATION_REQUIRED',
  'CUSTOM_TERMS'
] as const;
export type QuotationRiskFlag = (typeof quotationRiskFlags)[number];

function aznToMinor(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const aznAmountSchema = z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/)
  .refine((value) => aznToMinor(value) <= 10_000_000_000);
const validUntilSchema = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && value.includes('T');
});

const quotationLineDraftSchema = z.object({
  description: z.string().trim().min(2).max(160),
  quantity: z.coerce.number().int().min(1).max(100),
  unitPriceAzn: aznAmountSchema
}).strict();

export const quotationDraftSchema = z.object({
  locale: z.enum(locales),
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(1_200),
  lineItems: z.array(quotationLineDraftSchema).min(1).max(20),
  serviceFeeAzn: aznAmountSchema,
  discountAzn: aznAmountSchema,
  costTotalAzn: aznAmountSchema,
  validUntil: validUntilSchema,
  customerNotes: z.string().trim().max(1_200),
  riskFlags: z.array(z.enum(quotationRiskFlags)).max(6)
    .refine((flags) => new Set(flags).size === flags.length)
}).strict();

const exactQuotationReference = {
  quotationId: z.uuid(),
  versionNumber: z.coerce.number().int().positive(),
  quotationHash: sha256Schema
};

export const staffCommercialCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('quotation.create_version'),
    travelRequestId: z.uuid(),
    quotationId: z.uuid().optional(),
    draft: quotationDraftSchema
  }).strict(),
  z.object({
    action: z.literal('quotation.submit_for_approval'),
    ...exactQuotationReference
  }).strict(),
  z.object({
    action: z.literal('quotation.decide'),
    ...exactQuotationReference,
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(3).max(500)
  }).strict(),
  z.object({
    action: z.literal('quotation.publish'),
    ...exactQuotationReference
  }).strict()
]);

export const customerCommercialCommandSchema = z.object({
  action: z.literal('quotation.accept'),
  ...exactQuotationReference,
  locale: z.enum(locales),
  acceptanceConfirmed: z.literal(true)
}).strict();

const canonicalLineItemSchema = z.object({
  lineNumber: z.number().int().positive(),
  description: z.string().min(2).max(160),
  quantity: z.number().int().min(1).max(100),
  unitPriceMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative()
}).strict();

export const quotationCustomerPayloadSchema = z.object({
  locale: z.enum(locales),
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(1_200),
  currency: z.literal('AZN'),
  lineItems: z.array(canonicalLineItemSchema).min(1).max(20),
  subtotalMinor: z.number().int().nonnegative(),
  serviceFeeMinor: z.number().int().nonnegative(),
  discountMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().positive(),
  validUntil: z.string(),
  customerNotes: z.string().max(1_200)
}).strict();

export const quotationCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('quotation-v1'),
  source: z.object({
    travelRequestId: z.uuid(),
    travelRequestVersion: z.number().int().positive(),
    travelRequestHash: sha256Schema
  }).strict(),
  customer: quotationCustomerPayloadSchema,
  commercial: z.object({
    costTotalMinor: z.number().int().nonnegative(),
    grossProfitMinor: z.number().int(),
    grossMarginBps: z.number().int()
  }).strict(),
  riskFlags: z.array(z.enum(quotationRiskFlags)).max(6)
}).strict();

export type QuotationDraft = z.infer<typeof quotationDraftSchema>;
export type QuotationCanonicalPayload = z.infer<typeof quotationCanonicalPayloadSchema>;
export type QuotationCustomerPayload = z.infer<typeof quotationCustomerPayloadSchema>;
export type StaffCommercialCommand = z.infer<typeof staffCommercialCommandSchema>;
export type CustomerCommercialCommand = z.infer<typeof customerCommercialCommandSchema>;
export type CommercialCommand = StaffCommercialCommand | CustomerCommercialCommand;

export type CommercialCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: CommercialCommand['action'];
  quotationId?: string;
  quotationStatus?: QuotationStatus;
  versionNumber?: number;
  payloadHash?: string;
  workReceiptId?: string;
};

export type CommercialStaffCase = {
  travelRequest: {
    id: string;
    customerId: string;
    assignedStaffId: string;
    versionNumber: number;
    payloadHash: string;
    destination: string;
    departureCity: string;
    departureDate: string;
    returnDate: string;
    budgetAzn: number;
    locale: Locale;
  };
  quotation: null | {
    id: string;
    status: QuotationStatus;
    versionNumber: number;
    payloadHash: string;
    payload: QuotationCanonicalPayload;
    lastDecision: null | {
      decision: 'APPROVE' | 'REJECT';
      reason: string;
      decidedAt: string;
    };
  };
};

export type PublishedProposalView = {
  id: string;
  quotationId: string;
  versionNumber: number;
  payloadHash: string;
  status: 'PUBLISHED' | 'ACCEPTED';
  customer: QuotationCustomerPayload;
  locale: Locale;
  validUntil: string;
  publishedAt: string;
  acceptedAt: string | null;
};

export function buildCanonicalQuotationPayload(
  source: { travelRequestId: string; travelRequestVersion: number; travelRequestHash: string },
  input: QuotationDraft
): QuotationCanonicalPayload {
  const draft = quotationDraftSchema.parse(input);
  if (Date.parse(draft.validUntil) <= Date.now()) throw new Error('QUOTATION_VALIDITY_REQUIRED');

  const lineItems = draft.lineItems.map((item, index) => {
    const unitPriceMinor = aznToMinor(item.unitPriceAzn);
    return {
      lineNumber: index + 1,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor,
      totalMinor: item.quantity * unitPriceMinor
    };
  });
  const subtotalMinor = lineItems.reduce((total, item) => total + item.totalMinor, 0);
  const serviceFeeMinor = aznToMinor(draft.serviceFeeAzn);
  const discountMinor = aznToMinor(draft.discountAzn);
  if (discountMinor > subtotalMinor + serviceFeeMinor) throw new Error('INVALID_QUOTATION_DISCOUNT');
  const totalMinor = subtotalMinor + serviceFeeMinor - discountMinor;
  if (totalMinor <= 0) throw new Error('INVALID_QUOTATION_TOTAL');

  const costTotalMinor = aznToMinor(draft.costTotalAzn);
  const grossProfitMinor = totalMinor - costTotalMinor;
  const grossMarginBps = Math.trunc((grossProfitMinor * 10_000) / totalMinor);

  return quotationCanonicalPayloadSchema.parse({
    schemaVersion: 'quotation-v1',
    source,
    customer: {
      locale: draft.locale,
      title: draft.title,
      summary: draft.summary,
      currency: 'AZN',
      lineItems,
      subtotalMinor,
      serviceFeeMinor,
      discountMinor,
      totalMinor,
      validUntil: new Date(draft.validUntil).toISOString(),
      customerNotes: draft.customerNotes
    },
    commercial: { costTotalMinor, grossProfitMinor, grossMarginBps },
    riskFlags: [...draft.riskFlags].sort()
  });
}
