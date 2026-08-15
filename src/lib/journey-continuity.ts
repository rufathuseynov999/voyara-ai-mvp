/**
 * UX3 — Customer journey continuity projection.
 *
 * A pure function, no DOM/React/server dependency, so it is independently
 * testable via node:test (see tests/ux3/journey-continuity.test.ts) and
 * reused unchanged by every surface that needs it (Journey Canvas, Trip
 * Room, Payment).
 *
 * SINGLE TRUTH RULE: this is a read-side projection over three existing
 * authoritative objects — PublishedProposalView, CustomerPaymentRequestView,
 * CustomerBookingView — joined only by the `quotationId` field every one
 * of them already carries. It invents no new status, persists nothing, and
 * never advances further than the real backend state actually proves:
 *   - a payment request only exists if the payments array contains one
 *     with a matching quotationId (real row);
 *   - a booking only exists if the bookings array contains one with a
 *     matching quotationId (real row);
 *   - "ready to travel" is only reached when the real booking status is
 *     VOUCHER_ISSUED, matching the same authority Trip Room already uses.
 *
 * Per src/server/booking/contract.ts, `booking.create` requires a
 * `paymentRequestId` — bookings are created FROM payment requests, so a
 * booking existing implies a payment request existed. This projection
 * relies on that real ordering rather than asserting it independently.
 */

export type PaymentRequestStatusLike =
  | 'REQUESTED'
  | 'EVIDENCE_RECEIVED'
  | 'UNDER_REVIEW'
  | 'EVIDENCE_REJECTED'
  | 'VERIFIED'
  | 'ALLOCATED'
  | 'READY_FOR_BOOKING';

export type BookingStatusLike =
  | 'CREATED'
  | 'SUPPLIER_EXECUTED'
  | 'SUPPLIER_CONFIRMED'
  | 'UNDER_VERIFICATION'
  | 'VERIFICATION_REJECTED'
  | 'BOOKING_VERIFIED'
  | 'VOUCHER_DRAFTED'
  | 'VOUCHER_ISSUED';

export type JourneyStageKey =
  | 'notAccepted'
  | 'awaitingPayment'
  | 'paymentActionRequired'
  | 'paymentInReview'
  | 'awaitingBooking'
  | 'bookingInProgress'
  | 'readyToTravel';

export type JourneyResponsibility = 'voyara' | 'customer' | 'ready';

export type JourneyNextAction = {
  stageKey: JourneyStageKey;
  responsibility: JourneyResponsibility;
  /** Present only when a real object exists for the primary CTA to point at. */
  primaryAction: 'continueToPayment' | 'openTripRoom' | null;
  paymentRequestId: string | null;
  bookingId: string | null;
};

type MinimalProposal = { quotationId: string; status: string };
type MinimalPayment = { quotationId: string; id: string; status: PaymentRequestStatusLike };
type MinimalBooking = { quotationId: string; id: string; status: BookingStatusLike };

const PAYMENT_ACTION_REQUIRED_STATUSES: readonly PaymentRequestStatusLike[] = ['REQUESTED', 'EVIDENCE_REJECTED'];
const PAYMENT_IN_REVIEW_STATUSES: readonly PaymentRequestStatusLike[] = ['EVIDENCE_RECEIVED', 'UNDER_REVIEW'];

/**
 * Derives the next-action projection for one accepted proposal. Returns a
 * `notAccepted` stage (no card should be shown) if the proposal's own
 * status is not ACCEPTED — the existing pre-acceptance Journey Canvas
 * experience is left untouched by design.
 */
export function deriveJourneyNextAction(
  proposal: MinimalProposal,
  payments: readonly MinimalPayment[],
  bookings: readonly MinimalBooking[]
): JourneyNextAction {
  if (proposal.status !== 'ACCEPTED') {
    return { stageKey: 'notAccepted', responsibility: 'voyara', primaryAction: null, paymentRequestId: null, bookingId: null };
  }

  const booking = bookings.find((b) => b.quotationId === proposal.quotationId) ?? null;
  if (booking) {
    if (booking.status === 'VOUCHER_ISSUED') {
      return { stageKey: 'readyToTravel', responsibility: 'ready', primaryAction: 'openTripRoom', paymentRequestId: null, bookingId: booking.id };
    }
    return { stageKey: 'bookingInProgress', responsibility: 'voyara', primaryAction: 'openTripRoom', paymentRequestId: null, bookingId: booking.id };
  }

  const payment = payments.find((p) => p.quotationId === proposal.quotationId) ?? null;
  if (payment) {
    if (PAYMENT_ACTION_REQUIRED_STATUSES.includes(payment.status)) {
      return { stageKey: 'paymentActionRequired', responsibility: 'customer', primaryAction: 'continueToPayment', paymentRequestId: payment.id, bookingId: null };
    }
    if (PAYMENT_IN_REVIEW_STATUSES.includes(payment.status)) {
      return { stageKey: 'paymentInReview', responsibility: 'voyara', primaryAction: null, paymentRequestId: payment.id, bookingId: null };
    }
    // VERIFIED / ALLOCATED / READY_FOR_BOOKING: payment is settled but no
    // booking row exists yet — VOYARA is preparing the booking step.
    return { stageKey: 'awaitingBooking', responsibility: 'voyara', primaryAction: null, paymentRequestId: payment.id, bookingId: null };
  }

  return { stageKey: 'awaitingPayment', responsibility: 'voyara', primaryAction: null, paymentRequestId: null, bookingId: null };
}

/** Customer-friendly stage for a single already-known booking (used by Trip Room, which is already scoped to real booking rows). */
export function deriveBookingStage(status: BookingStatusLike): { stageKey: JourneyStageKey; responsibility: JourneyResponsibility } {
  if (status === 'VOUCHER_ISSUED') return { stageKey: 'readyToTravel', responsibility: 'ready' };
  return { stageKey: 'bookingInProgress', responsibility: 'voyara' };
}
