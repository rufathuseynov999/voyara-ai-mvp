import { z } from 'zod';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const evidenceTimestampSchema = z.iso.datetime({ offset: true });
const reasonSchema = z.string().trim().min(8).max(500);

export const crmTaskTypes = [
  'CUSTOMER_FOLLOW_UP',
  'DOCUMENT_REVIEW',
  'PAYMENT_FOLLOW_UP',
  'SUPPLIER_CHECK',
  'BOOKING_FOLLOW_UP',
  'SUPPORT_HANDOFF',
  'OTHER'
] as const;
export type CrmTaskType = (typeof crmTaskTypes)[number];

export const crmTaskStatuses = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type CrmTaskStatus = (typeof crmTaskStatuses)[number];

export const crmTaskEventTypes = [
  'TASK_CREATED',
  'TASK_CLAIMED',
  'TASK_REASSIGNED',
  'TASK_STATUS_CHANGED',
  'TASK_CANCELLED'
] as const;
export type CrmTaskEventType = (typeof crmTaskEventTypes)[number];

export const supplierServiceCategories = [
  'FLIGHT', 'HOTEL', 'TRANSFER', 'INSURANCE', 'TOUR', 'VISA_SUPPORT', 'OTHER'
] as const;
export type SupplierServiceCategory = (typeof supplierServiceCategories)[number];

export const supplierOperationalChannels = ['EMAIL', 'PHONE', 'PORTAL', 'MESSAGING', 'MANUAL'] as const;
export type SupplierOperationalChannel = (typeof supplierOperationalChannels)[number];

export const supplierConfigurationStatuses = ['ACTIVE', 'PAUSED'] as const;
export type SupplierConfigurationStatus = (typeof supplierConfigurationStatuses)[number];

const taskPointerSchema = {
  taskId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  expectedHash: sha256Schema
};

const supplierConfigurationSchema = {
  displayName: z.string().trim().min(2).max(120),
  serviceCategory: z.enum(supplierServiceCategories),
  operationalChannel: z.enum(supplierOperationalChannels),
  status: z.enum(supplierConfigurationStatuses),
  operationsNote: z.string().trim().max(500)
};

export const administrationCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('crm.task.create'),
    travelRequestId: z.uuid(),
    taskType: z.enum(crmTaskTypes),
    title: z.string().trim().min(5).max(120),
    ownerId: z.uuid().nullable(),
    dueAt: evidenceTimestampSchema,
    note: reasonSchema
  }).strict(),
  z.object({
    action: z.literal('crm.task.claim'),
    ...taskPointerSchema
  }).strict(),
  z.object({
    action: z.literal('crm.task.status.set'),
    ...taskPointerSchema,
    nextStatus: z.enum(['IN_PROGRESS', 'DONE']),
    note: reasonSchema
  }).strict(),
  z.object({
    action: z.literal('crm.task.reassign'),
    ...taskPointerSchema,
    ownerId: z.uuid(),
    reason: reasonSchema
  }).strict(),
  z.object({
    action: z.literal('crm.task.cancel'),
    ...taskPointerSchema,
    reason: reasonSchema
  }).strict(),
  z.object({
    action: z.literal('supplier.configuration.create'),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/),
    ...supplierConfigurationSchema
  }).strict(),
  z.object({
    action: z.literal('supplier.configuration.revise'),
    supplierId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    expectedHash: sha256Schema,
    ...supplierConfigurationSchema,
    reason: reasonSchema
  }).strict()
]);

export const crmTaskEventCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('crm-task-event-v1'),
  taskId: z.uuid(),
  travelRequestId: z.uuid(),
  travelRequestVersion: z.number().int().positive(),
  travelRequestHash: sha256Schema,
  customerId: z.uuid(),
  eventVersion: z.number().int().positive(),
  previousEventHash: z.union([sha256Schema, z.literal('')]),
  eventType: z.enum(crmTaskEventTypes),
  taskType: z.enum(crmTaskTypes),
  title: z.string().trim().min(5).max(120),
  ownerId: z.uuid().nullable(),
  status: z.enum(crmTaskStatuses),
  dueAt: evidenceTimestampSchema,
  note: reasonSchema,
  authorityDomainsUnaffected: z.literal(true)
}).strict();

export const supplierConfigurationCanonicalPayloadSchema = z.object({
  schemaVersion: z.literal('supplier-configuration-v1'),
  supplierId: z.uuid(),
  versionNumber: z.number().int().positive(),
  previousVersionHash: z.union([sha256Schema, z.literal('')]),
  code: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/),
  ...supplierConfigurationSchema,
  reason: reasonSchema,
  containsCredentials: z.literal(false)
}).strict();

export type AdministrationCommand = z.infer<typeof administrationCommandSchema>;
export type CrmTaskEventCanonicalPayload = z.infer<typeof crmTaskEventCanonicalPayloadSchema>;
export type SupplierConfigurationCanonicalPayload = z.infer<typeof supplierConfigurationCanonicalPayloadSchema>;

export type AdministrationCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: AdministrationCommand['action'];
  taskId?: string;
  taskStatus?: CrmTaskStatus;
  ownerId?: string | null;
  supplierId?: string;
  versionNumber?: number;
  authorityHash?: string;
};

export type CrmPipelineStage =
  | 'TRAVEL_REQUEST_INTAKE'
  | 'COMMERCIAL_DRAFT'
  | 'COMMERCIAL_APPROVAL'
  | 'PROPOSAL_PUBLISHED'
  | 'CUSTOMER_ACCEPTED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_READY'
  | 'BOOKING_OPERATIONS'
  | 'BOOKING_VERIFICATION'
  | 'VOUCHER_ISSUED';

export type AdministrationPipelineItem = {
  travelRequestId: string;
  customerId: string;
  requestVersion: number;
  requestHash: string;
  requestOwnerId: string | null;
  stage: CrmPipelineStage;
  authorityStatus: string;
  authorityHash: string;
  changedAt: string;
};

export type AdministrationTaskEvent = {
  version: number;
  eventType: CrmTaskEventType;
  note: string;
  actorId: string;
  eventHash: string;
  occurredAt: string;
};

export type AdministrationTask = {
  id: string;
  travelRequestId: string;
  customerId: string;
  requestVersion: number;
  requestHash: string;
  taskType: CrmTaskType;
  title: string;
  ownerId: string | null;
  status: CrmTaskStatus;
  dueAt: string;
  currentVersion: number;
  currentHash: string;
  updatedAt: string;
  events: AdministrationTaskEvent[];
};

export type AdministrationSupplierVersion = {
  versionNumber: number;
  configurationHash: string;
  previousVersionHash: string | null;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type AdministrationSupplier = {
  id: string;
  code: string;
  displayName: string;
  serviceCategory: SupplierServiceCategory;
  operationalChannel: SupplierOperationalChannel;
  status: SupplierConfigurationStatus;
  operationsNote: string;
  currentVersion: number;
  currentHash: string;
  updatedAt: string;
  versions: AdministrationSupplierVersion[];
};

export type AdministrationMembershipPlan = {
  planCode: string;
  audience: 'PERSONAL' | 'CORPORATE';
  displayName: string;
  currency: 'AZN';
  monthlyMinor: number | null;
  annualMinor: number | null;
  pricingModel: 'FIXED' | 'CUSTOM';
  versionNumber: number;
  payloadHash: string;
};

export type AdministrationTeamMember = {
  id: string;
  displayName: string;
  roles: string;
};

export type AdministrationSnapshot = {
  source: 'POSTGRESQL' | 'DEMO' | 'UNAVAILABLE';
  generatedAt: string;
  pipeline: AdministrationPipelineItem[];
  tasks: AdministrationTask[];
  suppliers: AdministrationSupplier[];
  membershipPlans: AdministrationMembershipPlan[];
  team: AdministrationTeamMember[];
  controls: {
    roleAdministration: 'FOUNDER_ACCESS_CONSOLE';
    approvalLimits: 'NOT_CONFIGURED';
    refunds: 'BLOCKED_PENDING_FOUNDER_POLICY';
  };
};
