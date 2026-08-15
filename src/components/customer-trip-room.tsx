import Link from 'next/link';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { BookingStatus, CustomerBookingView } from '@/server/booking/contract';
import type { CustomerSupportCase } from '@/server/support/contract';
import { CustomerSupportPanel } from './customer-support-panel';
import { NextActionCard } from './next-action-card';
import { deriveBookingStage } from '@/lib/journey-continuity';

const numberLocales: Record<Locale, string> = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };
const statusOrder: Record<BookingStatus, number> = {
  CREATED: 0,
  SUPPLIER_EXECUTED: 1,
  SUPPLIER_CONFIRMED: 2,
  UNDER_VERIFICATION: 3,
  VERIFICATION_REJECTED: 3,
  BOOKING_VERIFIED: 4,
  VOUCHER_DRAFTED: 4,
  VOUCHER_ISSUED: 5
};

export function CustomerTripRoom({
  bookings,
  supportCases,
  locale,
  messages,
  supportMessages,
  continuityMessages,
  proposalHref
}: {
  bookings: CustomerBookingView[];
  supportCases: CustomerSupportCase[];
  locale: Locale;
  messages: Dictionary['bookingCustomer'];
  supportMessages: Dictionary['supportCustomer'];
  continuityMessages?: Dictionary['journeyContinuity'];
  proposalHref?: string;
}) {
  if (bookings.length === 0) {
    return (
      <section className="trip-room-workspace" aria-labelledby="trip-room-status-title">
        <h2 className="visually-hidden" id="trip-room-status-title">{messages.status}</h2>
        <div className="empty-state"><p>{messages.empty}</p></div>
        <p className="authority-note">{messages.boundary}</p>
      </section>
    );
  }

  return (
    <section className="trip-room-workspace" aria-labelledby="trip-room-status-title">
      <h2 className="visually-hidden" id="trip-room-status-title">{messages.status}</h2>
      <div className="trip-booking-list">
        {bookings.map((booking) => {
          const current = statusOrder[booking.status];
          const stages = [
            messages.stages.booking,
            messages.stages.execution,
            messages.stages.confirmation,
            messages.stages.verification,
            messages.stages.verified,
            messages.stages.voucher
          ];
          return (
            <article className="trip-booking-card" key={booking.id}>
              <header>
                <div>
                  <span className="request-status">{messages.statusLabels[booking.status]}</span>
                  <h2>{messages.bookingReference} {booking.id.slice(0, 8)}</h2>
                </div>
                <span className="trip-booking-date">
                  {messages.createdAt}<strong>{new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.createdAt))}</strong>
                </span>
              </header>

              <dl className="booking-facts">
                <div><dt>{messages.quotationVersion}</dt><dd>{booking.versionNumber}</dd></div>
                <div className="booking-hash"><dt>{messages.exactQuotationHash}</dt><dd><code>{booking.quotationHash}</code></dd></div>
              </dl>

              <section className="booking-timeline" aria-label={messages.timelineTitle}>
                <h3>{messages.timelineTitle}</h3>
                <ol>
                  {stages.map((stage, index) => (
                    <li className={index <= current ? 'is-complete' : ''} key={stage}>
                      <span aria-hidden="true">{index + 1}</span>
                      <div><strong>{stage}</strong><small>{index <= current ? messages.complete : messages.pending}</small></div>
                    </li>
                  ))}
                </ol>
              </section>

              {continuityMessages ? (
                <NextActionCard
                  action={{ ...deriveBookingStage(booking.status), primaryAction: null, paymentRequestId: null, bookingId: booking.id }}
                  compact
                  locale={locale}
                  messages={continuityMessages}
                />
              ) : null}

              {booking.voucher ? (
                <>
                <section className="customer-voucher" aria-labelledby={`voucher-title-${booking.voucher.id}`}>
                  <header>
                    <div>
                      <span className="eyebrow">{messages.voucherEyebrow}</span>
                      <h3 id={`voucher-title-${booking.voucher.id}`}>{booking.voucher.title}</h3>
                      <p>{booking.voucher.summary}</p>
                    </div>
                    <div className="voucher-version">
                      <span>{messages.voucherVersion}</span>
                      <strong>{booking.voucher.versionNumber}</strong>
                    </div>
                  </header>
                  <dl className="booking-facts">
                    <div><dt>{messages.supplier}</dt><dd>{booking.voucher.supplierName}</dd></div>
                    <div><dt>{messages.supplierReference}</dt><dd>{booking.voucher.confirmationReference}</dd></div>
                    <div><dt>{messages.issuedAt}</dt><dd>{new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.voucher.issuedAt))}</dd></div>
                    <div className="booking-hash"><dt>{messages.voucherHash}</dt><dd><code>{booking.voucher.voucherHash}</code></dd></div>
                  </dl>
                  <p className="voucher-confirmation-summary">{booking.voucher.confirmationSummary}</p>
                  <section className="voucher-services" aria-label={messages.services}>
                    <h4>{messages.services}</h4>
                    <ol>
                      {booking.voucher.services.map((service) => (
                        <li key={`${service.sequence}-${service.title}`}>
                          <span>{messages.serviceCategories[service.category]}</span>
                          <h5>{service.title}</h5>
                          <p>{service.details}</p>
                          {service.serviceDate ? <small>{messages.serviceDate}: {service.serviceDate}</small> : null}
                          {service.customerReference ? <small>{messages.customerReference}: {service.customerReference}</small> : null}
                        </li>
                      ))}
                    </ol>
                  </section>
                  <div className="voucher-support">
                    <strong>{messages.supportContact}</strong>
                    <span>{booking.voucher.supportContact}</span>
                  </div>
                  {booking.voucher.customerNotes ? <p><strong>{messages.customerNotes}:</strong> {booking.voucher.customerNotes}</p> : null}
                  <p className="authority-note">{messages.privateDelivery}</p>
                </section>
                <CustomerSupportPanel
                  bookingId={booking.id}
                  cases={supportCases.filter((item) => item.bookingId === booking.id)}
                  locale={locale}
                  messages={supportMessages}
                />
                </>
              ) : booking.status === 'VERIFICATION_REJECTED' ? (
                <section className="readiness-record verification-rejected">
                  <h3>{messages.rejectedTitle}</h3>
                  <p>{messages.rejectedBody}</p>
                </section>
              ) : ['BOOKING_VERIFIED', 'VOUCHER_DRAFTED'].includes(booking.status) ? (
                <section className="readiness-record">
                  <h3>{messages.verifiedTitle}</h3>
                  <p>{messages.verifiedBody}</p>
                  <p className="authority-note">{messages.voucherPreparing}</p>
                </section>
              ) : ['SUPPLIER_CONFIRMED', 'UNDER_VERIFICATION'].includes(booking.status) ? (
                <section className="readiness-record">
                  <h3>{messages.confirmedTitle}</h3>
                  <p>{messages.confirmedBody}</p>
                  <p className="authority-note">{messages.notVerified}</p>
                </section>
              ) : (
                <section className="readiness-record">
                  <h3>{messages.waitingTitle}</h3>
                  <p>{messages.waitingBody}</p>
                </section>
              )}
            </article>
          );
        })}
      </div>
      <p className="authority-note">{messages.boundary}</p>
      {continuityMessages && proposalHref ? (
        <Link className="button button-outline-dark trip-room-back-link" href={proposalHref}>
          {continuityMessages.ctaBackToProposal}
        </Link>
      ) : null}
    </section>
  );
}
