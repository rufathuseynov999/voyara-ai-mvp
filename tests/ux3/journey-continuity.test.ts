import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveJourneyNextAction, deriveBookingStage, type BookingStatusLike, type PaymentRequestStatusLike } from '@/lib/journey-continuity';

/**
 * UX3 — journey continuity projection tests.
 *
 * These exercise the exact pure function every surface (Journey Canvas,
 * Trip Room, Payment) imports, so the business-logic correctness proven
 * here is what the customer actually sees.
 *
 * Business-logic review (per the repository's real contracts):
 *   - payment_requests.status values REQUESTED / EVIDENCE_REJECTED are the
 *     only ones where the customer has something outstanding to submit —
 *     everything else (EVIDENCE_RECEIVED, UNDER_REVIEW, VERIFIED,
 *     ALLOCATED, READY_FOR_BOOKING) is VOYARA/staff-owned from the
 *     customer's point of view, so none of those may ever produce a
 *     "Pay now" style customer-action CTA.
 *   - bookings.status only proves "ready to travel" at VOUCHER_ISSUED —
 *     every earlier status (including VERIFICATION_REJECTED, which is a
 *     VOYARA-ops correction per bookingCustomer.rejectedBody, not a
 *     customer action) stays "VOYARA is handling this", never "customer
 *     action required" and never "ready".
 */

const PROPOSAL_QUOTATION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_QUOTATION_ID = '22222222-2222-4222-8222-222222222222';

function proposal(status: string, quotationId = PROPOSAL_QUOTATION_ID) {
  return { quotationId, status };
}
function payment(status: PaymentRequestStatusLike, quotationId = PROPOSAL_QUOTATION_ID, id = 'pay-1') {
  return { id, quotationId, status };
}
function booking(status: BookingStatusLike, quotationId = PROPOSAL_QUOTATION_ID, id = 'book-1') {
  return { id, quotationId, status };
}

test('a proposal that is not ACCEPTED never produces a next-action card', () => {
  for (const status of ['PUBLISHED', 'EXPIRED', 'DRAFT']) {
    const result = deriveJourneyNextAction(proposal(status), [], []);
    assert.equal(result.stageKey, 'notAccepted');
    assert.equal(result.primaryAction, null);
  }
});

test('accepted quotation + no payment request → honest waiting state, no customer CTA', () => {
  const result = deriveJourneyNextAction(proposal('ACCEPTED'), [], []);
  assert.equal(result.stageKey, 'awaitingPayment');
  assert.equal(result.responsibility, 'voyara');
  assert.equal(result.primaryAction, null, 'must never show a fake Pay Now button with no real payment request');
  assert.equal(result.paymentRequestId, null);
});

for (const status of ['REQUESTED', 'EVIDENCE_REJECTED'] as const) {
  test(`payment status ${status} genuinely requires customer action → payment CTA`, () => {
    const result = deriveJourneyNextAction(proposal('ACCEPTED'), [payment(status)], []);
    assert.equal(result.stageKey, 'paymentActionRequired');
    assert.equal(result.responsibility, 'customer');
    assert.equal(result.primaryAction, 'continueToPayment');
    assert.equal(result.paymentRequestId, 'pay-1');
  });
}

for (const status of ['EVIDENCE_RECEIVED', 'UNDER_REVIEW'] as const) {
  test(`payment status ${status} is VOYARA-owned, not a customer action (evidence already submitted)`, () => {
    const result = deriveJourneyNextAction(proposal('ACCEPTED'), [payment(status)], []);
    assert.equal(result.stageKey, 'paymentInReview');
    assert.equal(result.responsibility, 'voyara');
    assert.equal(result.primaryAction, null, 'must not show Pay Now again once evidence is already submitted and under review');
  });
}

for (const status of ['VERIFIED', 'ALLOCATED', 'READY_FOR_BOOKING'] as const) {
  test(`payment status ${status} is settled — no outstanding customer payment action, awaiting booking`, () => {
    const result = deriveJourneyNextAction(proposal('ACCEPTED'), [payment(status)], []);
    assert.equal(result.stageKey, 'awaitingBooking');
    assert.equal(result.responsibility, 'voyara');
    assert.equal(result.primaryAction, null, 'a settled payment must never re-prompt the customer to pay');
  });
}

test('a real booking always wins over a real payment request (booking implies payment already happened)', () => {
  const result = deriveJourneyNextAction(proposal('ACCEPTED'), [payment('READY_FOR_BOOKING')], [booking('CREATED')]);
  assert.equal(result.stageKey, 'bookingInProgress');
  assert.equal(result.primaryAction, 'openTripRoom');
});

const nonVoucherBookingStatuses: BookingStatusLike[] = [
  'CREATED',
  'SUPPLIER_EXECUTED',
  'SUPPLIER_CONFIRMED',
  'UNDER_VERIFICATION',
  'VERIFICATION_REJECTED',
  'BOOKING_VERIFIED',
  'VOUCHER_DRAFTED'
];

for (const status of nonVoucherBookingStatuses) {
  test(`booking status ${status} is "in progress" (VOYARA-owned), never "ready to travel" before a voucher exists`, () => {
    const result = deriveJourneyNextAction(proposal('ACCEPTED'), [], [booking(status)]);
    assert.equal(result.stageKey, 'bookingInProgress');
    assert.equal(result.responsibility, 'voyara');
    assert.equal(result.primaryAction, 'openTripRoom');
  });
}

test('VERIFICATION_REJECTED specifically stays VOYARA-owned, not customer-owned (staff must correct it, not the customer)', () => {
  const result = deriveJourneyNextAction(proposal('ACCEPTED'), [], [booking('VERIFICATION_REJECTED')]);
  assert.equal(result.responsibility, 'voyara');
  assert.notEqual(result.responsibility, 'customer');
});

test('VOUCHER_ISSUED is the only booking status that reaches "ready to travel"', () => {
  const result = deriveJourneyNextAction(proposal('ACCEPTED'), [], [booking('VOUCHER_ISSUED')]);
  assert.equal(result.stageKey, 'readyToTravel');
  assert.equal(result.responsibility, 'ready');
  assert.equal(result.primaryAction, 'openTripRoom');
  assert.equal(result.bookingId, 'book-1');
});

test('a payment/booking row for a DIFFERENT quotation must never affect this proposal (no cross-trip bleed)', () => {
  const result = deriveJourneyNextAction(
    proposal('ACCEPTED', PROPOSAL_QUOTATION_ID),
    [payment('REQUESTED', OTHER_QUOTATION_ID)],
    [booking('VOUCHER_ISSUED', OTHER_QUOTATION_ID)]
  );
  assert.equal(result.stageKey, 'awaitingPayment', 'unrelated rows for another quotation must be ignored entirely');
  assert.equal(result.primaryAction, null);
});

test('multiple payment rows: only the one matching this quotationId is considered', () => {
  const result = deriveJourneyNextAction(
    proposal('ACCEPTED'),
    [payment('READY_FOR_BOOKING', OTHER_QUOTATION_ID, 'pay-other'), payment('REQUESTED', PROPOSAL_QUOTATION_ID, 'pay-mine')],
    []
  );
  assert.equal(result.paymentRequestId, 'pay-mine');
  assert.equal(result.stageKey, 'paymentActionRequired');
});

test('deriveBookingStage never advances further than the real status (monotonic, deterministic)', () => {
  const order: BookingStatusLike[] = [
    'CREATED', 'SUPPLIER_EXECUTED', 'SUPPLIER_CONFIRMED', 'UNDER_VERIFICATION',
    'BOOKING_VERIFIED', 'VOUCHER_DRAFTED', 'VOUCHER_ISSUED'
  ];
  const results = order.map((status) => deriveBookingStage(status));
  // Every status except the very last (VOUCHER_ISSUED) must be the same
  // "in progress" projection — no partial-credit intermediate stages that
  // could imply more completion than the backend has actually recorded.
  for (const result of results.slice(0, -1)) {
    assert.equal(result.stageKey, 'bookingInProgress');
    assert.equal(result.responsibility, 'voyara');
  }
  assert.equal(results[results.length - 1].stageKey, 'readyToTravel');
});

test('deriveBookingStage is a pure function: identical input always yields identical output', () => {
  const a = deriveBookingStage('SUPPLIER_CONFIRMED');
  const b = deriveBookingStage('SUPPLIER_CONFIRMED');
  assert.deepEqual(a, b);
});
