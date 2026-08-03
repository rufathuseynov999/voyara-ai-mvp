'use client';

import { useState } from 'react';

/**
 * Phase 3B Part 3 — orchestration console (client).
 *
 * Connects the operational screens to the authenticated orchestration route.
 * The client supplies ONLY task inputs (quote id, traveller name, content
 * hash); actor, ownership, roles and assurance are derived server-side from the
 * session. Every response state is surfaced visibly: loading, success,
 * validation error, unauthorized (incl. demo sessions), stale approval,
 * expired offer, price change, payment mismatch, retry and the empty
 * authoritative state. All output remains simulation-labelled.
 */

export type OrchestrationLabels = {
  title: string; quoteId: string; run: string; search: string; loadStatus: string;
  submit: string; approve: string; present: string; accept: string;
  prepareIntent: string; simulateWebhook: string; reconcileExact: string;
  reconcilePartial: string; prepareBooking: string; checkVoucher: string;
  loadHealth: string; hash: string; traveller: string; loading: string;
  success: string; validationError: string; unauthorized: string;
  staleApproval: string; expired: string; priceChanged: string; mismatch: string;
  retry: string; emptyAuth: string; eligible: string; notEligible: string;
  status: string; verifiedSep: string;
};

export type ConsoleMode = 'wizard' | 'proposal' | 'approvals' | 'payment' | 'triproom' | 'crm' | 'founder';

type UiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; detail: string }
  | { kind: 'validation' }
  | { kind: 'unauthorized' }
  | { kind: 'stale' }
  | { kind: 'expired' }
  | { kind: 'priceChanged' }
  | { kind: 'mismatch' }
  | { kind: 'empty' }
  | { kind: 'error'; detail: string };

function classify(status: number, body: Record<string, unknown>): UiState {
  const error = typeof body.error === 'string' ? body.error : '';
  const reason = typeof body.reasonCode === 'string' ? body.reasonCode : '';
  if (status === 200) {
    if (body.verified === false || body.status === 'PARTIAL' || reason === 'PAYMENT_MISMATCH') {
      return { kind: 'mismatch' };
    }
    if (body.outcome === 'EXPIRED') return { kind: 'expired' };
    if (body.outcome === 'MATERIAL_CHANGE' || body.outcome === 'PRICE_CHANGED') return { kind: 'priceChanged' };
    return { kind: 'success', detail: JSON.stringify(body) };
  }
  if (status === 401 || error === 'AUTHORITATIVE_SESSION_REQUIRED' || error === 'STAFF_ROLE_REQUIRED' || error === 'AAL2_REQUIRED') {
    return { kind: 'unauthorized' };
  }
  if (error === 'STALE_APPROVAL_HASH') return { kind: 'stale' };
  if (reason === 'OFFER_EXPIRED') return { kind: 'expired' };
  if (reason === 'RECONCILIATION_NOT_MATCHED' || reason === 'PAYMENT_NOT_VERIFIED') return { kind: 'mismatch' };
  if (status === 404 || error === 'QUOTE_ACCESS_DENIED') return { kind: 'empty' };
  if (status === 400) return { kind: 'validation' };
  return { kind: 'error', detail: error || String(status) };
}

export function OrchestrationConsole({ mode, labels }: { mode: ConsoleMode; labels: OrchestrationLabels }) {
  const [quoteId, setQuoteId] = useState('');
  const [contentHash, setContentHash] = useState('');
  const [traveller, setTraveller] = useState('');
  const [state, setState] = useState<UiState>({ kind: 'idle' });
  const [lastStatus, setLastStatus] = useState<string>('');

  async function post(command: Record<string, unknown>) {
    setState({ kind: 'loading' });
    try {
      const response = await fetch('/api/v1/orchestration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          'x-correlation-id': crypto.randomUUID()
        },
        body: JSON.stringify(command)
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (typeof body.quoteId === 'string') setQuoteId(body.quoteId);
      setState(classify(response.status, body));
    } catch {
      setState({ kind: 'error', detail: 'NETWORK' });
    }
  }

  async function load(query: string) {
    setState({ kind: 'loading' });
    try {
      const response = await fetch(`/api/v1/orchestration?${query}`, {
        headers: { 'x-correlation-id': crypto.randomUUID() }
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (response.status === 200) {
        const payment = body.payment as Record<string, unknown> | null;
        setLastStatus([
          `${labels.status}: ${String(body.status ?? '')}`,
          payment ? `detected: ${payment.detectedStatus} · verified: ${payment.verifiedStatus} · reconciliation: ${payment.reconciliationStatus}` : '',
          body.supplier ? `supplier: ${(body.supplier as Record<string, unknown>).healthy ? 'healthy' : 'down'} · payment: ${(body.payment as Record<string, unknown>)?.healthy ? 'healthy' : 'down'}` : '',
          body.exceptionCounts === null ? labels.emptyAuth : ''
        ].filter(Boolean).join(' — '));
      }
      setState(classify(response.status, body));
    } catch {
      setState({ kind: 'error', detail: 'NETWORK' });
    }
  }

  const needQuote = mode !== 'wizard' && mode !== 'founder';

  return (
    <section className="orch-console state-card" aria-label={labels.title}>
      <h2>{labels.title}</h2>
      <p className="orch-note">{labels.verifiedSep}</p>

      {needQuote ? (
        <label className="orch-field">
          <span>{labels.quoteId}</span>
          <input value={quoteId} onChange={(event) => setQuoteId(event.target.value)} placeholder="uuid" />
        </label>
      ) : null}

      <div className="orch-actions">
        {mode === 'wizard' ? (
          <button className="button button-primary" onClick={() => post({
            command: 'SEARCH_AND_CREATE_QUOTE',
            destination: 'Maldives',
            checkIn: '2026-08-12',
            checkOut: '2026-08-19',
            occupancy: { adults: 2, children: 0, rooms: 1 },
            currency: 'AZN'
          })}>{labels.search}</button>
        ) : null}

        {mode === 'proposal' ? (
          <>
            <button className="button button-outline-dark" onClick={() => load(`view=quoteStatus&quoteId=${quoteId}`)}>{labels.loadStatus}</button>
            <button className="button button-primary" onClick={() => post({ command: 'ACCEPT_QUOTE', quoteId })}>{labels.accept}</button>
          </>
        ) : null}

        {mode === 'approvals' ? (
          <>
            <button className="button button-outline-dark" onClick={() => load(`view=quoteStatus&quoteId=${quoteId}`)}>{labels.loadStatus}</button>
            <button className="button button-outline-dark" onClick={() => post({ command: 'SUBMIT_FOR_REVIEW', quoteId })}>{labels.submit}</button>
            <label className="orch-field">
              <span>{labels.hash}</span>
              <input value={contentHash} onChange={(event) => setContentHash(event.target.value)} placeholder="sha256" />
            </label>
            <button className="button button-primary" onClick={() => post({ command: 'APPROVE_QUOTE', quoteId, expectedContentHash: contentHash })}>{labels.approve}</button>
            <button className="button button-secondary" onClick={() => post({ command: 'PRESENT_QUOTE', quoteId })}>{labels.present}</button>
          </>
        ) : null}

        {mode === 'payment' ? (
          <>
            <button className="button button-primary" onClick={() => post({ command: 'PREPARE_PAYMENT_INTENT', quoteId })}>{labels.prepareIntent}</button>
            <button className="button button-outline-dark" onClick={() => post({ command: 'SIMULATE_WEBHOOK', quoteId })}>{labels.simulateWebhook}</button>
            <button className="button button-secondary" onClick={() => post({ command: 'RECONCILE_SIMULATED', quoteId, scenario: 'EXACT' })}>{labels.reconcileExact}</button>
            <button className="button button-danger" onClick={() => post({ command: 'RECONCILE_SIMULATED', quoteId, scenario: 'PARTIAL' })}>{labels.reconcilePartial}</button>
          </>
        ) : null}

        {mode === 'triproom' ? (
          <>
            <label className="orch-field">
              <span>{labels.traveller}</span>
              <input value={traveller} onChange={(event) => setTraveller(event.target.value)} />
            </label>
            <button className="button button-primary" onClick={() => post({
              command: 'PREPARE_BOOKING',
              quoteId,
              travellers: [{ fullName: traveller || 'Traveller', isLead: true }],
              rooming: [{ roomIndex: 1, travellerNames: [traveller || 'Traveller'] }],
              specialRequests: '',
              hagApprovalReference: crypto.randomUUID()
            })}>{labels.prepareBooking}</button>
            <button className="button button-outline-dark" onClick={() => post({ command: 'CHECK_VOUCHER_ELIGIBILITY', quoteId, bookingConfirmed: false })}>{labels.checkVoucher}</button>
          </>
        ) : null}

        {mode === 'crm' ? (
          <button className="button button-outline-dark" onClick={() => load(`view=quoteStatus&quoteId=${quoteId}`)}>{labels.loadStatus}</button>
        ) : null}

        {mode === 'founder' ? (
          <button className="button button-outline-dark" onClick={() => load('view=health')}>{labels.loadHealth}</button>
        ) : null}
      </div>

      {lastStatus ? <p className="orch-status">{lastStatus}</p> : null}

      <div className="orch-state" role="status">
        {state.kind === 'loading' ? <span className="form-status">{labels.loading}</span> : null}
        {state.kind === 'success' ? (
          <span className="form-status orch-ok">
            {labels.success}
            {state.detail.includes('"eligible":true') ? ` — ${labels.eligible}` : ''}
            {state.detail.includes('"eligible":false') ? ` — ${labels.notEligible}` : ''}
          </span>
        ) : null}
        {state.kind === 'validation' ? <span className="form-status form-status-error">{labels.validationError}</span> : null}
        {state.kind === 'unauthorized' ? <span className="form-status form-status-error">{labels.unauthorized}</span> : null}
        {state.kind === 'stale' ? <span className="form-status form-status-error">{labels.staleApproval}</span> : null}
        {state.kind === 'expired' ? <span className="form-status form-status-error">{labels.expired}</span> : null}
        {state.kind === 'priceChanged' ? <span className="form-status form-status-error">{labels.priceChanged}</span> : null}
        {state.kind === 'mismatch' ? <span className="form-status form-status-error">{labels.mismatch}</span> : null}
        {state.kind === 'empty' ? <span className="form-status">{labels.emptyAuth}</span> : null}
        {state.kind === 'error' ? <span className="form-status form-status-error">{state.detail}</span> : null}
        {state.kind !== 'idle' && state.kind !== 'loading' && state.kind !== 'success' ? (
          <button className="button button-quiet orch-retry" onClick={() => setState({ kind: 'idle' })}>{labels.retry}</button>
        ) : null}
      </div>
    </section>
  );
}
