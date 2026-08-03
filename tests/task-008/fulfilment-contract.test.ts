import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCommandAuthority, AuthorityError } from '../../src/server/bos/authority';
import { sha256 } from '../../src/server/bos/canonical-json';
import {
  buildCanonicalBookingVerificationPayload,
  buildCanonicalSupplierConfirmationCorrectionPayload,
  buildCanonicalVoucherPayload,
  staffFulfilmentCommandSchema
} from '../../src/server/fulfilment/contract';

const bookingId = 'b1000000-0000-4000-8000-000000000001';
const executionId = 'b1000000-0000-4000-8000-000000000002';
const confirmationId = 'b1000000-0000-4000-8000-000000000003';
const reviewId = 'b1000000-0000-4000-8000-000000000004';
const verificationId = 'b1000000-0000-4000-8000-000000000005';
const voucherId = 'b1000000-0000-4000-8000-000000000006';
const quotationId = 'b1000000-0000-4000-8000-000000000007';
const bookingHash = '1'.repeat(64);
const executionHash = '2'.repeat(64);
const confirmationHash = '3'.repeat(64);
const verificationHash = '4'.repeat(64);
const quotationHash = '5'.repeat(64);

test('Booking Verification canonical evidence binds exact Booking, execution and Supplier Confirmation', () => {
  const payload = buildCanonicalBookingVerificationPayload({
    bookingId,
    bookingAuthorityHash: bookingHash,
    reviewId,
    executionId,
    executionHash,
    supplierConfirmationId: confirmationId,
    supplierConfirmationVersion: 2,
    supplierConfirmationHash: confirmationHash,
    verification: {
      decision: 'VERIFY',
      reason: 'Every exact synthetic field was independently checked',
      checks: {
        customerDetailsMatch: true,
        datesAndServicesMatch: true,
        supplierReferenceValidated: true,
        priceAndTermsMatch: true
      },
      declarationConfirmed: true
    }
  });
  assert.equal(payload.schemaVersion, 'booking-verification-v1');
  assert.equal(payload.supplierConfirmationVersion, 2);
  assert.equal(payload.decision, 'VERIFY');
  assert.equal(sha256(payload), sha256({ ...payload }));
});

test('Verification schemas reject false checks for VERIFY and all-passing checks for REJECT', () => {
  const base = {
    action: 'booking.verify', bookingId, reviewId, executionId, executionHash,
    supplierConfirmationId: confirmationId, supplierConfirmationVersion: 1,
    supplierConfirmationHash: confirmationHash,
    verification: {
      decision: 'VERIFY', reason: 'Exact evidence reviewed and accepted',
      checks: {
        customerDetailsMatch: true, datesAndServicesMatch: true,
        supplierReferenceValidated: true, priceAndTermsMatch: true
      },
      declarationConfirmed: true
    }
  } as const;
  assert.equal(staffFulfilmentCommandSchema.safeParse(base).success, true);
  assert.equal(staffFulfilmentCommandSchema.safeParse({
    ...base,
    verification: {
      ...base.verification,
      checks: { ...base.verification.checks, supplierReferenceValidated: false }
    }
  }).success, false);
  assert.equal(staffFulfilmentCommandSchema.safeParse({
    ...base,
    verification: { ...base.verification, decision: 'REJECT' }
  }).success, false);
});

test('correction evidence supersedes rejected evidence without editing it', () => {
  const payload = buildCanonicalSupplierConfirmationCorrectionPayload({
    bookingId,
    executionId,
    executionHash,
    supersedesConfirmationId: confirmationId,
    supersedesConfirmationHash: confirmationHash,
    rejectedVerificationId: verificationId,
    rejectedVerificationHash: verificationHash,
    supplierName: ' Synthetic Supplier ',
    confirmation: {
      channel: 'EMAIL',
      confirmedAt: '2026-07-17T15:30:00+04:00',
      confirmationReference: ' CORRECTED-001 ',
      serviceSummary: ' Corrected exact synthetic Supplier services ',
      note: ' Append-only correction ',
      declarationConfirmed: true
    }
  });
  assert.equal(payload.confirmedAt, '2026-07-17T11:30:00.000Z');
  assert.equal(payload.supersedesConfirmationId, confirmationId);
  assert.equal(payload.rejectedVerificationId, verificationId);
  assert.equal(payload.supplierName, 'Synthetic Supplier');
});

test('Voucher version is exact-evidence-bound and may record AI assistance without granting AI issue authority', () => {
  const payload = buildCanonicalVoucherPayload({
    voucherId,
    versionNumber: 1,
    bookingId,
    bookingAuthorityHash: bookingHash,
    verificationId,
    verificationHash,
    executionId,
    executionHash,
    supplierConfirmationId: confirmationId,
    supplierConfirmationVersion: 2,
    supplierConfirmationHash: confirmationHash,
    quotationId,
    quotationVersion: 1,
    quotationHash,
    locale: 'az',
    supplier: {
      name: 'Synthetic Supplier',
      confirmationReference: 'CONF-001',
      confirmationSummary: 'Exact synthetic services confirmed.'
    },
    trip: { title: 'İstanbul səfəri', summary: 'Sintetik səyahət təklifi.' },
    content: {
      services: [{
        sequence: 1, category: 'HOTEL', title: 'Synthetic hotel',
        details: 'Seven synthetic nights.', serviceDate: '2026-09-10',
        customerReference: 'CONF-001'
      }],
      supportContact: 'Synthetic VOYARA support',
      customerNotes: 'No Production Customer data.',
      preparationSource: 'AI_ASSISTED',
      declarationConfirmed: true
    }
  });
  assert.equal(payload.preparationSource, 'AI_ASSISTED');
  assert.equal(payload.verificationHash, verificationHash);
  assert.equal(payload.services.length, 1);
});

test('AI cannot verify a Booking or issue a Voucher', () => {
  for (const commandName of ['booking.verify', 'voucher.issue']) {
    assert.throws(() => assertCommandAuthority({
      commandId: crypto.randomUUID(),
      idempotencyKey: `task008-${commandName}`,
      commandName,
      requestedAt: new Date().toISOString(),
      actor: {
        id: 'b1000000-0000-4000-8000-000000000099',
        kind: 'ai_agent',
        roles: ['manager']
      },
      payload: {}
    }), AuthorityError);
  }
});
