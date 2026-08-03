import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../../src/server/bos/canonical-json';
import { assertCommandAuthority, AuthorityError } from '../../src/server/bos/authority';
import {
  buildCanonicalFundsAllocationPayload,
  buildCanonicalPaymentEvidencePayload,
  buildCanonicalPaymentVerificationPayload,
  buildCanonicalReadinessInputPayload,
  customerPaymentCommandSchema,
  staffPaymentCommandSchema
} from '../../src/server/payment/contract';

const paymentRequestId = '81000000-0000-4000-8000-000000000001';
const evidenceId = '81000000-0000-4000-8000-000000000002';
const verificationId = '81000000-0000-4000-8000-000000000003';
const allocationId = '81000000-0000-4000-8000-000000000004';
const evidenceHash = 'a'.repeat(64);
const verificationHash = 'b'.repeat(64);
const allocationHash = 'c'.repeat(64);

test('manual Payment evidence uses exact minor units and stable canonical SHA-256', () => {
  const payload = buildCanonicalPaymentEvidencePayload(
    paymentRequestId,
    'CUSTOMER_EVIDENCE',
    'BANK_TRANSFER_REFERENCE',
    {
      amountAzn: '5050.25',
      observedAt: '2026-07-17T10:15:00+04:00',
      externalReference: 'BANK-REF-001',
      note: 'Synthetic evidence only',
      declarationConfirmed: true
    }
  );
  assert.equal(payload.amountMinor, 505_025);
  assert.equal(payload.observedAt, '2026-07-17T06:15:00.000Z');
  assert.equal(payload.sourceKind, 'CUSTOMER_EVIDENCE');
  assert.equal(sha256(payload), sha256({
    note: 'Synthetic evidence only',
    channel: 'BANK_TRANSFER_REFERENCE',
    schemaVersion: 'payment-evidence-v1',
    paymentRequestId,
    sourceKind: 'CUSTOMER_EVIDENCE',
    currency: 'AZN',
    declarationConfirmed: true,
    externalReference: 'BANK-REF-001',
    observedAt: '2026-07-17T06:15:00.000Z',
    amountMinor: 505_025
  }));
});

test('evidence commands require an explicit declaration, constrained channels and no unknown fields', () => {
  const base = {
    action: 'payment.evidence.submit',
    paymentRequestId,
    channel: 'BANK_TRANSFER_REFERENCE',
    evidence: {
      amountAzn: '5050.00',
      observedAt: '2026-07-17T06:15:00.000Z',
      externalReference: 'BANK-REF-001',
      note: '',
      declarationConfirmed: true
    }
  } as const;
  assert.equal(customerPaymentCommandSchema.safeParse(base).success, true);
  assert.equal(customerPaymentCommandSchema.safeParse({
    ...base,
    evidence: { ...base.evidence, declarationConfirmed: false }
  }).success, false);
  assert.equal(customerPaymentCommandSchema.safeParse({
    ...base,
    channel: 'ACQUIRER_DASHBOARD'
  }).success, false);
  assert.equal(customerPaymentCommandSchema.safeParse({ ...base, providerVerified: true }).success, false);
});

test('Verification, allocation and readiness remain three exact commands and payloads', () => {
  const verification = buildCanonicalPaymentVerificationPayload({
    paymentRequestId,
    evidenceId,
    evidenceHash,
    decision: 'VERIFY',
    reason: '  Bank statement and exact amount checked  '
  });
  assert.equal(verification.reason, 'Bank statement and exact amount checked');

  const allocation = buildCanonicalFundsAllocationPayload({
    paymentRequestId,
    verificationId,
    verificationHash,
    amountMinor: 505_000
  });
  assert.deepEqual(allocation, {
    schemaVersion: 'funds-allocation-v1',
    paymentRequestId,
    verificationId,
    verificationHash,
    currency: 'AZN',
    amountMinor: 505_000
  });

  const readiness = buildCanonicalReadinessInputPayload({
    paymentRequestId,
    allocationId,
    allocationHash
  });
  assert.equal(readiness.schemaVersion, 'financial-readiness-input-v1');
  assert.notEqual(sha256(verification), sha256(allocation));
  assert.notEqual(sha256(allocation), sha256(readiness));

  assert.equal(staffPaymentCommandSchema.safeParse({
    action: 'payment.verify',
    paymentRequestId,
    evidenceId,
    evidenceHash,
    decision: 'VERIFY',
    reason: 'Human Finance verified exact evidence'
  }).success, true);
  assert.equal(staffPaymentCommandSchema.safeParse({
    action: 'funds.allocate',
    paymentRequestId,
    verificationId,
    verificationHash
  }).success, true);
  assert.equal(staffPaymentCommandSchema.safeParse({
    action: 'payment.evaluate_readiness',
    paymentRequestId,
    allocationId,
    allocationHash
  }).success, true);
});

test('AI cannot verify Payment, allocate funds or evaluate financial readiness', () => {
  for (const commandName of ['payment.verify', 'funds.allocate', 'payment.evaluate_readiness']) {
    assert.throws(() => assertCommandAuthority({
      commandId: crypto.randomUUID(),
      idempotencyKey: `task006-${commandName}`,
      commandName,
      requestedAt: new Date().toISOString(),
      actor: {
        id: financeIdForAuthority,
        kind: 'ai_agent',
        roles: ['finance']
      },
      payload: {}
    }), AuthorityError);
  }
});

const financeIdForAuthority = '81000000-0000-4000-8000-000000000099';
