export const founderMetricCodes = [
  'CASH',
  'REVENUE',
  'GBV',
  'PLANNED_GROSS_PROFIT',
  'RECEIVABLES',
  'EXPOSURE'
] as const;

export type FounderMetricCode = (typeof founderMetricCodes)[number];
export type FounderMetricAvailability = 'AVAILABLE' | 'UNAVAILABLE';

export const founderDecisionCodes = [
  'COMMERCIAL_APPROVAL',
  'PAYMENT_REVIEW',
  'PAYMENT_VERIFICATION',
  'FUNDS_ALLOCATION',
  'FINANCIAL_READINESS',
  'BOOKING_VERIFICATION',
  'VOUCHER_ISSUE',
  'SUPPORT_ESCALATION'
] as const;

export type FounderDecisionCode = (typeof founderDecisionCodes)[number];

export const founderExceptionCodes = [
  'PAYMENT_EVIDENCE_REJECTED',
  'BOOKING_VERIFICATION_REJECTED',
  'SUPPORT_CRITICAL'
] as const;

export type FounderExceptionCode = (typeof founderExceptionCodes)[number];

export const founderPipelineCodes = [
  'TRAVEL_REQUEST_INTAKE',
  'COMMERCIAL_DRAFT',
  'COMMERCIAL_APPROVAL',
  'PROPOSAL_PUBLISHED',
  'CUSTOMER_ACCEPTED',
  'PAYMENT_PENDING',
  'PAYMENT_READY',
  'BOOKING_OPERATIONS',
  'BOOKING_VERIFICATION',
  'VOUCHER_ISSUED'
] as const;

export type FounderPipelineCode = (typeof founderPipelineCodes)[number];

export const founderSourceCodes = [
  'TRAVEL_REQUEST',
  'COMMERCIAL',
  'PAYMENT',
  'BOOKING',
  'SUPPORT',
  'MEMBERSHIP',
  'AI_ACTIVITY_AND_COST',
  'CASH_LEDGER',
  'REVENUE_LEDGER',
  'SYSTEM_MONITORING'
] as const;

export type FounderSourceCode = (typeof founderSourceCodes)[number];
export type FounderSourceStatus = 'AVAILABLE' | 'NO_RECORDS' | 'NOT_IMPLEMENTED';

export type FounderFinancialMetric = {
  displayOrder: number;
  metricCode: FounderMetricCode;
  availability: FounderMetricAvailability;
  amountMinor: number | null;
  currency: 'AZN';
  basisCode: string;
  sourceRecordCount: number;
  sourceUpdatedAt: string | null;
};

export type FounderDecisionItem = {
  priorityOrder: number;
  queueCode: FounderDecisionCode;
  entityId: string;
  statusCode: string;
  amountMinor: number | null;
  currency: 'AZN' | null;
  waitingSince: string;
  targetPath: string;
};

export type FounderExceptionItem = {
  severityOrder: number;
  exceptionCode: FounderExceptionCode;
  entityId: string;
  statusCode: string;
  severity: 'CRITICAL' | 'HIGH';
  amountMinor: number | null;
  currency: 'AZN' | null;
  occurredAt: string;
  targetPath: string;
};

export type FounderPipelineStage = {
  stageOrder: number;
  stageCode: FounderPipelineCode;
  itemCount: number;
  amountMinor: number | null;
  currency: 'AZN' | null;
};

export type FounderWorkload = {
  actorId: string | null;
  displayName: string;
  roleSummary: string;
  totalItems: number;
  travelRequestItems: number;
  paymentItems: number;
  bookingItems: number;
  supportItems: number;
};

export type FounderSourceFreshness = {
  sourceOrder: number;
  sourceCode: FounderSourceCode;
  sourceStatus: FounderSourceStatus;
  recordCount: number;
  lastChangedAt: string | null;
};

export type FounderCommandCenterSnapshot = {
  dataState: 'LIVE' | 'UNAVAILABLE';
  reasonCode: 'AUTHORITATIVE_POSTGRES_READ_MODEL' | 'DEMO_NOT_AUTHORITATIVE'
    | 'SERVER_CONFIGURATION_REQUIRED' | 'READ_MODEL_UNAVAILABLE';
  generatedAt: string;
  metrics: FounderFinancialMetric[];
  decisions: FounderDecisionItem[];
  exceptions: FounderExceptionItem[];
  pipeline: FounderPipelineStage[];
  workloads: FounderWorkload[];
  sourceFreshness: FounderSourceFreshness[];
};

