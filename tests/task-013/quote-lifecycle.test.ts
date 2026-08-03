import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  assertTransition,
  canTransition,
  InvalidQuoteTransitionError,
  isTerminalQuoteStatus,
  quoteAuditEventKinds
} from '@/server/supplier/quote-lifecycle';
import {
  approveCurrentVersion,
  createQuote,
  currentVersion,
  hasValidApproval,
  hashMaterial,
  revalidateQuote,
  supersedeWithNewVersion,
  transitionQuote,
  type Quote
} from '@/server/supplier/quote';
import type { MaterialCommercialFields } from '@/server/supplier/contract';

const NOW = new Date('2026-07-20T09:00:00.000Z');

const material = (overrides: Partial<MaterialCommercialFields> = {}): MaterialCommercialFields => ({
  supplierNetMinor: 800_000,
  taxesAndFeesMinor: 120_000,
  customerTotalMinor: 1_040_000,
  currency: 'AZN',
  roomType: 'Overwater villa',
  boardBasis: 'HALF_BOARD',
  cancellationPolicy: { kind: 'FREE_UNTIL', freeUntil: '2026-08-01' },
  checkIn: '2026-08-12',
  checkOut: '2026-08-19',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  supplierOfferReference: 'SIM-OFFER-1',
  offerExpiry: '2026-07-25T12:00:00.000Z',
  ...overrides
});

const newQuote = (overrides: Partial<MaterialCommercialFields> = {}): Quote =>
  createQuote({
    tenantId: randomUUID(),
    customerId: randomUUID(),
    supplierOfferReference: 'SIM-OFFER-1',
    source: 'SIMULATED',
    correlationId: 'corr-abc-12345',
    material: material(overrides),
    now: NOW
  });

/** Drive a fresh quote to APPROVED for tests that need an approved baseline. */
function approvedQuote(overrides: Partial<MaterialCommercialFields> = {}): Quote {
  let quote = newQuote(overrides);
  quote = transitionQuote(quote, 'SEARCHED');
  quote = transitionQuote(quote, 'NORMALIZED');
  quote = transitionQuote(quote, 'PREPARED');
  quote = transitionQuote(quote, 'PENDING_HUMAN_REVIEW');
  quote = approveCurrentVersion(quote, randomUUID());
  return quote;
}

test('valid transitions are allowed through the lifecycle', () => {
  assert.equal(canTransition('DRAFT', 'SEARCHED'), true);
  assert.equal(canTransition('PENDING_HUMAN_REVIEW', 'APPROVED'), true);
  assert.equal(canTransition('PRESENTED', 'CUSTOMER_ACCEPTED'), true);
  assert.equal(canTransition('CUSTOMER_ACCEPTED', 'PAYMENT_PENDING'), true);
  assert.doesNotThrow(() => assertTransition('APPROVED', 'PRESENTED'));
});

test('invalid transitions fail closed', () => {
  assert.equal(canTransition('DRAFT', 'APPROVED'), false);
  assert.equal(canTransition('APPROVED', 'PAYMENT_PENDING'), false);
  assert.equal(canTransition('EXPIRED', 'APPROVED'), false);
  assert.throws(() => assertTransition('DRAFT', 'PAYMENT_PENDING'), InvalidQuoteTransitionError);
  for (const terminal of ['EXPIRED', 'REJECTED', 'PRICE_CHANGED', 'SUPPLIER_UNAVAILABLE', 'CANCELLED'] as const) {
    assert.equal(isTerminalQuoteStatus(terminal), true);
    assert.equal(canTransition(terminal, 'APPROVED'), false);
  }
});

test('approved version is immutable and preserved after supersession', () => {
  const approved = approvedQuote();
  const v1 = currentVersion(approved);
  assert.equal(v1.versionNumber, 1);
  assert.notEqual(v1.approvalReference, null);

  const superseded = supersedeWithNewVersion(approved, material({ customerTotalMinor: 1_050_000 }), 'price change', NOW);
  // The original version object is retained with its original hash/approval.
  const retainedV1 = superseded.versions.find((v) => v.versionNumber === 1)!;
  assert.equal(retainedV1.contentHash, v1.contentHash);
  assert.equal(retainedV1.approvalReference, v1.approvalReference);
  assert.equal(retainedV1.approvalInvalidated, true);
});

test('version increments and new version gets a new content hash', () => {
  const approved = approvedQuote();
  const v1Hash = currentVersion(approved).contentHash;
  const superseded = supersedeWithNewVersion(approved, material({ customerTotalMinor: 1_050_000 }), 'reason', NOW);
  assert.equal(superseded.currentVersionNumber, 2);
  assert.equal(superseded.versions.length, 2);
  const v2 = currentVersion(superseded);
  assert.equal(v2.versionNumber, 2);
  assert.notEqual(v2.contentHash, v1Hash);
  assert.equal(v2.previousVersionNumber, 1);
  assert.equal(v2.approvalReference, null); // fresh approval required
});

test('content hash is stable for identical material and changes on material change', () => {
  assert.equal(hashMaterial(material()), hashMaterial(material()));
  assert.notEqual(hashMaterial(material()), hashMaterial(material({ customerTotalMinor: 999_999 })));
});

test('approval is invalidated when a new version supersedes it', () => {
  const approved = approvedQuote();
  assert.equal(hasValidApproval(approved), true);
  const superseded = supersedeWithNewVersion(approved, material({ roomType: 'Beach villa' }), 'room change', NOW);
  assert.equal(hasValidApproval(superseded), false); // new version unapproved
});

test('revalidation: price change creates new version, PRICE_CHANGED, fresh approval required', () => {
  const approved = approvedQuote();
  const outcome = revalidateQuote(approved, { ok: true, material: material({ customerTotalMinor: 1_060_000 }) }, NOW);
  assert.equal(outcome.kind, 'MATERIAL_CHANGE');
  if (outcome.kind === 'MATERIAL_CHANGE') {
    assert.equal(outcome.quote.status, 'PRICE_CHANGED');
    assert.equal(outcome.quote.currentVersionNumber, 2);
    assert.equal(hasValidApproval(outcome.quote), false);
    assert.ok(outcome.changes.some((c) => c.field === 'customerTotalMinor'));
  }
});

test('revalidation: cancellation-policy and room/board changes are detected', () => {
  const approved = approvedQuote();
  const policy = revalidateQuote(approved, { ok: true, material: material({ cancellationPolicy: { kind: 'NON_REFUNDABLE' } }) }, NOW);
  assert.equal(policy.kind, 'MATERIAL_CHANGE');

  const board = revalidateQuote(approved, { ok: true, material: material({ boardBasis: 'ALL_INCLUSIVE' }) }, NOW);
  assert.equal(board.kind, 'MATERIAL_CHANGE');

  const room = revalidateQuote(approved, { ok: true, material: material({ roomType: 'Garden suite' }) }, NOW);
  assert.equal(room.kind, 'MATERIAL_CHANGE');
});

test('revalidation: expiry yields EXPIRED', () => {
  const approved = approvedQuote();
  const afterExpiry = new Date('2026-07-26T00:00:00.000Z');
  const outcome = revalidateQuote(approved, { ok: true, material: material() }, afterExpiry);
  assert.equal(outcome.kind, 'EXPIRED');
  if (outcome.kind === 'EXPIRED') assert.equal(outcome.quote.status, 'EXPIRED');
});

test('revalidation: supplier unavailable yields SUPPLIER_UNAVAILABLE', () => {
  const approved = approvedQuote();
  const outcome = revalidateQuote(approved, { ok: false, error: { kind: 'UNAVAILABLE', retryable: true, code: 'SUPPLIER_UNAVAILABLE' } }, NOW);
  assert.equal(outcome.kind, 'SUPPLIER_UNAVAILABLE');
  if (outcome.kind === 'SUPPLIER_UNAVAILABLE') assert.equal(outcome.quote.status, 'SUPPLIER_UNAVAILABLE');
});

test('revalidation: unchanged retains version and updates evidence', () => {
  const approved = approvedQuote();
  const outcome = revalidateQuote(approved, { ok: true, material: material() }, NOW);
  assert.equal(outcome.kind, 'UNCHANGED');
  if (outcome.kind === 'UNCHANGED') {
    assert.equal(outcome.quote.currentVersionNumber, 1);
    assert.equal(outcome.quote.status, 'APPROVED');
    assert.equal(outcome.quote.lastRevalidatedAt, NOW.toISOString());
    assert.equal(hasValidApproval(outcome.quote), true);
  }
});

test('revalidation: non-availability supplier error preserves approved content', () => {
  const approved = approvedQuote();
  const before = currentVersion(approved);
  const outcome = revalidateQuote(approved, { ok: false, error: { kind: 'TIMEOUT', retryable: true, code: 'SUPPLIER_TIMEOUT' } }, NOW);
  assert.equal(outcome.kind, 'SUPPLIER_ERROR');
  if (outcome.kind === 'SUPPLIER_ERROR') {
    // Approved version and status are unchanged.
    assert.equal(outcome.quote.status, 'APPROVED');
    assert.equal(currentVersion(outcome.quote).contentHash, before.contentHash);
    assert.equal(hasValidApproval(outcome.quote), true);
  }
});

test('quote carries tenant/customer ownership and audit event kinds are complete', () => {
  const quote = newQuote();
  assert.match(quote.tenantId, /[0-9a-f-]{36}/);
  assert.match(quote.customerId, /[0-9a-f-]{36}/);
  assert.notEqual(quote.tenantId, quote.customerId);
  assert.equal(quoteAuditEventKinds.includes('QUOTE_MATERIAL_CHANGE_DETECTED'), true);
  assert.equal(quoteAuditEventKinds.includes('QUOTE_APPROVAL_INVALIDATED'), true);
  assert.equal(quoteAuditEventKinds.length, 12);
});
