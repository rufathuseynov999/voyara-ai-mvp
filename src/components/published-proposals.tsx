'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { CommercialCommandResult, PublishedProposalView } from '@/server/commercial/contract';

const numberLocales: Record<Locale, string> = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };

/**
 * E.2B AZ hydration fix — root cause, precisely identified by diffing raw
 * SSR HTML against the post-hydration DOM for the same request:
 *
 *   Server (Node.js, full ICU)      Client (Chromium's bundled ICU)
 *   money:  "1.050,00 ₼"            "AZN 1,050.00"
 *   date:   "31 dek 2026, 00:00"    "2026 M12 31 00:00"
 *
 * Node's ICU has complete az-AZ locale data; the Chromium build bundled
 * with this environment's Playwright does not, and Intl.NumberFormat /
 * Intl.DateTimeFormat silently fall back to a generic, non-Azerbaijani
 * format instead of throwing — producing genuinely different text on
 * server vs client and triggering React hydration error #418. ru-RU and
 * en-US are unaffected (both environments have complete locale data for
 * those), confirmed by the same SSR-vs-hydrated diff coming back
 * byte-identical for ru/en.
 *
 * Fix: for az specifically, never delegate to Intl — use a small,
 * deterministic hand-rolled formatter so server and client always agree,
 * regardless of either runtime's ICU locale-data completeness. ru/en
 * continue using Intl unchanged, since that path is proven correct.
 */
const AZ_MONTH_ABBR = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];

function formatAzMoney(value: number): string {
  const fixed = value.toFixed(2);
  const [whole, fraction] = fixed.split('.');
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withThousands},${fraction} ₼`;
}

function formatAzDateTime(date: Date): string {
  const day = date.getUTCDate();
  const month = AZ_MONTH_ABBR[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

function money(minor: number, locale: Locale): string {
  if (locale === 'az') return formatAzMoney(minor / 100);
  return new Intl.NumberFormat(numberLocales[locale], {
    style: 'currency',
    currency: 'AZN',
    minimumFractionDigits: 2
  }).format(minor / 100);
}

function ProposalCard({
  locale,
  messages,
  proposal
}: {
  locale: Locale;
  messages: Dictionary['proposalLive'];
  proposal: PublishedProposalView;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const expired = new Date(proposal.validUntil).getTime() <= Date.now();

  async function accept() {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/api/v1/customer/commercial', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify({
          action: 'quotation.accept',
          quotationId: proposal.quotationId,
          versionNumber: proposal.versionNumber,
          quotationHash: proposal.payloadHash,
          locale,
          acceptanceConfirmed: confirmed
        })
      });
      const result = await response.json() as CommercialCommandResult & { error?: string };
      if (!response.ok || result.status !== 'accepted') {
        setStatus(`${messages.failed}${result.reasonCode ? ` (${result.reasonCode})` : ''}`);
        return;
      }
      setStatus(`${messages.accepted} ${messages.receipt} ${result.workReceiptId ?? ''}`.trim());
      router.refresh();
    } catch {
      setStatus(messages.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="published-proposal-card">
      <header className="proposal-header">
        <div>
          <span className="request-status">{proposal.status === 'ACCEPTED' ? messages.statusAccepted : expired ? messages.statusExpired : messages.statusPublished}</span>
          <h2>{proposal.customer.title}</h2>
          <p>{proposal.customer.summary}</p>
        </div>
        <div className="proposal-total">
          <span>{messages.total}</span>
          <strong>{money(proposal.customer.totalMinor, locale)}</strong>
        </div>
      </header>

      <div className="proposal-version-strip">
        <div><span>{messages.version}</span><strong>{proposal.versionNumber}</strong></div>
        <div><span>{messages.validUntil}</span><strong>{locale === 'az' ? formatAzDateTime(new Date(proposal.validUntil)) : new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(proposal.validUntil))}</strong></div>
        <div className="quotation-hash"><span>SHA-256</span><code>{proposal.payloadHash}</code></div>
      </div>

      <div className="proposal-line-table" role="table" aria-label={messages.lineItems}>
        <div className="proposal-line proposal-line-heading" role="row">
          <span role="columnheader">{messages.description}</span>
          <span role="columnheader">{messages.quantity}</span>
          <span role="columnheader">{messages.amount}</span>
        </div>
        {proposal.customer.lineItems.map((item) => (
          <div className="proposal-line" key={item.lineNumber} role="row">
            <span role="cell">{item.description}</span>
            <span role="cell">{item.quantity}</span>
            <span role="cell">{money(item.totalMinor, locale)}</span>
          </div>
        ))}
      </div>

      <dl className="proposal-totals">
        <div><dt>{messages.subtotal}</dt><dd>{money(proposal.customer.subtotalMinor, locale)}</dd></div>
        <div><dt>{messages.serviceFee}</dt><dd>{money(proposal.customer.serviceFeeMinor, locale)}</dd></div>
        <div><dt>{messages.discount}</dt><dd>− {money(proposal.customer.discountMinor, locale)}</dd></div>
        <div className="proposal-grand-total"><dt>{messages.total}</dt><dd>{money(proposal.customer.totalMinor, locale)}</dd></div>
      </dl>

      {proposal.customer.customerNotes ? <p className="proposal-notes"><strong>{messages.notes}:</strong> {proposal.customer.customerNotes}</p> : null}
      <p className="authority-note">{messages.viewingBoundary}</p>

      {proposal.status === 'PUBLISHED' && !expired ? (
        <section className="proposal-acceptance" aria-labelledby={`accept-${proposal.id}`}>
          <h3 id={`accept-${proposal.id}`}>{messages.acceptTitle}</h3>
          <p>{messages.acceptBody}</p>
          <label className="check-label">
            <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
            <span>{messages.confirmExact}</span>
          </label>
          <button className="button button-primary" disabled={busy || !confirmed} onClick={accept} type="button">{busy ? messages.working : messages.accept}</button>
        </section>
      ) : proposal.status === 'ACCEPTED' ? (
        <p className="acceptance-record">{messages.acceptedRecord} {proposal.acceptedAt ? (locale === 'az' ? formatAzDateTime(new Date(proposal.acceptedAt)) : new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(proposal.acceptedAt))) : ''}</p>
      ) : <p className="authority-note">{messages.expired}</p>}
      <p aria-live="polite" className="form-status">{status}</p>
    </article>
  );
}

export function PublishedProposals({
  locale,
  messages,
  proposals
}: {
  locale: Locale;
  messages: Dictionary['proposalLive'];
  proposals: PublishedProposalView[];
}) {
  if (proposals.length === 0) return <div className="empty-state"><p>{messages.empty}</p></div>;
  return <div className="published-proposal-list">{proposals.map((proposal) => <ProposalCard key={proposal.id} locale={locale} messages={messages} proposal={proposal} />)}</div>;
}
