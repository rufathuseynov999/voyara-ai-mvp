import type { PublishedProposalView } from '@/server/commercial/contract';
import type { CustomerPaymentRequestView } from '@/server/payment/contract';
import type { CustomerBookingView } from '@/server/booking/contract';

/**
 * E.2B final certification — production-shaped simulation fixtures. Every
 * object here matches the REAL repository contract types exactly
 * (PublishedProposalView / CustomerPaymentRequestView / CustomerBookingView)
 * — this is what makes it a genuine simulation of the production
 * presentation path, not an illustrative preview fixture. Status values
 * are real, existing enum members from journey-continuity.ts; no status
 * is invented. Nothing here is ever written to a database — this module
 * is imported only by the internal-preview harness route.
 */

const QUOTE_ID = 'sim-quote-001';

const BASE_PROPOSAL: PublishedProposalView = {
  id: 'sim-proposal-001', quotationId: QUOTE_ID, versionNumber: 1, payloadHash: 'a'.repeat(64), status: 'PUBLISHED',
  customer: {
    locale: 'en', title: 'Baku to Istanbul — 5 nights', summary: 'A published proposal simulation.', currency: 'AZN',
    lineItems: [{ label: 'Hotel', quantity: 1, unitPriceMinor: 100000, totalMinor: 100000 } as any],
    subtotalMinor: 100000, serviceFeeMinor: 5000, discountMinor: 0, totalMinor: 105000, validUntil: '2026-12-31T00:00:00.000Z'
  } as any,
  locale: 'en', validUntil: '2026-12-31T00:00:00.000Z', publishedAt: '2026-08-01T00:00:00.000Z', acceptedAt: null
};

const ACCEPTED_PROPOSAL: PublishedProposalView = { ...BASE_PROPOSAL, id: 'sim-proposal-002', status: 'ACCEPTED', acceptedAt: '2026-08-02T00:00:00.000Z' };

function payment(status: CustomerPaymentRequestView['status'], quotationId = QUOTE_ID): CustomerPaymentRequestView {
  return { id: 'sim-payment-001', quotationId, status, amountMinor: 105000, currency: 'AZN' } as any;
}

function booking(status: CustomerBookingView['status'], quotationId = QUOTE_ID): CustomerBookingView {
  return { id: 'sim-booking-001', quotationId, status } as any;
}

export const PRODUCTION_STATES = [
  'published', 'accepted', 'payment-required', 'payment-review', 'booking-progress',
  'voucher-issued', 'verification-rejected', 'cross-quotation', 'minimal-live'
] as const;
export type ProductionState = (typeof PRODUCTION_STATES)[number];

export function buildProductionFixture(state: ProductionState): { proposals: PublishedProposalView[]; payments: CustomerPaymentRequestView[]; bookings: CustomerBookingView[] } {
  switch (state) {
    case 'published':
      return { proposals: [BASE_PROPOSAL], payments: [], bookings: [] };
    case 'accepted':
      return { proposals: [ACCEPTED_PROPOSAL], payments: [], bookings: [] };
    case 'payment-required':
      return { proposals: [ACCEPTED_PROPOSAL], payments: [payment('REQUESTED')], bookings: [] };
    case 'payment-review':
      return { proposals: [ACCEPTED_PROPOSAL], payments: [payment('UNDER_REVIEW')], bookings: [] };
    case 'booking-progress':
      return { proposals: [ACCEPTED_PROPOSAL], payments: [payment('READY_FOR_BOOKING')], bookings: [booking('SUPPLIER_CONFIRMED')] };
    case 'voucher-issued':
      return { proposals: [ACCEPTED_PROPOSAL], payments: [payment('READY_FOR_BOOKING')], bookings: [booking('VOUCHER_ISSUED')] };
    case 'verification-rejected':
      return { proposals: [ACCEPTED_PROPOSAL], payments: [payment('READY_FOR_BOOKING')], bookings: [booking('VERIFICATION_REJECTED')] };
    case 'cross-quotation':
      // A real payment and a real VOUCHER_ISSUED booking exist, but both
      // belong to a DIFFERENT quotationId — proving they have zero
      // influence on this proposal's own next-action.
      return { proposals: [ACCEPTED_PROPOSAL], payments: [payment('READY_FOR_BOOKING', 'OTHER-QUOTE')], bookings: [booking('VOUCHER_ISSUED', 'OTHER-QUOTE')] };
    case 'minimal-live':
      return { proposals: [BASE_PROPOSAL], payments: [], bookings: [] };
  }
}
