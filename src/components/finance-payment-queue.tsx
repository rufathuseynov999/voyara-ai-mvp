'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { FinancePaymentCase, PaymentCommandResult } from '@/server/payment/contract';

const numberLocales: Record<Locale, string> = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };

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

function FinanceCaseCard({
  item,
  locale,
  messages,
  viewerCanAllocate
}: {
  item: FinancePaymentCase;
  locale: Locale;
  messages: Dictionary['paymentStaff'];
  viewerCanAllocate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const payment = item.payment;

  async function execute(body: object) {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/api/v1/staff/payments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(body)
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

  function createRequest() {
    void execute({
      action: 'payment_request.create',
      quotationId: item.quotation.id,
      versionNumber: item.quotation.versionNumber,
      quotationHash: item.quotation.payloadHash
    });
  }

  async function recordDetection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment) return;
    const form = new FormData(event.currentTarget);
    await execute({
      action: 'payment.detection.record',
      paymentRequestId: payment.id,
      channel: form.get('channel'),
      evidence: {
        amountAzn: form.get('amountAzn'),
        observedAt: new Date(String(form.get('observedAt'))).toISOString(),
        externalReference: form.get('externalReference'),
        note: form.get('note'),
        declarationConfirmed: form.get('declarationConfirmed') === 'on'
      }
    });
  }

  function startReview() {
    if (!payment?.currentEvidence) return;
    void execute({
      action: 'payment.review.start',
      paymentRequestId: payment.id,
      evidenceId: payment.currentEvidence.id,
      evidenceHash: payment.currentEvidence.evidenceHash
    });
  }

  function decide(decision: 'VERIFY' | 'REJECT') {
    if (!payment?.currentEvidence) return;
    void execute({
      action: 'payment.verify',
      paymentRequestId: payment.id,
      evidenceId: payment.currentEvidence.id,
      evidenceHash: payment.currentEvidence.evidenceHash,
      decision,
      reason
    });
  }

  function allocate() {
    if (!payment?.verification) return;
    void execute({
      action: 'funds.allocate',
      paymentRequestId: payment.id,
      verificationId: payment.verification.id,
      verificationHash: payment.verification.verificationHash
    });
  }

  function evaluateReadiness() {
    if (!payment?.allocation) return;
    void execute({
      action: 'payment.evaluate_readiness',
      paymentRequestId: payment.id,
      allocationId: payment.allocation.id,
      allocationHash: payment.allocation.allocationHash
    });
  }

  return (
    <article className="finance-case-card">
      <header className="payment-card-header">
        <div>
          <span className="request-status">{payment ? messages.statusLabels[payment.status] : messages.noRequest}</span>
          <h2>{item.quotation.title}</h2>
          <p>{messages.acceptedQuotation}</p>
        </div>
        <div className="payment-amount">
          <span>{messages.amount}</span>
          <strong>{money(item.quotation.amountMinor, locale)}</strong>
        </div>
      </header>

      <dl className="payment-facts">
        <div><dt>{messages.customer}</dt><dd>{item.quotation.customerId.slice(0, 8)}</dd></div>
        <div><dt>{messages.version}</dt><dd>{item.quotation.versionNumber}</dd></div>
        <div><dt>{messages.acceptedAt}</dt><dd>{new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.quotation.acceptedAt))}</dd></div>
        <div className="payment-hash"><dt>{messages.exactHash}</dt><dd><code>{item.quotation.payloadHash}</code></dd></div>
      </dl>

      {!payment ? (
        <button className="button button-primary" disabled={busy} onClick={createRequest} type="button">
          {busy ? messages.working : messages.createRequest}
        </button>
      ) : null}

      {payment && ['REQUESTED', 'EVIDENCE_REJECTED'].includes(payment.status) ? (
        <form className="payment-evidence-form" onSubmit={recordDetection}>
          <fieldset disabled={busy}>
            <legend>{messages.evidenceTitle}</legend>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.source}</span>
                <select defaultValue="BANK_STATEMENT" name="channel">
                  <option value="BANK_STATEMENT">{messages.channels.BANK_STATEMENT}</option>
                  <option value="ACQUIRER_DASHBOARD">{messages.channels.ACQUIRER_DASHBOARD}</option>
                </select>
              </label>
              <label>
                <span>{messages.evidenceAmount}</span>
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
            <label><span>{messages.note}</span><textarea maxLength={500} name="note" rows={3} /></label>
            <label className="check-label">
              <input name="declarationConfirmed" required type="checkbox" />
              <span>{messages.declaration}</span>
            </label>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.recordDetection}</button>
          </fieldset>
        </form>
      ) : null}

      {payment?.currentEvidence ? (
        <section className="finance-evidence-card">
          <div>
            <span>{messages.source}</span>
            <strong>{messages.channels[payment.currentEvidence.sourceKind]}</strong>
          </div>
          <div>
            <span>{messages.channels[payment.currentEvidence.channel]}</span>
            <strong>{payment.currentEvidence.externalReference}</strong>
          </div>
          <div>
            <span>{messages.evidenceAmount}</span>
            <strong>{money(payment.currentEvidence.amountMinor, locale)}</strong>
          </div>
          <div className="payment-hash">
            <span>{messages.evidenceHash}</span>
            <code>{payment.currentEvidence.evidenceHash}</code>
          </div>
          {payment.currentEvidence.note ? <p>{payment.currentEvidence.note}</p> : null}
        </section>
      ) : null}

      <div className="finance-actions">
        {payment?.status === 'EVIDENCE_RECEIVED' ? (
          <button className="button button-primary" disabled={busy} onClick={startReview} type="button">{messages.startReview}</button>
        ) : null}
        {payment?.status === 'UNDER_REVIEW' ? (
          <div className="finance-decision-panel">
            <label>
              <span>{messages.reviewReason}</span>
              <textarea maxLength={500} minLength={3} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
            </label>
            <div className="form-actions">
              <button className="button button-primary" disabled={busy || reason.trim().length < 3} onClick={() => decide('VERIFY')} type="button">{messages.verify}</button>
              <button className="button button-danger" disabled={busy || reason.trim().length < 3} onClick={() => decide('REJECT')} type="button">{messages.reject}</button>
            </div>
          </div>
        ) : null}
        {payment?.status === 'VERIFIED' && viewerCanAllocate ? (
          <button className="button button-primary" disabled={busy} onClick={allocate} type="button">{messages.allocate}</button>
        ) : null}
        {payment?.status === 'VERIFIED' && !viewerCanAllocate ? <p className="authority-note">{messages.restricted}</p> : null}
        {payment?.status === 'ALLOCATED' && viewerCanAllocate ? (
          <button className="button button-primary" disabled={busy} onClick={evaluateReadiness} type="button">{messages.evaluate}</button>
        ) : null}
        {payment?.status === 'ALLOCATED' && !viewerCanAllocate ? <p className="authority-note">{messages.restricted}</p> : null}
      </div>

      {payment?.verification?.decision === 'REJECT' ? (
        <p className="decision-note"><strong>{messages.reject}:</strong> {payment.verification.reason}</p>
      ) : null}
      <p className="authority-note">{messages.boundary}</p>
      <p aria-live="polite" className="form-status">{status}</p>
    </article>
  );
}

export function FinancePaymentQueue({
  cases,
  locale,
  messages,
  viewerCanAllocate
}: {
  cases: FinancePaymentCase[];
  locale: Locale;
  messages: Dictionary['paymentStaff'];
  viewerCanAllocate: boolean;
}) {
  return (
    <section className="finance-workspace" aria-labelledby="finance-queue-title">
      <div className="section-heading section-heading-wide">
        <span className="eyebrow">{messages.eyebrow}</span>
        <h2 id="finance-queue-title">{messages.queueTitle}</h2>
        <p>{messages.queueBody}</p>
      </div>
      <p className="authority-note">{messages.authorityNote}</p>
      {cases.length === 0 ? <div className="empty-state"><p>{messages.empty}</p></div> : (
        <div className="finance-case-list">
          {cases.map((item) => (
            <FinanceCaseCard
              item={item}
              key={item.quotation.id}
              locale={locale}
              messages={messages}
              viewerCanAllocate={viewerCanAllocate}
            />
          ))}
        </div>
      )}
    </section>
  );
}
