import { z } from 'zod';
import { locales } from '@/i18n/config';

export const travelRequestStatuses = ['DRAFT', 'SUBMITTED', 'AI_PREPARATION', 'HUMAN_REVIEW'] as const;
export type TravelRequestStatus = (typeof travelRequestStatuses)[number];

export const tripPurposes = ['leisure', 'business', 'family', 'honeymoon', 'wellness', 'adventure', 'other'] as const;
export type TripPurpose = (typeof tripPurposes)[number];

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z.string().refine(isIsoDate);

const acknowledgementSchema = z.object({
  accuracyConfirmed: z.boolean(),
  dataProcessingAcknowledged: z.boolean()
}).strict();

export const travelRequestContentSchema = z.object({
  destination: z.string().trim().min(2).max(120),
  departureCity: z.string().trim().min(2).max(120),
  departureDate: isoDateSchema,
  returnDate: isoDateSchema,
  travelers: z.object({
    adults: z.coerce.number().int().min(1).max(12),
    children: z.coerce.number().int().min(0).max(8),
    infants: z.coerce.number().int().min(0).max(4)
  }).strict(),
  budgetAzn: z.coerce.number().int().min(100).max(1_000_000),
  tripPurpose: z.enum(tripPurposes),
  notes: z.string().trim().max(2_000),
  locale: z.enum(locales),
  submissionAcknowledgements: acknowledgementSchema
}).strict().superRefine((content, context) => {
  if (content.returnDate < content.departureDate) {
    context.addIssue({ code: 'custom', path: ['returnDate'], message: 'RETURN_DATE_PRECEDES_DEPARTURE' });
  }
});

const baseCustomerCommand = {
  requestId: z.uuid().optional(),
  content: travelRequestContentSchema
};

export const customerTravelRequestCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('travel_request.save_draft'),
    ...baseCustomerCommand
  }).strict(),
  z.object({
    action: z.literal('travel_request.submit'),
    ...baseCustomerCommand
  }).strict().superRefine((command, context) => {
    if (!command.content.submissionAcknowledgements.accuracyConfirmed) {
      context.addIssue({ code: 'custom', path: ['content', 'submissionAcknowledgements', 'accuracyConfirmed'], message: 'ACCURACY_CONFIRMATION_REQUIRED' });
    }
    if (!command.content.submissionAcknowledgements.dataProcessingAcknowledged) {
      context.addIssue({ code: 'custom', path: ['content', 'submissionAcknowledgements', 'dataProcessingAcknowledged'], message: 'DATA_PROCESSING_ACKNOWLEDGEMENT_REQUIRED' });
    }
  })
]);

export const staffTravelRequestCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('travel_request.claim'), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal('travel_request.start_ai_preparation'), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal('travel_request.start_human_review'), requestId: z.uuid() }).strict()
]);

export type TravelRequestContent = z.infer<typeof travelRequestContentSchema>;
export type CustomerTravelRequestCommand = z.infer<typeof customerTravelRequestCommandSchema>;
export type StaffTravelRequestCommand = z.infer<typeof staffTravelRequestCommandSchema>;
export type TravelRequestCommand = CustomerTravelRequestCommand | StaffTravelRequestCommand;

export type TravelRequestCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: string;
  requestId?: string;
  requestStatus?: TravelRequestStatus;
  versionNumber?: number;
  payloadHash?: string;
  assignedStaffId?: string;
};

export type CustomerTravelRequestSummary = {
  id: string;
  status: TravelRequestStatus;
  currentVersion: number;
  submittedAt: string | null;
  updatedAt: string;
};

export type StaffTravelRequestQueueItem = CustomerTravelRequestSummary & {
  customerId: string;
  assignedStaffId: string | null;
  destination: string;
  departureCity: string;
  departureDate: string;
  returnDate: string;
  travelers: TravelRequestContent['travelers'];
  budgetAzn: number;
  tripPurpose: TripPurpose;
  notes: string;
  locale: TravelRequestContent['locale'];
  payloadHash: string;
};
