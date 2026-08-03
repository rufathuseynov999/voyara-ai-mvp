import { randomUUID } from 'node:crypto';

/**
 * Phase 4G — operations automation.
 *
 * Every function in this file classifies, prepares, reminds, or escalates
 * — never confirms a booking, issues a ticket, executes a cancellation or
 * refund, or uses a supplier credential. There is no function anywhere in
 * this file with the shape to do any of those things; the structural test
 * in `operations-automation.test.ts` scans this exact file to prove it.
 *
 * Every "alert"/"reminder"/"escalation" function creates a real,
 * attributable record only (mirroring `scheduled_actions`) — it never
 * contacts a supplier or customer directly.
 */

export type OperationsAlertKind =
  | 'SUPPLIER_RESPONSE_REMINDER' | 'CONTRACT_EXPIRY' | 'BOOKING_DEADLINE' | 'TICKETING_DEADLINE'
  | 'MISSING_CONFIRMATION' | 'TRAVELLER_INFO_INCOMPLETE' | 'DOCUMENT_CHECKLIST' | 'TRANSFER_REMINDER'
  | 'INSURANCE_REMINDER' | 'VISA_DOCUMENT_REMINDER' | 'SERVICE_CHANGE_PREP' | 'DISRUPTION_ESCALATION'
  | 'EMERGENCY_ESCALATION' | 'POST_BOOKING_QUALITY_CHECK';

export type OperationsAlert = {
  alertId: string;
  kind: OperationsAlertKind;
  subjectId: string;
  dueAt: string;
  reasonCode: string;
  correlationId: string;
  createdAt: string;
};

export interface OperationsAutomationStore {
  saveAlert(alert: OperationsAlert): Promise<void>;
  loadAlertsForSubject(subjectId: string): Promise<OperationsAlert[]>;
  reserveAlertKey(key: string): Promise<{ winner: boolean }>;
}

export class InMemoryOperationsAutomationStore implements OperationsAutomationStore {
  private readonly alerts = new Map<string, OperationsAlert[]>();
  private readonly alertKeys = new Set<string>();

  async saveAlert(alert: OperationsAlert): Promise<void> {
    const existing = this.alerts.get(alert.subjectId) ?? [];
    existing.push(alert);
    this.alerts.set(alert.subjectId, existing);
  }
  async loadAlertsForSubject(subjectId: string): Promise<OperationsAlert[]> { return this.alerts.get(subjectId) ?? []; }
  async reserveAlertKey(key: string): Promise<{ winner: boolean }> {
    if (this.alertKeys.has(key)) return { winner: false };
    this.alertKeys.add(key);
    return { winner: true };
  }
}

export type OperationsAutomationContext = { store: OperationsAutomationStore; correlationId: string; now: () => Date };

async function raiseIdempotentAlert(
  ctx: OperationsAutomationContext,
  kind: OperationsAlertKind,
  subjectId: string,
  dueAt: string,
  reasonCode: string,
  idempotencyKey: string
): Promise<{ alertId: string; created: boolean }> {
  const reservation = await ctx.store.reserveAlertKey(idempotencyKey);
  if (!reservation.winner) {
    const existing = await ctx.store.loadAlertsForSubject(subjectId);
    const match = existing.find((a) => a.kind === kind && a.reasonCode === reasonCode);
    return { alertId: match?.alertId ?? '', created: false };
  }
  const alertId = randomUUID();
  await ctx.store.saveAlert({ alertId, kind, subjectId, dueAt, reasonCode, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() });
  return { alertId, created: true };
}

export const raiseSupplierResponseReminder = (ctx: OperationsAutomationContext, supplierTaskId: string, dueAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'SUPPLIER_RESPONSE_REMINDER', supplierTaskId, dueAt, 'AWAITING_SUPPLIER_RESPONSE', idempotencyKey);

export const raiseContractExpiryAlert = (ctx: OperationsAutomationContext, contractId: string, expiresAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'CONTRACT_EXPIRY', contractId, expiresAt, 'CONTRACT_EXPIRING', idempotencyKey);

export const raiseBookingDeadlineAlert = (ctx: OperationsAutomationContext, bookingId: string, deadlineAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'BOOKING_DEADLINE', bookingId, deadlineAt, 'BOOKING_DEADLINE_APPROACHING', idempotencyKey);

export const raiseTicketingDeadlineAlert = (ctx: OperationsAutomationContext, bookingId: string, deadlineAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'TICKETING_DEADLINE', bookingId, deadlineAt, 'TICKETING_DEADLINE_APPROACHING', idempotencyKey);

export const raiseMissingConfirmationEscalation = (ctx: OperationsAutomationContext, supplierTaskId: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'MISSING_CONFIRMATION', supplierTaskId, ctx.now().toISOString(), 'SUPPLIER_CONFIRMATION_MISSING', idempotencyKey);

export function classifyTravellerInfoCompleteness(input: { hasPassportNumber: boolean; hasPassportExpiry: boolean; hasDateOfBirth: boolean; hasEmergencyContact: boolean }): { complete: boolean; missingFields: string[] } {
  const missingFields: string[] = [];
  if (!input.hasPassportNumber) missingFields.push('passportNumber');
  if (!input.hasPassportExpiry) missingFields.push('passportExpiry');
  if (!input.hasDateOfBirth) missingFields.push('dateOfBirth');
  if (!input.hasEmergencyContact) missingFields.push('emergencyContact');
  return { complete: missingFields.length === 0, missingFields };
}

export const raiseDocumentChecklistAlert = (ctx: OperationsAutomationContext, bookingId: string, missingDocument: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'DOCUMENT_CHECKLIST', bookingId, ctx.now().toISOString(), `MISSING_DOCUMENT_${missingDocument.toUpperCase()}`, idempotencyKey);

export const raiseTransferReminder = (ctx: OperationsAutomationContext, tripRoomId: string, dueAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'TRANSFER_REMINDER', tripRoomId, dueAt, 'TRANSFER_ARRANGEMENT_DUE', idempotencyKey);

export const raiseInsuranceReminder = (ctx: OperationsAutomationContext, bookingId: string, dueAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'INSURANCE_REMINDER', bookingId, dueAt, 'INSURANCE_NOT_ON_FILE', idempotencyKey);

export const raiseVisaDocumentReminder = (ctx: OperationsAutomationContext, bookingId: string, dueAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'VISA_DOCUMENT_REMINDER', bookingId, dueAt, 'VISA_DOCUMENT_NOT_ON_FILE', idempotencyKey);

export const prepareServiceChange = (ctx: OperationsAutomationContext, bookingId: string, changeDescription: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'SERVICE_CHANGE_PREP', bookingId, ctx.now().toISOString(), `SERVICE_CHANGE_REQUESTED: ${changeDescription}`, idempotencyKey);

export const raiseDisruptionEscalation = (ctx: OperationsAutomationContext, bookingId: string, disruptionReason: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'DISRUPTION_ESCALATION', bookingId, ctx.now().toISOString(), disruptionReason, idempotencyKey);

export async function raiseEmergencyEscalation(ctx: OperationsAutomationContext, bookingId: string, emergencyReason: string): Promise<{ alertId: string }> {
  const alertId = randomUUID();
  await ctx.store.saveAlert({ alertId, kind: 'EMERGENCY_ESCALATION', subjectId: bookingId, dueAt: ctx.now().toISOString(), reasonCode: emergencyReason, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() });
  return { alertId };
}

export const raisePostBookingQualityCheck = (ctx: OperationsAutomationContext, bookingId: string, dueAt: string, idempotencyKey: string) =>
  raiseIdempotentAlert(ctx, 'POST_BOOKING_QUALITY_CHECK', bookingId, dueAt, 'POST_BOOKING_QUALITY_CHECK_DUE', idempotencyKey);
