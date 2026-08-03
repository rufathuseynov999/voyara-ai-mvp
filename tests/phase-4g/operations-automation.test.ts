import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  raiseSupplierResponseReminder, raiseContractExpiryAlert, raiseBookingDeadlineAlert, raiseTicketingDeadlineAlert,
  raiseMissingConfirmationEscalation, classifyTravellerInfoCompleteness, raiseDocumentChecklistAlert, raiseTransferReminder,
  raiseInsuranceReminder, raiseVisaDocumentReminder, prepareServiceChange, raiseDisruptionEscalation,
  raiseEmergencyEscalation, raisePostBookingQualityCheck, InMemoryOperationsAutomationStore, type OperationsAutomationContext
} from '@/server/agents/automation/operations-automation';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): OperationsAutomationContext & { store: InMemoryOperationsAutomationStore } {
  return { store: new InMemoryOperationsAutomationStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

test('raiseSupplierResponseReminder creates a real, idempotent alert', async () => {
  const c = ctx();
  const subject = randomUUID();
  const first = await raiseSupplierResponseReminder(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  assert.equal(first.created, true);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts[0].kind, 'SUPPLIER_RESPONSE_REMINDER');
});

test('raiseContractExpiryAlert creates a real, idempotent alert', async () => {
  const c = ctx();
  const subject = randomUUID();
  await raiseContractExpiryAlert(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts[0].kind, 'CONTRACT_EXPIRY');
});

test('raiseBookingDeadlineAlert and raiseTicketingDeadlineAlert both create distinct alert kinds', async () => {
  const c = ctx();
  const subject = randomUUID();
  await raiseBookingDeadlineAlert(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  await raiseTicketingDeadlineAlert(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.deepEqual(alerts.map((a) => a.kind).sort(), ['BOOKING_DEADLINE', 'TICKETING_DEADLINE']);
});

test('raiseMissingConfirmationEscalation creates a real alert', async () => {
  const c = ctx();
  const subject = randomUUID();
  await raiseMissingConfirmationEscalation(c, subject, `idem-${randomUUID()}`);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts[0].kind, 'MISSING_CONFIRMATION');
});

test('raiseDocumentChecklistAlert, raiseTransferReminder, raiseInsuranceReminder, raiseVisaDocumentReminder all create their own distinct kinds', async () => {
  const c = ctx();
  const subject = randomUUID();
  await raiseDocumentChecklistAlert(c, subject, 'passport', `idem-${randomUUID()}`);
  await raiseTransferReminder(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  await raiseInsuranceReminder(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  await raiseVisaDocumentReminder(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.deepEqual(alerts.map((a) => a.kind).sort(), ['DOCUMENT_CHECKLIST', 'INSURANCE_REMINDER', 'TRANSFER_REMINDER', 'VISA_DOCUMENT_REMINDER']);
});

test('prepareServiceChange creates a preparation record only, never applies the change itself', async () => {
  const c = ctx();
  const subject = randomUUID();
  const result = await prepareServiceChange(c, subject, 'change hotel room type', `idem-${randomUUID()}`);
  assert.equal(result.created, true);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts[0].kind, 'SERVICE_CHANGE_PREP');
  assert.ok(alerts[0].reasonCode.includes('change hotel room type'));
});

test('raiseDisruptionEscalation creates a real alert', async () => {
  const c = ctx();
  const subject = randomUUID();
  await raiseDisruptionEscalation(c, subject, 'FLIGHT_CANCELLED', `idem-${randomUUID()}`);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts[0].kind, 'DISRUPTION_ESCALATION');
});

test('raisePostBookingQualityCheck creates a real alert', async () => {
  const c = ctx();
  const subject = randomUUID();
  await raisePostBookingQualityCheck(c, subject, FIXED.toISOString(), `idem-${randomUUID()}`);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts[0].kind, 'POST_BOOKING_QUALITY_CHECK');
});

test('a retried alert-raising call with the same idempotency key never creates a duplicate', async () => {
  const c = ctx();
  const subject = randomUUID();
  const key = `idem-${randomUUID()}`;
  const first = await raiseContractExpiryAlert(c, subject, FIXED.toISOString(), key);
  const second = await raiseContractExpiryAlert(c, subject, FIXED.toISOString(), key);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts.length, 1);
});

test('raiseEmergencyEscalation always creates a fresh alert, even for the identical reason twice — a real second emergency is never silently dropped', async () => {
  const c = ctx();
  const subject = randomUUID();
  const first = await raiseEmergencyEscalation(c, subject, 'MEDICAL_EMERGENCY');
  const second = await raiseEmergencyEscalation(c, subject, 'MEDICAL_EMERGENCY');
  assert.notEqual(first.alertId, second.alertId);
  const alerts = await c.store.loadAlertsForSubject(subject);
  assert.equal(alerts.length, 2);
});

test('classifyTravellerInfoCompleteness correctly identifies exactly which fields are missing', () => {
  const result = classifyTravellerInfoCompleteness({ hasPassportNumber: true, hasPassportExpiry: false, hasDateOfBirth: true, hasEmergencyContact: false });
  assert.equal(result.complete, false);
  assert.deepEqual(result.missingFields, ['passportExpiry', 'emergencyContact']);
});

test('classifyTravellerInfoCompleteness reports complete when every real field is present', () => {
  const result = classifyTravellerInfoCompleteness({ hasPassportNumber: true, hasPassportExpiry: true, hasDateOfBirth: true, hasEmergencyContact: true });
  assert.equal(result.complete, true);
  assert.deepEqual(result.missingFields, []);
});

test('operations-automation.ts contains no function that could confirm a booking, issue a ticket, cancel, or refund', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/operations-automation.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/function\s+\w*(confirmBooking|issueTicket|cancelBooking|executeRefund|voidTicket|reissueTicket)/i.test(codeOnly));
});

test('operations-automation.ts contains no CODE reference to a supplier password, portal credential, or login secret (comments describing the prohibition are expected and excluded)', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/operations-automation.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/password|credential|supplierLogin|portalSecret/i.test(codeOnly));
});

test('operations-automation.ts contains no hardcoded availability, price, or contract-term literal that could be mistaken for fabricated supplier data', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/operations-automation.ts', import.meta.url), 'utf8');
  assert.ok(!/availability\s*:\s*(true|false|\d)/i.test(raw));
  assert.ok(!/priceMinorUnits\s*:\s*\d/i.test(raw));
});
