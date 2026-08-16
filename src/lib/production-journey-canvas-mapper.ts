import type { PublishedProposalView } from '@/server/commercial/contract';
import type { CustomerPaymentRequestView } from '@/server/payment/contract';
import type { CustomerBookingView } from '@/server/booking/contract';
import type { JourneyNextAction } from '@/lib/journey-continuity';
import type { JourneyCanvasViewModel } from '@/components/travel-workspace/travel-workspace-types';

/**
 * E.2B.2B — the ONE pure production mapper from real, authoritative
 * domain objects into the neutral JourneyCanvasViewModel the shared
 * JourneyCanvasPresentation renders. This function:
 *   - performs no writes;
 *   - imports no Supabase/admin client;
 *   - calls no fetch;
 *   - never accepts a payment or a proposal;
 *   - never creates a payment or booking object;
 *   - matches payment/booking strictly by quotationId (the caller is
 *     responsible for having already filtered these to the accepted
 *     proposal's own quotationId — this function does not re-derive that
 *     matching itself, it only ever receives the already-scoped result);
 *   - never derives authority independently — nextAction is computed
 *     upstream by the real deriveJourneyNextAction() and passed in as-is;
 *   - always produces evidenceMode: 'LIVE';
 *   - OMITS hotel/dining/experience/itinerary/compare fields entirely
 *     (undefined, not an empty array/fabricated placeholder) because
 *     PublishedProposalView carries none of that data today — showing
 *     any of it here would be inventing evidence the real backend never
 *     supplied.
 */
export function mapPublishedProposalToJourneyCanvasViewModel(params: {
  proposal: PublishedProposalView;
  payment: CustomerPaymentRequestView | null;
  booking: CustomerBookingView | null;
  nextAction: JourneyNextAction;
  labels: { heading: string; summary: string; mapUnavailable: string };
}): JourneyCanvasViewModel {
  const { proposal, labels } = params;
  return {
    heading: proposal.customer.title ?? labels.heading,
    summary: labels.summary,
    destinationSequence: [],
    routeLabel: null, // no map/route evidence exists on PublishedProposalView — never fabricated
    selectedDirectionLabel: null,
    selectedOptionLabel: null,
    // days/hotelCandidate/diningCandidate/experienceCards/compareOptions
    // deliberately omitted (undefined) — no real evidence exists for any
    // of them yet on this contract.
    versionLabel: `v${proposal.versionNumber}`,
    whatChanged: null,
    evidenceMode: 'LIVE'
  };
}
