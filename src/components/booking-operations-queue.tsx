'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { BookingCommandResult, BookingOperationsCase } from '@/server/booking/contract';
import type { FulfilmentCommandResult } from '@/server/fulfilment/contract';

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

function BookingOperationsCard({
  item,
  locale,
  messages,
  canVerify,
  viewerId
}: {
  item: BookingOperationsCase;
  locale: Locale;
  messages: Dictionary['bookingStaff'];
  canVerify: boolean;
  viewerId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const booking = item.booking;
  const canIndependentlyVerify = Boolean(
    canVerify && booking?.execution && booking.confirmation
    && booking.execution.executedBy !== viewerId
    && booking.confirmation.capturedBy !== viewerId
  );

  async function execute(body: object, endpoint = '/api/v1/staff/bookings') {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(body)
      });
      const result = await response.json() as (BookingCommandResult | FulfilmentCommandResult) & { error?: string };
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

  function createBooking() {
    void execute({
      action: 'booking.create',
      paymentRequestId: item.financialReadiness.paymentRequestId,
      readinessEvaluationId: item.financialReadiness.readinessEvaluationId,
      readinessHash: item.financialReadiness.readinessHash
    });
  }

  async function recordExecution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking) return;
    const form = new FormData(event.currentTarget);
    await execute({
      action: 'supplier_booking.complete',
      bookingId: booking.id,
      execution: {
        channel: form.get('channel'),
        supplierName: form.get('supplierName'),
        executedAt: new Date(String(form.get('executedAt'))).toISOString(),
        requestReference: form.get('requestReference'),
        serviceSummary: form.get('serviceSummary'),
        note: form.get('note'),
        declarationConfirmed: form.get('declarationConfirmed') === 'on'
      }
    });
  }

  async function captureConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking?.execution) return;
    const form = new FormData(event.currentTarget);
    await execute({
      action: 'supplier_confirmation.capture',
      bookingId: booking.id,
      executionId: booking.execution.id,
      executionHash: booking.execution.executionHash,
      confirmation: {
        channel: form.get('channel'),
        confirmedAt: new Date(String(form.get('confirmedAt'))).toISOString(),
        confirmationReference: form.get('confirmationReference'),
        serviceSummary: form.get('serviceSummary'),
        note: form.get('note'),
        declarationConfirmed: form.get('declarationConfirmed') === 'on'
      }
    });
  }

  function startVerification() {
    if (!booking?.execution || !booking.confirmation) return;
    void execute({
      action: 'booking.verification.start',
      bookingId: booking.id,
      executionId: booking.execution.id,
      executionHash: booking.execution.executionHash,
      supplierConfirmationId: booking.confirmation.id,
      supplierConfirmationVersion: booking.confirmation.versionNumber,
      supplierConfirmationHash: booking.confirmation.confirmationHash
    }, '/api/v1/staff/fulfilment');
  }

  async function decideVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking?.execution || !booking.confirmation || !booking.verificationReview) return;
    const form = new FormData(event.currentTarget);
    await execute({
      action: 'booking.verify',
      bookingId: booking.id,
      reviewId: booking.verificationReview.id,
      executionId: booking.execution.id,
      executionHash: booking.execution.executionHash,
      supplierConfirmationId: booking.confirmation.id,
      supplierConfirmationVersion: booking.confirmation.versionNumber,
      supplierConfirmationHash: booking.confirmation.confirmationHash,
      verification: {
        decision: form.get('decision'),
        reason: form.get('reason'),
        checks: {
          customerDetailsMatch: form.get('customerDetailsMatch') === 'on',
          datesAndServicesMatch: form.get('datesAndServicesMatch') === 'on',
          supplierReferenceValidated: form.get('supplierReferenceValidated') === 'on',
          priceAndTermsMatch: form.get('priceAndTermsMatch') === 'on'
        },
        declarationConfirmed: form.get('verificationDeclaration') === 'on'
      }
    }, '/api/v1/staff/fulfilment');
  }

  async function correctConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking?.execution || !booking.confirmation || !booking.verification) return;
    const form = new FormData(event.currentTarget);
    await execute({
      action: 'supplier_confirmation.correct',
      bookingId: booking.id,
      executionId: booking.execution.id,
      executionHash: booking.execution.executionHash,
      supplierConfirmationId: booking.confirmation.id,
      supplierConfirmationHash: booking.confirmation.confirmationHash,
      verificationId: booking.verification.id,
      verificationHash: booking.verification.verificationHash,
      confirmation: {
        channel: form.get('channel'),
        confirmedAt: new Date(String(form.get('confirmedAt'))).toISOString(),
        confirmationReference: form.get('confirmationReference'),
        serviceSummary: form.get('serviceSummary'),
        note: form.get('note'),
        declarationConfirmed: form.get('declarationConfirmed') === 'on'
      }
    }, '/api/v1/staff/fulfilment');
  }

  async function createVoucherDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking?.execution || !booking.confirmation || !booking.verification) return;
    const form = new FormData(event.currentTarget);
    await execute({
      action: 'voucher.draft.create',
      bookingId: booking.id,
      verificationId: booking.verification.id,
      verificationHash: booking.verification.verificationHash,
      executionId: booking.execution.id,
      executionHash: booking.execution.executionHash,
      supplierConfirmationId: booking.confirmation.id,
      supplierConfirmationVersion: booking.confirmation.versionNumber,
      supplierConfirmationHash: booking.confirmation.confirmationHash,
      content: {
        services: [{
          sequence: 1,
          category: form.get('serviceCategory'),
          title: form.get('serviceTitle'),
          details: form.get('serviceDetails'),
          serviceDate: form.get('serviceDate'),
          customerReference: form.get('customerReference')
        }],
        supportContact: form.get('supportContact'),
        customerNotes: form.get('customerNotes'),
        preparationSource: form.get('preparationSource'),
        declarationConfirmed: form.get('voucherDeclaration') === 'on'
      }
    }, '/api/v1/staff/fulfilment');
  }

  function issueVoucher() {
    if (!booking?.voucherRecord || !booking.verification) return;
    void execute({
      action: 'voucher.issue',
      bookingId: booking.id,
      verificationId: booking.verification.id,
      verificationHash: booking.verification.verificationHash,
      voucherId: booking.voucherRecord.id,
      versionNumber: booking.voucherRecord.currentVersion,
      voucherHash: booking.voucherRecord.currentHash
    }, '/api/v1/staff/fulfilment');
  }

  return (
    <article className="booking-operations-card">
      <header className="payment-card-header">
        <div>
          <span className="request-status">{booking ? messages.statusLabels[booking.status] : messages.noBooking}</span>
          <h2>{item.financialReadiness.title}</h2>
          <p>{messages.financiallyReady}</p>
        </div>
        <div className="payment-amount">
          <span>{messages.amount}</span>
          <strong>{money(item.financialReadiness.amountMinor, locale)}</strong>
        </div>
      </header>

      <dl className="booking-facts">
        <div><dt>{messages.customer}</dt><dd>{item.financialReadiness.customerId.slice(0, 8)}</dd></div>
        <div><dt>{messages.version}</dt><dd>{item.financialReadiness.versionNumber}</dd></div>
        <div><dt>{messages.readyAt}</dt><dd>{new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.financialReadiness.readyAt))}</dd></div>
        <div className="booking-hash"><dt>{messages.exactQuotationHash}</dt><dd><code>{item.financialReadiness.quotationHash}</code></dd></div>
        <div className="booking-hash"><dt>{messages.readinessHash}</dt><dd><code>{item.financialReadiness.readinessHash}</code></dd></div>
      </dl>

      {!booking ? (
        <button className="button button-primary" disabled={busy} onClick={createBooking} type="button">
          {busy ? messages.working : messages.createBooking}
        </button>
      ) : null}

      {booking?.status === 'CREATED' ? (
        <form className="booking-evidence-form" onSubmit={recordExecution}>
          <fieldset disabled={busy}>
            <legend>{messages.executionTitle}</legend>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.channel}</span>
                <select defaultValue="SUPPLIER_PORTAL" name="channel">
                  <option value="SUPPLIER_PORTAL">{messages.channels.SUPPLIER_PORTAL}</option>
                  <option value="EMAIL">{messages.channels.EMAIL}</option>
                  <option value="PHONE">{messages.channels.PHONE}</option>
                  <option value="MESSAGING">{messages.channels.MESSAGING}</option>
                </select>
              </label>
              <label><span>{messages.supplierName}</span><input maxLength={120} minLength={2} name="supplierName" required /></label>
              <label><span>{messages.executedAt}</span><input defaultValue={localDateTimeValue()} name="executedAt" required type="datetime-local" /></label>
              <label><span>{messages.requestReference}</span><input maxLength={120} minLength={3} name="requestReference" required /></label>
            </div>
            <label><span>{messages.serviceSummary}</span><textarea maxLength={500} minLength={3} name="serviceSummary" required rows={3} /></label>
            <label><span>{messages.note}</span><textarea maxLength={500} name="note" rows={3} /></label>
            <label className="check-label">
              <input name="declarationConfirmed" required type="checkbox" />
              <span>{messages.executionDeclaration}</span>
            </label>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.executeSupplier}</button>
          </fieldset>
        </form>
      ) : null}

      {booking?.execution ? (
        <section className="supplier-record" aria-label={messages.executionRecordTitle}>
          <h3>{messages.executionRecordTitle}</h3>
          <dl>
            <div><dt>{messages.supplierName}</dt><dd>{booking.execution.supplierName}</dd></div>
            <div><dt>{messages.channel}</dt><dd>{messages.channels[booking.execution.channel]}</dd></div>
            <div><dt>{messages.requestReference}</dt><dd>{booking.execution.requestReference}</dd></div>
            <div><dt>{messages.executedAt}</dt><dd>{new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.execution.executedAt))}</dd></div>
            <div className="booking-hash"><dt>{messages.executionHash}</dt><dd><code>{booking.execution.executionHash}</code></dd></div>
          </dl>
          <p>{booking.execution.serviceSummary}</p>
        </section>
      ) : null}

      {booking?.status === 'SUPPLIER_EXECUTED' && booking.execution ? (
        <form className="booking-evidence-form" onSubmit={captureConfirmation}>
          <fieldset disabled={busy}>
            <legend>{messages.confirmationTitle}</legend>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.confirmationChannel}</span>
                <select defaultValue="SUPPLIER_PORTAL" name="channel">
                  <option value="SUPPLIER_PORTAL">{messages.channels.SUPPLIER_PORTAL}</option>
                  <option value="EMAIL">{messages.channels.EMAIL}</option>
                  <option value="PHONE">{messages.channels.PHONE}</option>
                  <option value="MESSAGING">{messages.channels.MESSAGING}</option>
                </select>
              </label>
              <label><span>{messages.confirmedAt}</span><input defaultValue={localDateTimeValue()} name="confirmedAt" required type="datetime-local" /></label>
              <label><span>{messages.confirmationReference}</span><input maxLength={120} minLength={3} name="confirmationReference" required /></label>
            </div>
            <label><span>{messages.confirmationSummary}</span><textarea maxLength={500} minLength={3} name="serviceSummary" required rows={3} /></label>
            <label><span>{messages.confirmationNote}</span><textarea maxLength={500} name="note" rows={3} /></label>
            <label className="check-label">
              <input name="declarationConfirmed" required type="checkbox" />
              <span>{messages.confirmationDeclaration}</span>
            </label>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.captureConfirmation}</button>
          </fieldset>
        </form>
      ) : null}

      {booking?.confirmation ? (
        <section className="supplier-record supplier-confirmation-record" aria-label={messages.confirmationRecordTitle}>
          <h3>{messages.confirmationRecordTitle}</h3>
          <dl>
            <div><dt>{messages.confirmationVersion}</dt><dd>{booking.confirmation.versionNumber}</dd></div>
            <div><dt>{messages.confirmationChannel}</dt><dd>{messages.channels[booking.confirmation.channel]}</dd></div>
            <div><dt>{messages.confirmationReference}</dt><dd>{booking.confirmation.confirmationReference}</dd></div>
            <div><dt>{messages.confirmedAt}</dt><dd>{new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.confirmation.confirmedAt))}</dd></div>
            <div className="booking-hash"><dt>{messages.confirmationHash}</dt><dd><code>{booking.confirmation.confirmationHash}</code></dd></div>
          </dl>
          <p>{booking.confirmation.serviceSummary}</p>
        </section>
      ) : null}

      {booking?.status === 'SUPPLIER_CONFIRMED' && booking.execution && booking.confirmation ? (
        <section className="verification-gate" aria-labelledby={`verification-gate-${booking.id}`}>
          <h3 id={`verification-gate-${booking.id}`}>{messages.verificationTitle}</h3>
          <p>{messages.verificationBody}</p>
          {canIndependentlyVerify ? (
            <button className="button button-primary" disabled={busy} onClick={startVerification} type="button">
              {busy ? messages.working : messages.startVerification}
            </button>
          ) : <p className="authority-note">{messages.independentVerifierRequired}</p>}
        </section>
      ) : null}

      {booking?.status === 'UNDER_VERIFICATION' && booking.execution && booking.confirmation && booking.verificationReview ? (
        canIndependentlyVerify ? (
          <form className="booking-evidence-form" onSubmit={decideVerification}>
            <fieldset disabled={busy}>
              <legend>{messages.verificationDecisionTitle}</legend>
              <div className="verification-checklist">
                <label className="check-label"><input name="customerDetailsMatch" type="checkbox" /><span>{messages.checkCustomer}</span></label>
                <label className="check-label"><input name="datesAndServicesMatch" type="checkbox" /><span>{messages.checkServices}</span></label>
                <label className="check-label"><input name="supplierReferenceValidated" type="checkbox" /><span>{messages.checkReference}</span></label>
                <label className="check-label"><input name="priceAndTermsMatch" type="checkbox" /><span>{messages.checkTerms}</span></label>
              </div>
              <div className="form-grid form-grid-two">
                <label>
                  <span>{messages.decision}</span>
                  <select defaultValue="VERIFY" name="decision">
                    <option value="VERIFY">{messages.decisions.VERIFY}</option>
                    <option value="REJECT">{messages.decisions.REJECT}</option>
                  </select>
                </label>
                <label><span>{messages.reason}</span><input maxLength={500} minLength={8} name="reason" required /></label>
              </div>
              <label className="check-label">
                <input name="verificationDeclaration" required type="checkbox" />
                <span>{messages.verificationDeclaration}</span>
              </label>
              <button className="button button-primary" type="submit">{busy ? messages.working : messages.recordVerification}</button>
            </fieldset>
          </form>
        ) : <p className="authority-note">{messages.independentVerifierRequired}</p>
      ) : null}

      {booking?.verification ? (
        <section className={`supplier-record verification-record ${booking.verification.decision === 'REJECT' ? 'is-rejected' : 'is-verified'}`} aria-label={messages.verificationRecordTitle}>
          <h3>{messages.verificationRecordTitle}</h3>
          <dl>
            <div><dt>{messages.decision}</dt><dd>{messages.decisions[booking.verification.decision]}</dd></div>
            <div><dt>{messages.decidedAt}</dt><dd>{new Intl.DateTimeFormat(numberLocales[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.verification.decidedAt))}</dd></div>
            <div><dt>{messages.verifier}</dt><dd>{booking.verification.decidedBy.slice(0, 8)}</dd></div>
            <div className="booking-hash"><dt>{messages.verificationHash}</dt><dd><code>{booking.verification.verificationHash}</code></dd></div>
          </dl>
          <p>{booking.verification.reason}</p>
        </section>
      ) : null}

      {booking?.status === 'VERIFICATION_REJECTED' && booking.execution && booking.confirmation && booking.verification ? (
        <form className="booking-evidence-form correction-form" onSubmit={correctConfirmation}>
          <fieldset disabled={busy}>
            <legend>{messages.correctionTitle}</legend>
            <p>{messages.correctionBody}</p>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.confirmationChannel}</span>
                <select defaultValue="SUPPLIER_PORTAL" name="channel">
                  <option value="SUPPLIER_PORTAL">{messages.channels.SUPPLIER_PORTAL}</option>
                  <option value="EMAIL">{messages.channels.EMAIL}</option>
                  <option value="PHONE">{messages.channels.PHONE}</option>
                  <option value="MESSAGING">{messages.channels.MESSAGING}</option>
                </select>
              </label>
              <label><span>{messages.confirmedAt}</span><input defaultValue={localDateTimeValue()} name="confirmedAt" required type="datetime-local" /></label>
              <label><span>{messages.confirmationReference}</span><input maxLength={120} minLength={3} name="confirmationReference" required /></label>
            </div>
            <label><span>{messages.confirmationSummary}</span><textarea maxLength={500} minLength={3} name="serviceSummary" required rows={3} /></label>
            <label><span>{messages.confirmationNote}</span><textarea maxLength={500} name="note" rows={3} /></label>
            <label className="check-label"><input name="declarationConfirmed" required type="checkbox" /><span>{messages.correctionDeclaration}</span></label>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.correctConfirmation}</button>
          </fieldset>
        </form>
      ) : null}

      {booking && ['BOOKING_VERIFIED', 'VOUCHER_DRAFTED'].includes(booking.status) && booking.execution && booking.confirmation && booking.verification ? (
        <form className="booking-evidence-form voucher-form" onSubmit={createVoucherDraft}>
          <fieldset disabled={busy}>
            <legend>{booking.voucherRecord ? messages.reviseVoucherTitle : messages.voucherTitle}</legend>
            <p>{messages.voucherBody}</p>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.serviceCategory}</span>
                <select defaultValue="OTHER" name="serviceCategory">
                  <option value="FLIGHT">{messages.serviceCategories.FLIGHT}</option>
                  <option value="HOTEL">{messages.serviceCategories.HOTEL}</option>
                  <option value="TRANSFER">{messages.serviceCategories.TRANSFER}</option>
                  <option value="ACTIVITY">{messages.serviceCategories.ACTIVITY}</option>
                  <option value="OTHER">{messages.serviceCategories.OTHER}</option>
                </select>
              </label>
              <label><span>{messages.serviceTitle}</span><input maxLength={120} minLength={2} name="serviceTitle" required /></label>
              <label><span>{messages.serviceDate}</span><input name="serviceDate" type="date" /></label>
              <label><span>{messages.customerReference}</span><input maxLength={120} name="customerReference" /></label>
            </div>
            <label><span>{messages.serviceDetails}</span><textarea defaultValue={booking.confirmation.serviceSummary} maxLength={500} minLength={3} name="serviceDetails" required rows={4} /></label>
            <div className="form-grid form-grid-two">
              <label><span>{messages.supportContact}</span><input maxLength={120} minLength={3} name="supportContact" required /></label>
              <label>
                <span>{messages.preparationSource}</span>
                <select defaultValue="HUMAN" name="preparationSource">
                  <option value="HUMAN">{messages.preparationSources.HUMAN}</option>
                  <option value="AI_ASSISTED">{messages.preparationSources.AI_ASSISTED}</option>
                </select>
              </label>
            </div>
            <label><span>{messages.customerNotes}</span><textarea maxLength={500} name="customerNotes" rows={3} /></label>
            <label className="check-label"><input name="voucherDeclaration" required type="checkbox" /><span>{messages.voucherDeclaration}</span></label>
            <button className="button button-secondary" type="submit">{busy ? messages.working : messages.createVoucherDraft}</button>
          </fieldset>
        </form>
      ) : null}

      {booking?.voucherRecord ? (
        <section className="supplier-record voucher-record" aria-label={messages.voucherRecordTitle}>
          <h3>{messages.voucherRecordTitle}</h3>
          <dl>
            <div><dt>{messages.voucherStatus}</dt><dd>{messages.voucherStatuses[booking.voucherRecord.status]}</dd></div>
            <div><dt>{messages.voucherVersion}</dt><dd>{booking.voucherRecord.currentVersion}</dd></div>
            <div className="booking-hash"><dt>{messages.voucherHash}</dt><dd><code>{booking.voucherRecord.currentHash}</code></dd></div>
          </dl>
          {booking.voucherRecord.status === 'DRAFT' ? <p className="authority-note">{messages.draftNotVisible}</p> : <p>{messages.issuedVoucher}</p>}
          {booking.voucherRecord.status === 'DRAFT' && canVerify ? (
            <button className="button button-primary" disabled={busy} onClick={issueVoucher} type="button">
              {busy ? messages.working : messages.issueVoucher}
            </button>
          ) : null}
        </section>
      ) : null}

      <p className="authority-note">{messages.boundary}</p>
      <p aria-live="polite" className="form-status">{status}</p>
    </article>
  );
}

export function BookingOperationsQueue({
  cases,
  locale,
  messages,
  canVerify,
  viewerId
}: {
  cases: BookingOperationsCase[];
  locale: Locale;
  messages: Dictionary['bookingStaff'];
  canVerify: boolean;
  viewerId: string;
}) {
  return (
    <section className="booking-operations-workspace" aria-labelledby="booking-queue-title">
      <div className="section-heading section-heading-wide">
        <span className="eyebrow">{messages.eyebrow}</span>
        <h2 id="booking-queue-title">{messages.queueTitle}</h2>
        <p>{messages.queueBody}</p>
      </div>
      <p className="authority-note">{messages.authorityNote}</p>
      {cases.length === 0 ? <div className="empty-state"><p>{messages.empty}</p></div> : (
        <div className="booking-operations-list">
          {cases.map((item) => (
            <BookingOperationsCard
              item={item}
              key={item.financialReadiness.paymentRequestId}
              locale={locale}
              messages={messages}
              canVerify={canVerify}
              viewerId={viewerId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
