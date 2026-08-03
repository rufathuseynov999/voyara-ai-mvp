import { z } from 'zod';
import { locales, type Locale } from '@/i18n/config';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const messageSchema = z.string().trim().min(5).max(2_000);
const reasonSchema = z.string().trim().min(8).max(500);

export const supportCaseCategories = [
  'TRAVEL_DISRUPTION',
  'SUPPLIER_SERVICE',
  'DOCUMENT_OR_VOUCHER',
  'ITINERARY_QUESTION',
  'OTHER'
] as const;
export type SupportCaseCategory = (typeof supportCaseCategories)[number];

export const supportReportedUrgencies = ['NORMAL', 'URGENT'] as const;
export type SupportReportedUrgency = (typeof supportReportedUrgencies)[number];

export const supportCaseStatuses = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED'
] as const;
export type SupportCaseStatus = (typeof supportCaseStatuses)[number];

export const supportPriorities = [
  'P1_CRITICAL',
  'P2_HIGH',
  'P3_NORMAL',
  'P4_LOW'
] as const;
export type SupportPriority = (typeof supportPriorities)[number];

export const supportEscalationLevels = ['NONE', 'MANAGER', 'FOUNDER'] as const;
export type SupportEscalationLevel = (typeof supportEscalationLevels)[number];

export const supportEventTypes = [
  'CASE_OPENED',
  'CUSTOMER_MESSAGE',
  'CASE_CLAIMED',
  'PRIORITY_CHANGED',
  'CASE_ESCALATED',
  'CUSTOMER_UPDATE',
  'INTERNAL_NOTE',
  'CASE_RESOLVED',
  'CASE_CLOSED'
] as const;
export type SupportEventType = (typeof supportEventTypes)[number];

export const supportCaseEventTypes = [
  'CUSTOMER_MESSAGE',
  'CASE_CLAIMED',
  'PRIORITY_CHANGED',
  'CASE_ESCALATED',
  'CUSTOMER_UPDATE',
  'INTERNAL_NOTE',
  'CASE_RESOLVED',
  'CASE_CLOSED'
] as const;

export const customerSupportCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('support.case.open'),
    bookingId: z.uuid(),
    category: z.enum(supportCaseCategories),
    urgency: z.enum(supportReportedUrgencies),
    subject: z.string().trim().min(5).max(120),
    message: z.string().trim().min(10).max(2_000),
    declarationConfirmed: z.literal(true)
  }).strict(),
  z.object({
    action: z.literal('support.case.message'),
    caseId: z.uuid(),
    message: messageSchema
  }).strict()
]);

export const staffSupportCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('support.case.claim'),
    caseId: z.uuid()
  }).strict(),
  z.object({
    action: z.literal('support.case.priority.set'),
    caseId: z.uuid(),
    priority: z.enum(supportPriorities),
    reason: reasonSchema
  }).strict(),
  z.object({
    action: z.literal('support.case.escalate'),
    caseId: z.uuid(),
    targetLevel: z.enum(['MANAGER', 'FOUNDER']),
    reason: reasonSchema
  }).strict(),
  z.object({
    action: z.literal('support.case.customer_update'),
    caseId: z.uuid(),
    message: messageSchema,
    nextStatus: z.enum(['IN_PROGRESS', 'WAITING_CUSTOMER'])
  }).strict(),
  z.object({
    action: z.literal('support.case.internal_note'),
    caseId: z.uuid(),
    message: messageSchema
  }).strict(),
  z.object({
    action: z.literal('support.case.resolve'),
    caseId: z.uuid(),
    resolution: z.string().trim().min(10).max(2_000),
    financialAuthorityUnaffectedConfirmed: z.literal(true)
  }).strict(),
  z.object({
    action: z.literal('support.case.close'),
    caseId: z.uuid(),
    closureNote: reasonSchema,
    financialAuthorityUnaffectedConfirmed: z.literal(true)
  }).strict()
]);

export const supportCaseOpenCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('support-case-open-v1'),
  caseId: z.uuid(),
  bookingId: z.uuid(),
  voucherId: z.uuid(),
  voucherVersion: z.number().int().positive(),
  voucherHash: sha256Schema,
  customerId: z.uuid(),
  locale: z.enum(locales),
  category: z.enum(supportCaseCategories),
  urgency: z.enum(supportReportedUrgencies),
  subject: z.string().trim().min(5).max(120),
  message: z.string().trim().min(10).max(2_000),
  declarationConfirmed: z.literal(true)
}).strict();

export const supportCaseEventCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('support-case-event-v1'),
  caseId: z.uuid(),
  caseAuthorityHash: sha256Schema,
  eventSequence: z.number().int().min(2),
  previousEventHash: sha256Schema,
  eventType: z.enum(supportCaseEventTypes),
  visibility: z.enum(['CUSTOMER', 'INTERNAL']),
  message: messageSchema,
  nextStatus: z.enum([...supportCaseStatuses, '']),
  priority: z.enum([...supportPriorities, '']),
  escalationLevel: z.enum([...supportEscalationLevels, '']),
  financialAuthorityUnaffected: z.literal(true)
}).strict();

export type CustomerSupportCommand = z.infer<typeof customerSupportCommandSchema>;
export type StaffSupportCommand = z.infer<typeof staffSupportCommandSchema>;
export type SupportCaseOpenCanonicalPayload = z.infer<typeof supportCaseOpenCanonicalPayloadSchema>;
export type SupportCaseEventCanonicalPayload = z.infer<typeof supportCaseEventCanonicalPayloadSchema>;

export function buildCanonicalSupportCaseOpenPayload(input: {
  caseId: string;
  bookingId: string;
  voucherId: string;
  voucherVersion: number;
  voucherHash: string;
  customerId: string;
  locale: Locale;
  category: SupportCaseCategory;
  urgency: SupportReportedUrgency;
  subject: string;
  message: string;
  declarationConfirmed: true;
}): SupportCaseOpenCanonicalPayload {
  return supportCaseOpenCanonicalPayloadSchema.parse({
    schemaVersion: 'support-case-open-v1',
    ...input
  });
}

export function buildCanonicalSupportCaseEventPayload(input: {
  caseId: string;
  caseAuthorityHash: string;
  eventSequence: number;
  previousEventHash: string;
  eventType: Exclude<SupportEventType, 'CASE_OPENED'>;
  visibility: 'CUSTOMER' | 'INTERNAL';
  message: string;
  nextStatus?: SupportCaseStatus;
  priority?: SupportPriority;
  escalationLevel?: SupportEscalationLevel;
}): SupportCaseEventCanonicalPayload {
  return supportCaseEventCanonicalPayloadSchema.parse({
    schemaVersion: 'support-case-event-v1',
    caseId: input.caseId,
    caseAuthorityHash: input.caseAuthorityHash,
    eventSequence: input.eventSequence,
    previousEventHash: input.previousEventHash,
    eventType: input.eventType,
    visibility: input.visibility,
    message: input.message,
    nextStatus: input.nextStatus ?? '',
    priority: input.priority ?? '',
    escalationLevel: input.escalationLevel ?? '',
    financialAuthorityUnaffected: true
  });
}

export type SupportCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: CustomerSupportCommand['action'] | StaffSupportCommand['action'];
  caseId?: string;
  caseStatus?: SupportCaseStatus;
  priority?: SupportPriority;
  escalationLevel?: SupportEscalationLevel;
  ownerId?: string;
  eventId?: string;
  eventSequence?: number;
  eventHash?: string;
};

export type CustomerSupportEventView = {
  id: string;
  sequence: number;
  eventType: Exclude<SupportEventType, 'INTERNAL_NOTE'>;
  message: string;
  occurredAt: string;
};

export type CustomerSupportCase = {
  id: string;
  bookingId: string;
  voucherId: string;
  voucherVersion: number;
  voucherHash: string;
  locale: Locale;
  category: SupportCaseCategory;
  subject: string;
  status: SupportCaseStatus;
  priority: SupportPriority;
  openedAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  events: CustomerSupportEventView[];
};

export type StaffSupportEventView = {
  id: string;
  sequence: number;
  eventType: SupportEventType;
  message: string;
  occurredAt: string;
  visibility: 'CUSTOMER' | 'INTERNAL';
  actorId: string;
  actorKind: 'CUSTOMER' | 'STAFF';
  eventHash: string;
};

export type StaffSupportCase = Omit<CustomerSupportCase, 'events'> & {
  customerId: string;
  ownerId: string | null;
  escalationLevel: SupportEscalationLevel;
  caseAuthorityHash: string;
  currentEventSequence: number;
  currentEventHash: string;
  events: StaffSupportEventView[];
};
