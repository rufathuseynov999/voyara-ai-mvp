'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type {
  CustomerTravelRequestSummary,
  TravelRequestCommandResult,
  TravelRequestContent
} from '@/server/travel-request/contract';

type InitialDraft = { id: string; version: number; content: TravelRequestContent } | null;

export function TravelRequestForm({
  initialDraft,
  locale,
  messages,
  recent
}: {
  initialDraft: InitialDraft;
  locale: Locale;
  messages: Dictionary['travelRequest'];
  recent: CustomerTravelRequestSummary[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(initialDraft?.id);
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState('');
  const draft = initialDraft?.content;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value === 'travel_request.submit'
      ? 'travel_request.submit'
      : 'travel_request.save_draft';
    const accuracyConfirmed = form.get('accuracyConfirmed') === 'on';
    const dataProcessingAcknowledged = form.get('dataProcessingAcknowledged') === 'on';

    if (action === 'travel_request.submit' && (!accuracyConfirmed || !dataProcessingAcknowledged)) {
      setStatus(messages.confirmationRequired);
      return;
    }

    const content = {
      destination: form.get('destination'),
      departureCity: form.get('departureCity'),
      departureDate: form.get('departureDate'),
      returnDate: form.get('returnDate'),
      travelers: {
        adults: form.get('adults'),
        children: form.get('children'),
        infants: form.get('infants')
      },
      budgetAzn: form.get('budgetAzn'),
      tripPurpose: form.get('tripPurpose'),
      notes: form.get('notes'),
      locale,
      submissionAcknowledgements: { accuracyConfirmed, dataProcessingAcknowledged }
    };

    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/api/v1/travel-requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify({ action, requestId, content })
      });
      const result = await response.json() as TravelRequestCommandResult & { error?: string };
      if (!response.ok || result.status !== 'accepted' || !result.requestId) {
        setStatus(messages.failed);
        return;
      }

      setRequestId(result.requestId);
      if (action === 'travel_request.submit') {
        setSubmitted(true);
        setStatus(messages.submitted);
      } else {
        setStatus(`${messages.saved} ${messages.version} ${result.versionNumber ?? ''}`.trim());
      }
      router.refresh();
    } catch {
      setStatus(messages.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="travel-request-layout">
      <section className="travel-request-card">
        <div className="section-heading section-heading-compact">
          <h2>{messages.formTitle}</h2>
          <p>{messages.formBody}</p>
        </div>
        <form className="travel-request-form" onSubmit={submit}>
          <fieldset disabled={busy || submitted}>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.destination}</span>
                <input
                  defaultValue={draft?.destination}
                  maxLength={120}
                  minLength={2}
                  name="destination"
                  placeholder={messages.destinationPlaceholder}
                  required
                  type="text"
                />
              </label>
              <label>
                <span>{messages.departureCity}</span>
                <input
                  defaultValue={draft?.departureCity}
                  maxLength={120}
                  minLength={2}
                  name="departureCity"
                  placeholder={messages.departureCityPlaceholder}
                  required
                  type="text"
                />
              </label>
              <label>
                <span>{messages.departureDate}</span>
                <input defaultValue={draft?.departureDate} name="departureDate" required type="date" />
              </label>
              <label>
                <span>{messages.returnDate}</span>
                <input defaultValue={draft?.returnDate} name="returnDate" required type="date" />
              </label>
            </div>

            <fieldset className="nested-fieldset">
              <legend>{messages.travelersLegend}</legend>
              <div className="form-grid form-grid-three">
                <label>
                  <span>{messages.adults}</span>
                  <input defaultValue={draft?.travelers.adults ?? 1} max={12} min={1} name="adults" required type="number" />
                </label>
                <label>
                  <span>{messages.children}</span>
                  <input defaultValue={draft?.travelers.children ?? 0} max={8} min={0} name="children" required type="number" />
                </label>
                <label>
                  <span>{messages.infants}</span>
                  <input defaultValue={draft?.travelers.infants ?? 0} max={4} min={0} name="infants" required type="number" />
                </label>
              </div>
            </fieldset>

            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.budgetAzn}</span>
                <input defaultValue={draft?.budgetAzn} max={1_000_000} min={100} name="budgetAzn" required type="number" />
              </label>
              <label>
                <span>{messages.tripPurpose}</span>
                <select defaultValue={draft?.tripPurpose ?? 'leisure'} name="tripPurpose" required>
                  <option value="leisure">{messages.purposes.leisure}</option>
                  <option value="business">{messages.purposes.business}</option>
                  <option value="family">{messages.purposes.family}</option>
                  <option value="honeymoon">{messages.purposes.honeymoon}</option>
                  <option value="wellness">{messages.purposes.wellness}</option>
                  <option value="adventure">{messages.purposes.adventure}</option>
                  <option value="other">{messages.purposes.other}</option>
                </select>
              </label>
            </div>

            <label>
              <span>{messages.notes}</span>
              <textarea defaultValue={draft?.notes} maxLength={2_000} name="notes" placeholder={messages.notesPlaceholder} rows={5} />
            </label>

            <fieldset className="nested-fieldset acknowledgement-fieldset">
              <legend>{messages.ackLegend}</legend>
              <label className="check-label">
                <input defaultChecked={draft?.submissionAcknowledgements.accuracyConfirmed} name="accuracyConfirmed" type="checkbox" />
                <span>{messages.accuracy}</span>
              </label>
              <label className="check-label">
                <input defaultChecked={draft?.submissionAcknowledgements.dataProcessingAcknowledged} name="dataProcessingAcknowledged" type="checkbox" />
                <span>{messages.dataProcessing}</span>
              </label>
            </fieldset>

            <p className="data-notice">{messages.dataNotice}</p>
            <div className="form-actions">
              <button className="button button-outline-dark" disabled={busy} type="submit" value="travel_request.save_draft">
                {busy ? messages.working : messages.saveDraft}
              </button>
              <button className="button button-primary" disabled={busy} type="submit" value="travel_request.submit">
                {busy ? messages.working : messages.submit}
              </button>
            </div>
          </fieldset>
        </form>
        <p aria-live="polite" className="form-status">{status}</p>
      </section>

      <aside className="request-summary-card">
        {requestId ? (
          <div className="request-identity">
            <span>{messages.currentDraft}</span>
            <strong>{requestId}</strong>
          </div>
        ) : null}
        <h2>{messages.recentTitle}</h2>
        {recent.length === 0 ? <p>{messages.noRecent}</p> : (
          <ol className="request-history">
            {recent.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>{messages.statusLabels[request.status]}</strong>
                  <span>{messages.version} {request.currentVersion}</span>
                </div>
                <code>{request.id.slice(0, 8)}</code>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
