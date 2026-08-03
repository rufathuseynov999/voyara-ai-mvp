import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@/server/bos/canonical-json';
import {
  buildCanonicalQuotationPayload,
  customerCommercialCommandSchema,
  quotationCanonicalPayloadSchema,
  staffCommercialCommandSchema
} from '@/server/commercial/contract';

const source = {
  travelRequestId: '61000000-0000-4000-8000-000000000001',
  travelRequestVersion: 2,
  travelRequestHash: 'b'.repeat(64)
};

const draft = {
  locale: 'az' as const,
  title: 'İstanbul ailə səfəri',
  summary: 'Uçuş, otel və insan tərəfindən yoxlanılan səyahət şərtləri.',
  lineItems: [
    { description: 'Uçuş və otel paketi', quantity: 2, unitPriceAzn: '2500.00' }
  ],
  serviceFeeAzn: '100.00',
  discountAzn: '50.00',
  costTotalAzn: '4000.00',
  validUntil: '2030-12-31T20:00:00.000Z',
  customerNotes: 'Qiymətlər yalnız göstərilən müddətədək etibarlıdır.',
  riskFlags: ['PRICE_VOLATILITY' as const, 'MANUAL_CONFIRMATION_REQUIRED' as const]
};

test('canonical quotation calculates exact minor-unit economics and stable SHA-256', () => {
  const payload = buildCanonicalQuotationPayload(source, draft);
  assert.equal(payload.customer.subtotalMinor, 500_000);
  assert.equal(payload.customer.serviceFeeMinor, 10_000);
  assert.equal(payload.customer.discountMinor, 5_000);
  assert.equal(payload.customer.totalMinor, 505_000);
  assert.equal(payload.commercial.costTotalMinor, 400_000);
  assert.equal(payload.commercial.grossProfitMinor, 105_000);
  assert.equal(payload.commercial.grossMarginBps, 2_079);
  assert.deepEqual(payload.riskFlags, ['MANUAL_CONFIRMATION_REQUIRED', 'PRICE_VOLATILITY']);
  assert.match(sha256(payload), /^[0-9a-f]{64}$/);
  assert.equal(quotationCanonicalPayloadSchema.safeParse(payload).success, true);
});

test('quotation draft rejects floating-point ambiguity, duplicate risk flags and invalid totals', () => {
  const invalidMoney = { ...draft, lineItems: [{ ...draft.lineItems[0], unitPriceAzn: '1.001' }] };
  assert.equal(staffCommercialCommandSchema.safeParse({
    action: 'quotation.create_version',
    travelRequestId: source.travelRequestId,
    draft: invalidMoney
  }).success, false);
  assert.equal(staffCommercialCommandSchema.safeParse({
    action: 'quotation.create_version',
    travelRequestId: source.travelRequestId,
    draft: { ...draft, lineItems: [{ ...draft.lineItems[0], unitPriceAzn: '100000000.01' }] }
  }).success, false);

  assert.equal(staffCommercialCommandSchema.safeParse({
    action: 'quotation.create_version',
    travelRequestId: source.travelRequestId,
    draft: { ...draft, riskFlags: ['LOW_MARGIN', 'LOW_MARGIN'] }
  }).success, false);

  assert.throws(() => buildCanonicalQuotationPayload(source, {
    ...draft,
    discountAzn: '999999.00'
  }), /INVALID_QUOTATION_DISCOUNT/);
});

test('commercial commands require exact version/hash references and explicit Customer confirmation', () => {
  const quotationId = '62000000-0000-4000-8000-000000000001';
  const quotationHash = 'c'.repeat(64);
  assert.equal(staffCommercialCommandSchema.safeParse({
    action: 'quotation.submit_for_approval', quotationId, versionNumber: 1, quotationHash
  }).success, true);
  assert.equal(staffCommercialCommandSchema.safeParse({
    action: 'quotation.publish', quotationId, versionNumber: 1
  }).success, false);
  assert.equal(customerCommercialCommandSchema.safeParse({
    action: 'quotation.accept', quotationId, versionNumber: 1, quotationHash,
    locale: 'az', acceptanceConfirmed: false
  }).success, false);
  assert.equal(customerCommercialCommandSchema.safeParse({
    action: 'quotation.accept', quotationId, versionNumber: 1, quotationHash,
    locale: 'az', acceptanceConfirmed: true
  }).success, true);
});
