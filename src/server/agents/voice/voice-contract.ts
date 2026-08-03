import { z } from 'zod';

/**
 * Phase 4D — voice call contract.
 *
 * Mirrors the exact discipline already proven for WhatsApp (Phase 4C) and
 * message risk classification: `voiceLowRiskIntents` is a closed enum
 * covering only the founder-listed informational categories (extended with
 * voice-specific ones: operating-hours/service-info, status
 * acknowledgement); nothing resembling a sensitive action — final price,
 * proposal approval, supplier commitment, payment, booking, ticketing,
 * change, cancellation, refund, liability complaint, medical/legal/
 * emergency claim, or exceptional promise — has any representation in this
 * type. The voice layer reuses `sendLowRiskMessage`'s policy-gated
 * discipline unchanged (see `voice-call-service.ts`); it does not invent a
 * parallel, less-controlled path.
 */

export const callStatuses = ['STARTED', 'RINGING', 'ANSWERED', 'TRANSFERRED', 'COMPLETED', 'FAILED'] as const;
export type CallStatus = (typeof callStatuses)[number];

export const callUrgencies = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type CallUrgency = (typeof callUrgencies)[number];

export const consentStatuses = ['GRANTED', 'DECLINED', 'NOT_ASKED'] as const;
export type ConsentStatus = (typeof consentStatuses)[number];

export const callLanguages = ['az', 'ru', 'en'] as const;
export type CallLanguage = (typeof callLanguages)[number];

/** Voice-specific low-risk intents — a strict superset is never used; this
 *  is its own closed list (not a re-export of the chat one) because voice
 *  has categories chat doesn't (operating-hours/service-info) and excludes
 *  none the founder listed for voice. */
export const voiceLowRiskIntents = [
  'GREETING', 'FAQ', 'LEAD_QUALIFICATION', 'COLLECT_TRIP_DETAILS',
  'MEMBERSHIP_EXPLANATION', 'CALLBACK_SCHEDULING', 'OPERATING_HOURS_INFO', 'STATUS_ACKNOWLEDGEMENT'
] as const;
export type VoiceLowRiskIntent = (typeof voiceLowRiskIntents)[number];

/** Sensitive voice actions — listed here ONLY as an enum of things that must
 *  escalate to a human; there is no function anywhere in the voice layer
 *  that accepts one of these as authorization to actually do the thing. */
export const voiceSensitiveActionKinds = [
  'FINAL_PRICE_OR_DISCOUNT', 'PROPOSAL_APPROVAL', 'SUPPLIER_AVAILABILITY_COMMITMENT',
  'PAYMENT_LINK', 'BOOKING', 'TICKET_ISSUANCE', 'CHANGE', 'CANCELLATION', 'REFUND',
  'LIABILITY_COMPLAINT', 'MEDICAL_LEGAL_EMERGENCY_CLAIM', 'EXCEPTIONAL_PROMISE'
] as const;
export type VoiceSensitiveActionKind = (typeof voiceSensitiveActionKinds)[number];

export const consentSchema = z.object({
  aiDisclosure: z.enum(consentStatuses),
  recording: z.enum(consentStatuses),
  transcription: z.enum(consentStatuses),
  crmStorage: z.enum(consentStatuses),
  followUp: z.enum(consentStatuses)
}).strict();
export type CallConsent = z.infer<typeof consentSchema>;

export const callSchema = z.object({
  callId: z.uuid(),
  conversationId: z.uuid(),
  contactId: z.uuid(),
  voiceNumberId: z.uuid().nullable(),
  brand: z.enum(['RTRAVEL', 'VOYARA']),
  calledNumber: z.string().min(1),
  callerNumber: z.string().min(1),
  status: z.enum(callStatuses),
  detectedLanguage: z.enum(callLanguages).nullable(),
  durationSeconds: z.number().int().min(0).nullable(),
  transcript: z.string().nullable(),
  aiSummary: z.string().nullable(),
  urgency: z.enum(callUrgencies).nullable(),
  transferStatus: z.string().nullable(),
  assignedOwnerId: z.uuid().nullable(),
  handoverStatus: z.enum(['AI', 'HUMAN']),
  consent: consentSchema,
  recordingEnabled: z.boolean(),
  modelTier: z.enum(['CHEAP', 'STRONG']).nullable(),
  modelName: z.string().nullable(),
  estimatedCostMinorUnits: z.number().int().min(0).nullable(),
  durationCeilingSeconds: z.number().int().positive().nullable(),
  correlationId: z.string().min(1).max(128),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable()
}).strict();
export type Call = z.infer<typeof callSchema>;

export class VoiceAuthorityError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'VALIDATION' | 'NOT_FOUND' | 'CONSENT_REQUIRED' | 'DURATION_CEILING_EXCEEDED'
      | 'SPENDING_CEILING_EXCEEDED' | 'INVALID_SIGNATURE' | 'CREDENTIALS_MISSING' | 'LIVE_NOT_AVAILABLE'
  ) {
    super(message);
    this.name = 'VoiceAuthorityError';
  }
}
