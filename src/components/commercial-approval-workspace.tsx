'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type {
  CommercialCommandResult,
  CommercialStaffCase,
  QuotationRiskFlag
} from '@/server/commercial/contract';
import { quotationRiskFlags } from '@/server/commercial/contract';

function minorToAzn(value: number): string {
  return (value / 100).toFixed(2);
}

function CommercialCaseCard({
  item,
  messages,
  viewerId,
  viewerIsFounder
}: {
  item: CommercialStaffCase;
  messages: Dictionary['commercialStaff'];
  viewerId: string;
  viewerIsFounder: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [lineCount, setLineCount] = useState(Math.max(1, item.quotation?.payload.customer.lineItems.length ?? 1));
  const quotation = item.quotation;
  const editable = item.travelRequest.assignedStaffId === viewerId
    && (!quotation || quotation.status === 'DRAFT' || quotation.status === 'REJECTED');
  const draft = quotation?.payload;

  async function execute(body: object) {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/api/v1/staff/commercial', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(body)
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

  async function saveVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const descriptions = form.getAll('lineDescription');
    const quantities = form.getAll('lineQuantity');
    const unitPrices = form.getAll('lineUnitPrice');
    const selectedRiskFlags = form.getAll('riskFlags') as QuotationRiskFlag[];
    const rawValidity = String(form.get('validUntil') ?? '');
    const validUntil = new Date(rawValidity).toISOString();

    await execute({
      action: 'quotation.create_version',
      travelRequestId: item.travelRequest.id,
      quotationId: quotation?.id,
      draft: {
        locale: item.travelRequest.locale,
        title: form.get('title'),
        summary: form.get('summary'),
        lineItems: descriptions.map((description, index) => ({
          description,
          quantity: quantities[index],
          unitPriceAzn: unitPrices[index]
        })),
        serviceFeeAzn: form.get('serviceFeeAzn'),
        discountAzn: form.get('discountAzn'),
        costTotalAzn: form.get('costTotalAzn'),
        validUntil,
        customerNotes: form.get('customerNotes'),
        riskFlags: selectedRiskFlags
      }
    });
  }

  function exact(action: 'quotation.submit_for_approval' | 'quotation.publish') {
    if (!quotation) return;
    void execute({
      action,
      quotationId: quotation.id,
      versionNumber: quotation.versionNumber,
      quotationHash: quotation.payloadHash
    });
  }

  function decide(decision: 'APPROVE' | 'REJECT') {
    if (!quotation) return;
    void execute({
      action: 'quotation.decide',
      quotationId: quotation.id,
      versionNumber: quotation.versionNumber,
      quotationHash: quotation.payloadHash,
      decision,
      reason
    });
  }

  return (
    <article className="commercial-case-card">
      <header className="commercial-case-header">
        <div>
          <span className="request-status">{quotation ? messages.statusLabels[quotation.status] : messages.notStarted}</span>
          <h2>{item.travelRequest.destination}</h2>
          <p>{item.travelRequest.departureCity} · {item.travelRequest.departureDate} — {item.travelRequest.returnDate}</p>
        </div>
        <div className="hash-block">
          <span>{messages.requestHash}</span>
          <code title={item.travelRequest.payloadHash}>{item.travelRequest.payloadHash.slice(0, 16)}</code>
        </div>
      </header>

      <dl className="commercial-source-facts">
        <div><dt>{messages.customer}</dt><dd>{item.travelRequest.customerId.slice(0, 8)}</dd></div>
        <div><dt>{messages.assignedOperator}</dt><dd>{item.travelRequest.assignedStaffId === viewerId ? messages.assignedToMe : item.travelRequest.assignedStaffId.slice(0, 8)}</dd></div>
        <div><dt>{messages.requestVersion}</dt><dd>{item.travelRequest.versionNumber}</dd></div>
        <div><dt>{messages.budget}</dt><dd>{item.travelRequest.budgetAzn.toLocaleString('en-US')} AZN</dd></div>
        <div><dt>{messages.language}</dt><dd>{item.travelRequest.locale.toUpperCase()}</dd></div>
      </dl>

      {quotation ? (
        <section className="quotation-authority-summary" aria-label={messages.exactVersion}>
          <div><span>{messages.exactVersion}</span><strong>{quotation.versionNumber}</strong></div>
          <div className="quotation-hash"><span>SHA-256</span><code title={quotation.payloadHash}>{quotation.payloadHash}</code></div>
          <div><span>{messages.total}</span><strong>{minorToAzn(quotation.payload.customer.totalMinor)} AZN</strong></div>
          <div><span>{messages.grossProfit}</span><strong>{minorToAzn(quotation.payload.commercial.grossProfitMinor)} AZN</strong></div>
          <div><span>{messages.margin}</span><strong>{(quotation.payload.commercial.grossMarginBps / 100).toFixed(2)}%</strong></div>
        </section>
      ) : null}

      {editable ? (
        <form className="commercial-draft-form" onSubmit={saveVersion}>
          <fieldset disabled={busy}>
            <legend>{quotation ? messages.reviseTitle : messages.createTitle}</legend>
            <p>{messages.createBody}</p>
            <div className="form-grid form-grid-two">
              <label><span>{messages.title}</span><input defaultValue={draft?.customer.title} maxLength={120} minLength={3} name="title" required /></label>
              <label><span>{messages.validUntil}</span><input defaultValue={draft?.customer.validUntil.slice(0, 16)} name="validUntil" required type="datetime-local" /></label>
            </div>
            <label><span>{messages.summary}</span><textarea defaultValue={draft?.customer.summary} maxLength={1_200} minLength={10} name="summary" required rows={4} /></label>

            <fieldset className="nested-fieldset line-items-fieldset">
              <legend>{messages.lineItems}</legend>
              {Array.from({ length: lineCount }, (_, index) => {
                const existing = draft?.customer.lineItems[index];
                return (
                  <div className="quotation-line" key={index}>
                    <label><span>{messages.description}</span><input defaultValue={existing?.description} maxLength={160} minLength={2} name="lineDescription" required /></label>
                    <label><span>{messages.quantity}</span><input defaultValue={existing?.quantity ?? 1} max={100} min={1} name="lineQuantity" required type="number" /></label>
                    <label><span>{messages.unitPrice}</span><input defaultValue={existing ? minorToAzn(existing.unitPriceMinor) : ''} inputMode="decimal" name="lineUnitPrice" pattern="\d{1,10}(\.\d{1,2})?" required /></label>
                  </div>
                );
              })}
              <div className="line-item-actions">
                <button className="button button-outline-dark" disabled={lineCount >= 20} onClick={() => setLineCount((count) => count + 1)} type="button">{messages.addLine}</button>
                <button className="button button-outline-dark" disabled={lineCount <= 1} onClick={() => setLineCount((count) => count - 1)} type="button">{messages.removeLine}</button>
              </div>
            </fieldset>

            <div className="form-grid form-grid-three">
              <label><span>{messages.serviceFee}</span><input defaultValue={draft ? minorToAzn(draft.customer.serviceFeeMinor) : '0.00'} inputMode="decimal" name="serviceFeeAzn" pattern="\d{1,10}(\.\d{1,2})?" required /></label>
              <label><span>{messages.discount}</span><input defaultValue={draft ? minorToAzn(draft.customer.discountMinor) : '0.00'} inputMode="decimal" name="discountAzn" pattern="\d{1,10}(\.\d{1,2})?" required /></label>
              <label><span>{messages.costTotal}</span><input defaultValue={draft ? minorToAzn(draft.commercial.costTotalMinor) : ''} inputMode="decimal" name="costTotalAzn" pattern="\d{1,10}(\.\d{1,2})?" required /></label>
            </div>
            <label><span>{messages.customerNotes}</span><textarea defaultValue={draft?.customer.customerNotes} maxLength={1_200} name="customerNotes" rows={3} /></label>

            <fieldset className="nested-fieldset risk-fieldset">
              <legend>{messages.riskFlags}</legend>
              <div className="risk-options">
                {quotationRiskFlags.map((flag) => (
                  <label className="check-label" key={flag}>
                    <input defaultChecked={draft?.riskFlags.includes(flag)} name="riskFlags" type="checkbox" value={flag} />
                    <span>{messages.riskLabels[flag]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="authority-note">{messages.aiBoundary}</p>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.saveVersion}</button>
          </fieldset>
        </form>
      ) : null}

      {!editable && (!quotation || quotation.status === 'DRAFT' || quotation.status === 'REJECTED') ? (
        <p className="authority-note">{messages.draftOwnerOnly}</p>
      ) : null}

      {quotation?.lastDecision ? (
        <p className="decision-note"><strong>{messages.lastDecision}:</strong> {messages.decisionLabels[quotation.lastDecision.decision]} — {quotation.lastDecision.reason}</p>
      ) : null}

      <div className="commercial-actions">
        {quotation?.status === 'DRAFT' ? (
          <button className="button button-primary" disabled={busy} onClick={() => exact('quotation.submit_for_approval')} type="button">{messages.submitApproval}</button>
        ) : null}
        {quotation?.status === 'PENDING_APPROVAL' && viewerIsFounder ? (
          <div className="founder-decision-panel">
            <label><span>{messages.decisionReason}</span><textarea maxLength={500} minLength={3} onChange={(event) => setReason(event.target.value)} rows={3} value={reason} /></label>
            <div className="form-actions">
              <button className="button button-primary" disabled={busy || reason.trim().length < 3} onClick={() => decide('APPROVE')} type="button">{messages.approve}</button>
              <button className="button button-danger" disabled={busy || reason.trim().length < 3} onClick={() => decide('REJECT')} type="button">{messages.reject}</button>
            </div>
          </div>
        ) : null}
        {quotation?.status === 'PENDING_APPROVAL' && !viewerIsFounder ? <p className="authority-note">{messages.founderOnly}</p> : null}
        {quotation?.status === 'APPROVED' && viewerIsFounder ? (
          <button className="button button-primary" disabled={busy} onClick={() => exact('quotation.publish')} type="button">{messages.publish}</button>
        ) : null}
      </div>
      <p aria-live="polite" className="form-status">{status}</p>
    </article>
  );
}

export function CommercialApprovalWorkspace({
  initialCases,
  messages,
  viewerId,
  viewerIsFounder
}: {
  initialCases: CommercialStaffCase[];
  messages: Dictionary['commercialStaff'];
  viewerId: string;
  viewerIsFounder: boolean;
}) {
  return (
    <section className="commercial-workspace" aria-labelledby="commercial-queue-title">
      <div className="section-heading section-heading-wide">
        <span className="eyebrow">{messages.eyebrow}</span>
        <h2 id="commercial-queue-title">{messages.queueTitle}</h2>
        <p>{messages.queueBody}</p>
      </div>
      <p className="authority-note">{messages.authorityNote}</p>
      {initialCases.length === 0 ? <div className="empty-state"><p>{messages.empty}</p></div> : (
        <div className="commercial-case-list">
          {initialCases.map((item) => (
            <CommercialCaseCard item={item} key={item.travelRequest.id} messages={messages} viewerId={viewerId} viewerIsFounder={viewerIsFounder} />
          ))}
        </div>
      )}
    </section>
  );
}
