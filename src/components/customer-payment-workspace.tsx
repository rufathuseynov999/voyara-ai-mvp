'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type {
  CustomerPaymentRequestView,
  PaymentCommandResult,
  PaymentRequestStatus
} from '@/server/payment/contract';

const numberLocales: Record<Locale, string> = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };
const stageKeys = ['request', 'evidence', 'review', 'verified', 'allocation', 'readiness'] as const;
const statusStage: Record<PaymentRequestStatus, number> = {
  REQUESTED: 0,
  EVIDENCE_RECEIVED: 1,
  UNDER_REVIEW: 2,
  EVIDENCE_REJECTED: 1,
  VERIFIED: 3,
  ALLOCATED: 4,
  READY_FOR_BOOKING: 5
};

function money(minor: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocales[locale], {
    style: 'currency',
    currency: 'AZN',
    minimumFractionDigits: 2
  }).format(minor / 100);
}

function localDateTimeValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function PaymentCard({
  locale,
  messages,
  payment
}: {
  locale: Locale;
  messages: Dictionary['paymentCustomer'];
  payment: CustomerPaymentRequestView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const currentStage = statusStage[payment.status];
  const canSubmitEvidence = ['REQUESTED', 'EVIDENCE_REJECTED'].includes(payment.status);

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/api/v1/customer/payments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify({
          action: 'payment.evidence.submit',
          paymentRequestId: payment.id,
          channel: form.get('channel'),
          evidence: {
            amountAzn: form.get('amountAzn'),
            observedAt: new Date(String(form.get('observedAt'))).toISOString(),
            externalReference: form.get('externalReference'),
            note: form.get('note'),
            declarationConfirmed: form.get('declarationConfirmed') === 'on'
          }
        })
      });
      const result = await response.json() as PaymentCommandResult & { error?: string };
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
    <article className="payment-card">
      <header className="payment-card-header">
        <div>
          <span className="request-status">{messages.statusLabels[payment.status]}</span>
          <h2>{messages.request}</h2>
          <code>{payment.id}</code>
        </div>
        <div className="payment-amount">
          <span>{messages.amount}</span>
          <strong>{money(payment.amountMinor, locale)}</strong>
        </div>
      </header>

      <dl className="payment-facts">
        <div><dt>{messages.quotationVersion}</dt><dd>{payment.versionNumber}</dd></div>
        <div><dt>{messages.status}</dt><dd>{messages.statusLabels[payment.status]}</dd></div>
        <div className="payment-hash"><dt>SHA-256</dt><dd><code>{payment.quotationHash}</code></dd></div>
      </dl>

      <section className="payment-timeline" aria-labelledby={`timeline-${payment.id}`}>
        <h3 id={`timeline-${payment.id}`}>{messages.timelineTitle}</h3>
        <ol>
          {stageKeys.map((key, index) => (
            <li
              className={`${index <= currentStage ? 'is-complete' : ''} ${index === currentStage ? 'is-current' : ''}`.trim()}
              key={key}
            >
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{messages.stages[key]}</strong>
                <small>{index <= currentStage ? messages.complete : messages.pending}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="authority-note">{messages.boundary}</p>

      {canSubmitEvidence ? (
        <form className="payment-evidence-form" onSubmit={submitEvidence}>
          <fieldset disabled={busy}>
            <legend>{messages.evidenceTitle}</legend>
            <p>{messages.evidenceBody}</p>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.channel}</span>
                <select defaultValue="BANK_TRANSFER_REFERENCE" name="channel">
                  <option value="BANK_TRANSFER_REFERENCE">{messages.channels.BANK_TRANSFER_REFERENCE}</option>
                  <option value="CARD_PAYMENT_REFERENCE">{messages.channels.CARD_PAYMENT_REFERENCE}</option>
                </select>
              </label>
              <label>
                <span>{messages.amount}</span>
                <input defaultValue={(payment.amountMinor / 100).toFixed(2)} inputMode="decimal" name="amountAzn" pattern="\d{1,10}(\.\d{1,2})?" required />
              </label>
              <label>
                <span>{messages.observedAt}</span>
                <input defaultValue={localDateTimeValue()} name="observedAt" required type="datetime-local" />
              </label>
              <label>
                <span>{messages.reference}</span>
                <input maxLength={120} minLength={3} name="externalReference" required />
              </label>
            </div>
            <label>
              <span>{messages.note}</span>
              <textarea maxLength={500} name="note" rows={3} />
            </label>
            <label className="check-label">
              <input name="declarationConfirmed" required type="checkbox" />
              <span>{messages.declaration}</span>
            </label>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.submitEvidence}</button>
          </fieldset>
        </form>
      ) : null}

      {payment.status === 'READY_FOR_BOOKING' ? (
        <section className="readiness-record" aria-label={messages.readyTitle}>
          <h3>{messages.readyTitle}</h3>
          <p>{messages.readyBody}</p>
          <p>{messages.notBooking}</p>
        </section>
      ) : null}
      <p aria-live="polite" className="form-status">{status}</p>
    </article>
  );
}

export function CustomerPaymentWorkspace({
  locale,
  messages,
  payments
}: {
  locale: Locale;
  messages: Dictionary['paymentCustomer'];
  payments: CustomerPaymentRequestView[];
}) {
  if (payments.length === 0) return <div className="empty-state"><p>{messages.empty}</p></div>;
  return (
    <section className="payment-card-list">
      {payments.map((payment) => (
        <PaymentCard key={payment.id} locale={locale} messages={messages} payment={payment} />
      ))}
    </section>
  );
}
