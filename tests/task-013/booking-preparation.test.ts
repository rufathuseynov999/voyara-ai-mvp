import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  approveCurrentVersion,
  createQuote,
  currentVersion,
  supersedeWithNewVersion,
  transitionQuote,
  type Quote
} from '@/server/supplier/quote';
import {
  isLiveBookingPermitted,
  isVoucherEligible,
  prepareBooking,
  type BookingPreparationContract
} from '@/server/supplier/booking-preparation';
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

/** Build a quote in PAYMENT_VERIFIED with a valid approval on the current version. */
function paymentVerifiedQuote(overrides: Partial<MaterialCommercialFields> = {}): Quote {
  let quote = createQuote({
    tenantId: randomUUID(),
    customerId: randomUUID(),
    supplierOfferReference: 'SIM-OFFER-1',
    source: 'SIMULATED',
    correlationId: 'corr-abc-12345',
    material: material(overrides),
    now: NOW
  });
  quote = transitionQuote(quote, 'SEARCHED');
  quote = transitionQuote(quote, 'NORMALIZED');
  quote = transitionQuote(quote, 'PREPARED');
  quote = transitionQuote(quote, 'PENDING_HUMAN_REVIEW');
  quote = approveCurrentVersion(quote, randomUUID());
  quote = transitionQuote(quote, 'PRESENTED');
  quote = transitionQuote(quote, 'CUSTOMER_ACCEPTED');
  quote = transitionQuote(quote, 'PAYMENT_PENDING');
  quote = transitionQuote(quote, 'PAYMENT_DETECTED');
  quote = transitionQuote(quote, 'PAYMENT_VERIFIED');
  return quote;
}

const prepInput = (quote: Quote, overrides: Record<string, unknown> = {}) => ({
  quote,
  paymentVerified: true,
  reconciliationStatus: 'MATCHED' as const,
  offerStillAvailable: true,
  hagApprovalReference: randomUUID(),
  travellers: [{ fullName: 'Aygun M', isLead: true }],
  rooming: [{ roomIndex: 1, travellerNames: ['Aygun M'] }],
  specialRequests: '',
  correlationId: 'corr-abc-12345',
  liveBookingEnabled: false,
  now: NOW,
  ...overrides
});

test('valid preparation succeeds and requires human booking verification', () => {
  const result = prepareBooking(prepInput(paymentVerifiedQuote()));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.preparation.requiresHumanBookingVerification, true);
    assert.equal(result.preparation.simulated, true);
    assert.equal(result.preparation.reconciliationStatus, 'MATCHED');
    assert.ok(result.preparation.humanVerificationChecklist.length >= 1);
  }
});

test('preparation blocked without valid approval', () => {
  // Supersede the approved version so the current version is unapproved.
  let quote = paymentVerifiedQuote();
  quote = supersedeWithNewVersion(quote, material({ roomType: 'Beach villa' }), 'change', NOW);
  const result = prepareBooking(prepInput(quote));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'NO_VALID_APPROVAL');
});

test('preparation blocked when quote is not in PAYMENT_VERIFIED state', () => {
  let quote = createQuote({
    tenantId: randomUUID(), customerId: randomUUID(), supplierOfferReference: 'SIM-OFFER-1',
    source: 'SIMULATED', correlationId: 'corr-abc-12345', material: material(), now: NOW
  });
  quote = transitionQuote(quote, 'SEARCHED');
  quote = transitionQuote(quote, 'NORMALIZED');
  quote = transitionQuote(quote, 'PREPARED');
  quote = transitionQuote(quote, 'PENDING_HUMAN_REVIEW');
  quote = approveCurrentVersion(quote, randomUUID());
  const result = prepareBooking(prepInput(quote));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'QUOTE_NOT_PAYMENT_VERIFIED_STATE');
});

test('preparation blocked without verified payment', () => {
  const result = prepareBooking(prepInput(paymentVerifiedQuote(), { paymentVerified: false }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'PAYMENT_NOT_VERIFIED');
});

test('preparation blocked when reconciliation is not MATCHED', () => {
  const result = prepareBooking(prepInput(paymentVerifiedQuote(), { reconciliationStatus: 'PARTIAL' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'RECONCILIATION_NOT_MATCHED');
});

test('preparation blocked when offer expired', () => {
  const result = prepareBooking(prepInput(paymentVerifiedQuote(), { now: new Date('2026-07-26T00:00:00.000Z') }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'OFFER_EXPIRED');
});

test('preparation blocked when supplier offer unavailable', () => {
  const result = prepareBooking(prepInput(paymentVerifiedQuote(), { offerStillAvailable: false }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, 'OFFER_UNAVAILABLE');
});

test('live booking is disabled by default and blocked for simulated preparations', () => {
  const result = prepareBooking(prepInput(paymentVerifiedQuote()));
  assert.ok(result.ok);
  if (result.ok) {
    const preparation: BookingPreparationContract = result.preparation;
    // liveBookingEnabled false → never permitted.
    assert.equal(isLiveBookingPermitted({ liveBookingEnabled: false, preparation, humanVerificationComplete: true }), false);
    // Even if the flag were on, a SIMULATED preparation can never go live.
    assert.equal(isLiveBookingPermitted({ liveBookingEnabled: true, preparation, humanVerificationComplete: true }), false);
  }
});

test('voucher eligibility blocked until every authority condition holds', () => {
  const quote = paymentVerifiedQuote();
  // Booking not confirmed yet → not eligible.
  assert.equal(isVoucherEligible({ quote, paymentVerified: true, reconciliationStatus: 'MATCHED', bookingConfirmed: false }), false);
  // Reconciliation not matched → not eligible.
  assert.equal(isVoucherEligible({ quote, paymentVerified: true, reconciliationStatus: 'PARTIAL', bookingConfirmed: true }), false);
  // All conditions satisfied → eligible.
  assert.equal(isVoucherEligible({ quote, paymentVerified: true, reconciliationStatus: 'MATCHED', bookingConfirmed: true }), true);
});

test('prepared payload is clearly simulated for non-live sources', () => {
  const result = prepareBooking(prepInput(paymentVerifiedQuote()));
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.preparation.source, 'SIMULATED');
    assert.equal(result.preparation.simulated, true);
  }
});

test('migration enforces RLS on every Phase 3A customer-owned table', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20260719090000_task013_phase3a_supplier_payment_foundation.sql', import.meta.url),
    'utf8'
  );
  const customerOwned = [
    'quotes', 'quote_versions', 'normalized_offers', 'offer_revalidations',
    'payment_intents', 'payment_events', 'payment_reconciliations',
    'booking_preparations', 'commercial_exceptions'
  ];
  for (const table of customerOwned) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security`), `${table} RLS enabled`);
    assert.ok(sql.includes(`alter table public.${table} force row level security`), `${table} RLS forced`);
  }
  // Owner check present on customer-owned tables (no cross-customer read).
  assert.ok(sql.includes('(select auth.uid()) = customer_id'));
  // Staff-only tables restricted to AAL2 staff.
  assert.ok(sql.includes('supplier_requests_select_aal2_staff'));
  assert.ok(sql.includes('payment_webhook_receipts_select_aal2_staff'));
});
