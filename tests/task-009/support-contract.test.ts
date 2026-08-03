import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCommandAuthority, AuthorityError } from '../../src/server/bos/authority';
import { sha256 } from '../../src/server/bos/canonical-json';
import {
  buildCanonicalSupportCaseEventPayload,
  buildCanonicalSupportCaseOpenPayload,
  customerSupportCommandSchema,
  staffSupportCommandSchema
} from '../../src/server/support/contract';

const caseId = 'c9000000-0000-4000-8000-000000000001';
const bookingId = 'c9000000-0000-4000-8000-000000000002';
const voucherId = 'c9000000-0000-4000-8000-000000000003';
const customerId = 'c9000000-0000-4000-8000-000000000004';
const caseHash = 'a'.repeat(64);

test('Support case canonical evidence binds the exact issued Voucher and Customer', () => {
  const payload = buildCanonicalSupportCaseOpenPayload({
    caseId,
    bookingId,
    voucherId,
    voucherVersion: 2,
    voucherHash: 'b'.repeat(64),
    customerId,
    locale: 'az',
    category: 'TRAVEL_DISRUPTION',
    urgency: 'URGENT',
    subject: ' Uçuş gecikməsi ',
    message: ' Təchizatçı uçuşun gecikdiyini bildirdi. ',
    declarationConfirmed: true
  });
  assert.equal(payload.schemaVersion, 'support-case-open-v1');
  assert.equal(payload.subject, 'Uçuş gecikməsi');
  assert.equal(payload.voucherVersion, 2);
  assert.equal(payload.customerId, customerId);
  assert.equal(sha256(payload), sha256({ ...payload }));
});

test('Every Support event is linked to the case authority and previous event hash', () => {
  const payload = buildCanonicalSupportCaseEventPayload({
    caseId,
    caseAuthorityHash: caseHash,
    eventSequence: 2,
    previousEventHash: caseHash,
    eventType: 'CUSTOMER_UPDATE',
    visibility: 'CUSTOMER',
    message: 'VOYARA əməliyyatları Təchizatçı ilə vəziyyəti yoxlayır.',
    nextStatus: 'IN_PROGRESS'
  });
  assert.equal(payload.schemaVersion, 'support-case-event-v1');
  assert.equal(payload.eventSequence, 2);
  assert.equal(payload.previousEventHash, caseHash);
  assert.equal(payload.financialAuthorityUnaffected, true);
  assert.equal(payload.priority, '');
});

test('Customer Support schemas require an exact Booking and explicit declaration', () => {
  const valid = {
    action: 'support.case.open',
    bookingId,
    category: 'DOCUMENT_OR_VOUCHER',
    urgency: 'NORMAL',
    subject: 'Vauçer sualı',
    message: 'Verilmiş Vauçerdəki istinadı dəqiqləşdirin.',
    declarationConfirmed: true
  } as const;
  assert.equal(customerSupportCommandSchema.safeParse(valid).success, true);
  assert.equal(customerSupportCommandSchema.safeParse({ ...valid, declarationConfirmed: false }).success, false);
  assert.equal(customerSupportCommandSchema.safeParse({ ...valid, bookingId: 'not-a-uuid' }).success, false);
  assert.equal(customerSupportCommandSchema.safeParse({ ...valid, unexpected: 'field' }).success, false);
});

test('Staff resolution and closure require explicit financial-authority separation', () => {
  const valid = {
    action: 'support.case.resolve',
    caseId,
    resolution: 'Müştəriyə dəqiq status təqdim edildi və sorğu cavablandırıldı.',
    financialAuthorityUnaffectedConfirmed: true
  } as const;
  assert.equal(staffSupportCommandSchema.safeParse(valid).success, true);
  assert.equal(staffSupportCommandSchema.safeParse({
    ...valid,
    financialAuthorityUnaffectedConfirmed: false
  }).success, false);
  assert.equal(staffSupportCommandSchema.safeParse({
    action: 'support.case.escalate',
    caseId,
    targetLevel: 'FOUNDER',
    reason: 'Material Customer disruption requires accountable Founder visibility.'
  }).success, true);
});

test('AI cannot claim, resolve, close or escalate a Support case', () => {
  for (const commandName of [
    'support.case.claim',
    'support.case.escalate',
    'support.case.resolve',
    'support.case.close'
  ]) {
    assert.throws(() => assertCommandAuthority({
      commandId: crypto.randomUUID(),
      idempotencyKey: `task009-${commandName}`,
      commandName,
      requestedAt: new Date().toISOString(),
      actor: {
        id: 'c9000000-0000-4000-8000-000000000099',
        kind: 'ai_agent',
        roles: ['manager']
      },
      payload: {}
    }), AuthorityError);
  }
});
