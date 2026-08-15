import Link from 'next/link';
import { PublishedProposals } from './published-proposals';
import { NextActionCard } from './next-action-card';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { PublishedProposalView } from '@/server/commercial/contract';
import type { CustomerPaymentRequestView } from '@/server/payment/contract';
import type { CustomerBookingView } from '@/server/booking/contract';
import { deriveJourneyNextAction } from '@/lib/journey-continuity';

/**
 * UX2 — Journey Canvas. UX3 adds the post-acceptance "what happens next"
 * projection (see journey-continuity.ts) without changing anything below.
 *
 * This does NOT replace or reimplement the Proposal domain logic. The
 * actual proposal cards, line items, quotation hash and the accept()
 * command are still rendered by the existing, untouched
 * <PublishedProposals> component — reused verbatim.
 *
 * Journey Canvas adds visual chrome around that authoritative data: a trip
 * summary hero, a Human-Approval-Gate stage track, and a context/map side
 * panel. The stage track is derived only from fields that already exist on
 * PublishedProposalView (status, validUntil, acceptedAt) — nothing is
 * invented:
 *   - "AI prepared" and "Expert reviewed": true once a proposal exists at
 *     all, because a quotation cannot reach PUBLISHED status without prior
 *     AI drafting and staff approval (see commercial/queries + AAL2 gate).
 *   - "Your approval needed": true while PUBLISHED and not yet expired.
 *   - "Ready to book" / "Booked": true once ACCEPTED.
 * "Supplier checked" is intentionally omitted — no supplier-verification
 * field exists on this contract yet, so showing it would be fabricated.
 */

type Stage = 'aiPrepared' | 'expertReviewed' | 'approvalRequired' | 'readyToBook' | 'booked';

function deriveStage(proposals: PublishedProposalView[]): Stage {
  if (proposals.length === 0) return 'aiPrepared';
  const accepted = proposals.some((p) => p.status === 'ACCEPTED');
  if (accepted) return 'booked';
  const live = proposals.some((p) => p.status === 'PUBLISHED' && new Date(p.validUntil).getTime() > Date.now());
  if (live) return 'approvalRequired';
  return 'expertReviewed';
}

const STAGE_ORDER: Stage[] = ['aiPrepared', 'expertReviewed', 'approvalRequired', 'readyToBook', 'booked'];

export function JourneyCanvas({
  askHref,
  bookings = [],
  canvasMessages,
  continuityMessages,
  locale,
  messages,
  payments = [],
  proposals
}: {
  askHref: string;
  bookings?: CustomerBookingView[];
  canvasMessages: Dictionary['journeyCanvas'];
  continuityMessages?: Dictionary['journeyContinuity'];
  locale: Locale;
  messages: Dictionary['proposalLive'];
  payments?: CustomerPaymentRequestView[];
  proposals: PublishedProposalView[];
}) {
  const currentStage = deriveStage(proposals);
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const headline = proposals[0]?.customer.title ?? canvasMessages.title;
  const isSampleData = proposals.length === 0;
  const acceptedProposal = proposals.find((p) => p.status === 'ACCEPTED') ?? null;
  const nextAction = acceptedProposal && continuityMessages ? deriveJourneyNextAction(acceptedProposal, payments, bookings) : null;

  const stageLabel: Record<Stage, string> = {
    aiPrepared: canvasMessages.stageAiPrepared,
    expertReviewed: canvasMessages.stageExpertReviewed,
    approvalRequired: canvasMessages.stageApprovalRequired,
    readyToBook: canvasMessages.stageReadyToBook,
    booked: canvasMessages.stageBooked
  };

  return (
    <div className="journey-canvas">
      <div className="journey-canvas-hero">
        <span className="eyebrow">{canvasMessages.eyebrow}</span>
        <h1>{headline}</h1>
        <p>{canvasMessages.title}</p>
      </div>

      <div className="journey-stage-track" role="list" aria-label={canvasMessages.eyebrow}>
        {STAGE_ORDER.filter((stage) => stage !== 'readyToBook' || currentStage === 'readyToBook' || currentStage === 'booked').map((stage) => {
          const stageIndex = STAGE_ORDER.indexOf(stage);
          const state = stageIndex < currentIndex ? 'is-complete' : stageIndex === currentIndex ? 'is-current' : '';
          return (
            <span className={`journey-stage ${state}`.trim()} key={stage} role="listitem">
              <span aria-hidden="true" className="journey-stage-dot" />
              {stageLabel[stage]}
            </span>
          );
        })}
      </div>

      <div className="journey-canvas-grid">
        <div className="journey-canvas-main">
          {isSampleData ? <p className="journey-sample-notice">{canvasMessages.sampleDataNotice}</p> : null}
          {nextAction && continuityMessages ? (
            <NextActionCard action={nextAction} locale={locale} messages={continuityMessages} />
          ) : null}
          <PublishedProposals locale={locale} messages={messages} proposals={proposals} />
        </div>

        <aside className="journey-canvas-side">
          <div className="journey-map-placeholder">{canvasMessages.mapUnavailable}</div>
          <div className="journey-alternatives-placeholder">
            <strong>{canvasMessages.alternativesTitle}</strong>
            <p>{canvasMessages.alternativesUnavailable}</p>
          </div>
          <Link className="button button-outline-dark" href={askHref}>
            {canvasMessages.askAboutItem}
          </Link>
        </aside>
      </div>
    </div>
  );
}
