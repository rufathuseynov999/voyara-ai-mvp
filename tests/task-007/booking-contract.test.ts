import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../../src/server/bos/canonical-json';
import { assertCommandAuthority, AuthorityError } from '../../src/server/bos/authority';
import {
  buildCanonicalBookingCreationPayload,
  buildCanonicalSupplierConfirmationPayload,
  buildCanonicalSupplierExecutionPayload,
  staffBookingCommandSchema
} from '../../src/server/booking/contract';

const paymentRequestId = '91000000-0000-4000-8000-000000000001';
const readinessEvaluationId = '91000000-0000-4000-8000-000000000002';
const acceptanceId = '91000000-0000-4000-8000-000000000003';
const quotationId = '91000000-0000-4000-8000-000000000004';
const bookingId = '91000000-0000-4000-8000-000000000005';
const executionId = '91000000-0000-4000-8000-000000000006';
const readinessHash = 'a'.repeat(64);
const quotationHash = 'b'.repeat(64);
const executionHash = 'c'.repeat(64);

test('Booking creation binds exact Acceptance, quotation and financial-readiness evidence', () => {
  const payload = buildCanonicalBookingCreationPayload({
    paymentRequestId,
    readinessEvaluationId,
    readinessHash,
    acceptanceId,
    quotationId,
    quotationVersion: 3,
    quotationHash
  });
  assert.deepEqual(payload, {
    schemaVersion: 'booking-creation-v1',
    paymentRequestId,
    readinessEvaluationId,
    readinessHash,
    acceptanceId,
    quotationId,
    quotationVersion: 3,
    quotationHash
  });
  assert.equal(sha256(payload), sha256({
    quotationHash,
    quotationVersion: 3,
    quotationId,
    acceptanceId,
    readinessHash,
    readinessEvaluationId,
    paymentRequestId,
    schemaVersion: 'booking-creation-v1'
  }));
});

test('Supplier execution and Supplier Confirmation are distinct canonical records', () => {
  const execution = buildCanonicalSupplierExecutionPayload(bookingId, {
    channel: 'SUPPLIER_PORTAL',
    supplierName: ' Synthetic Supplier ',
    executedAt: '2026-07-17T18:00:00+04:00',
    requestReference: ' SUP-REQ-001 ',
    serviceSummary: ' Exact flight and hotel services submitted ',
    note: ' Human action only ',
    declarationConfirmed: true
  });
  assert.equal(execution.executedAt, '2026-07-17T14:00:00.000Z');
  assert.equal(execution.supplierName, 'Synthetic Supplier');

  const confirmation = buildCanonicalSupplierConfirmationPayload({
    bookingId,
    executionId,
    executionHash,
    supplierName: execution.supplierName,
    confirmation: {
      channel: 'EMAIL',
      confirmedAt: '2026-07-17T18:15:00+04:00',
      confirmationReference: ' CONF-001 ',
      serviceSummary: ' Exact services confirmed by Supplier ',
      note: ' Awaiting separate Booking Verification ',
      declarationConfirmed: true
    }
  });
  assert.equal(confirmation.executionId, executionId);
  assert.equal(confirmation.executionHash, executionHash);
  assert.equal(confirmation.supplierName, execution.supplierName);
  assert.notEqual(sha256(execution), sha256(confirmation));
});

test('Booking command schemas reject unknown authority and missing declarations', () => {
  const valid = {
    action: 'supplier_booking.complete',
    bookingId,
    execution: {
      channel: 'PHONE',
      supplierName: 'Synthetic Supplier',
      executedAt: '2026-07-17T14:00:00.000Z',
      requestReference: 'SUP-REQ-001',
      serviceSummary: 'Exact services requested',
      note: '',
      declarationConfirmed: true
    }
  } as const;
  assert.equal(staffBookingCommandSchema.safeParse(valid).success, true);
  assert.equal(staffBookingCommandSchema.safeParse({
    ...valid,
    execution: { ...valid.execution, declarationConfirmed: false }
  }).success, false);
  assert.equal(staffBookingCommandSchema.safeParse({ ...valid, bookingVerified: true }).success, false);
  assert.equal(staffBookingCommandSchema.safeParse({
    action: 'booking.verify',
    bookingId
  }).success, false);
});

test('AI cannot create a Booking, execute Supplier booking or capture Supplier Confirmation', () => {
  for (const commandName of [
    'booking.create',
    'supplier_booking.complete',
    'supplier_confirmation.capture'
  ]) {
    assert.throws(() => assertCommandAuthority({
      commandId: crypto.randomUUID(),
      idempotencyKey: `task007-${commandName}`,
      commandName,
      requestedAt: new Date().toISOString(),
      actor: {
        id: '91000000-0000-4000-8000-000000000099',
        kind: 'ai_agent',
        roles: ['staff']
      },
      payload: {}
    }), AuthorityError);
  }
});
