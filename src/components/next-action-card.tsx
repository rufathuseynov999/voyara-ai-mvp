import Link from 'next/link';
import type { Dictionary } from '@/i18n/dictionaries';
import type { JourneyNextAction } from '@/lib/journey-continuity';

const COPY_KEY: Record<Exclude<JourneyNextAction['stageKey'], 'notAccepted'>, { title: keyof Dictionary['journeyContinuity']; body: keyof Dictionary['journeyContinuity'] }> = {
  awaitingPayment: { title: 'awaitingPaymentTitle', body: 'awaitingPaymentBody' },
  paymentActionRequired: { title: 'paymentActionRequiredTitle', body: 'paymentActionRequiredBody' },
  paymentInReview: { title: 'paymentInReviewTitle', body: 'paymentInReviewBody' },
  awaitingBooking: { title: 'awaitingBookingTitle', body: 'awaitingBookingBody' },
  bookingInProgress: { title: 'bookingInProgressTitle', body: 'bookingInProgressBody' },
  readyToTravel: { title: 'readyToTravelTitle', body: 'readyToTravelBody' }
};

/**
 * Renders nothing for the `notAccepted` stage — the pre-acceptance Journey
 * Canvas experience is intentionally left as-is (see journey-continuity.ts).
 */
export function NextActionCard({
  action,
  messages,
  locale,
  compact = false
}: {
  action: JourneyNextAction;
  messages: Dictionary['journeyContinuity'];
  locale: string;
  compact?: boolean;
}) {
  if (action.stageKey === 'notAccepted') return null;

  const copy = COPY_KEY[action.stageKey];
  const responsibilityLabel =
    action.responsibility === 'customer'
      ? messages.responsibilityCustomer
      : action.responsibility === 'ready'
        ? messages.responsibilityReady
        : messages.responsibilityVoyara;

  return (
    <section
      aria-live="polite"
      className={compact ? 'next-action-card next-action-card-compact' : 'next-action-card'}
      data-responsibility={action.responsibility}
      data-stage={action.stageKey}
    >
      <span className="eyebrow">{messages.cardEyebrow}</span>
      <span className={`next-action-badge next-action-badge-${action.responsibility}`}>{responsibilityLabel}</span>
      <h3>{messages[copy.title]}</h3>
      <p>{messages[copy.body]}</p>
      {action.primaryAction ? (
        <div className="next-action-cta">
          {action.primaryAction === 'continueToPayment' ? (
            <Link className="button button-primary" href={`/${locale}/payment`}>
              {messages.ctaContinueToPayment}
            </Link>
          ) : null}
          {action.primaryAction === 'openTripRoom' ? (
            <Link className="button button-primary" href={`/${locale}/trip-room`}>
              {messages.ctaOpenTripRoom}
            </Link>
          ) : null}
        </div>
      ) : null}
      <p className="next-action-source-note">{messages.sourceNote}</p>
    </section>
  );
}
