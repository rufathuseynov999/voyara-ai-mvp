'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { TravelRequestCommandResult } from '@/server/travel-request/contract';
import { parseIntent, type ParsedIntent } from '@/lib/ask-voyara-parser';

/**
 * UX2 — Ask VOYARA.
 *
 * This is NOT a decorative chatbot and it does NOT pretend a live AI model
 * is running. It calls the deterministic, demo-safe parser in
 * src/lib/ask-voyara-parser.ts (see that file for its exact, honestly
 * documented AZ/RU/EN coverage) to extract destination / dates /
 * travellers / budget from free text the customer already typed, shows
 * exactly what it found, and — on confirmation — writes a real draft
 * through the same authoritative Travel Request command
 * (`/api/v1/travel-requests`, action `travel_request.save_draft`) already
 * used by the 60-second Wizard.
 *
 * There is exactly one Intent / Travel Request pipeline. Ask VOYARA is a
 * second entry point into it, not a second system. The customer always
 * finishes in the structured Wizard, where the existing accuracy and data
 * processing acknowledgements are captured before anything is submitted —
 * Ask VOYARA never bypasses the Human Approval Gate.
 */

export function AskVoyara({ locale, messages, requestMessages }: {
  locale: Locale;
  messages: Dictionary['askVoyara'];
  requestMessages: Dictionary['travelRequest'];
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const parsed = useMemo<ParsedIntent | null>(() => (submittedText ? parseIntent(submittedText) : null), [submittedText]);

  const samples = [messages.sample1, messages.sample2, messages.sample3];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    setSubmittedText(text.trim());
    setStatus('');
  }

  async function createDraft() {
    if (!parsed) return;
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
        body: JSON.stringify({
          action: 'travel_request.save_draft',
          content: {
            destination: parsed.destination ?? '',
            departureCity: '',
            departureDate: parsed.departureDate ?? '',
            returnDate: parsed.returnDate ?? '',
            travelers: { adults: parsed.adults ?? 1, children: 0, infants: 0 },
            budgetAzn: parsed.budgetAzn ?? 100,
            tripPurpose: 'leisure',
            notes: submittedText ?? '',
            locale,
            submissionAcknowledgements: { accuracyConfirmed: false, dataProcessingAcknowledged: false }
          }
        })
      });
      const result = (await response.json()) as TravelRequestCommandResult & { error?: string };
      if (!response.ok || result.status !== 'accepted' || !result.requestId) {
        setStatus(requestMessages.failed);
        return;
      }
      setStatus(messages.createdStatus);
      router.push(`/${locale}/trip-wizard`);
    } catch {
      setStatus(requestMessages.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask-voyara">
      <p className="ask-voyara-intro">{messages.intro}</p>

      <form className="ask-voyara-composer" onSubmit={handleSubmit}>
        <textarea
          className="ask-voyara-textarea"
          maxLength={600}
          onChange={(event) => setText(event.target.value)}
          placeholder={messages.placeholder}
          value={text}
        />
        <div className="ask-voyara-composer-actions">
          <button className="button button-primary" disabled={busy || !text.trim()} type="submit">
            {busy ? messages.working : messages.send}
          </button>
        </div>
      </form>

      {!submittedText ? (
        <div className="ask-voyara-chips" aria-label={messages.quickChipsLabel}>
          {samples.map((sample) => (
            <button className="ask-voyara-chip" key={sample} onClick={() => setText(sample)} type="button">
              {sample}
            </button>
          ))}
        </div>
      ) : null}

      {parsed ? (
        <section aria-live="polite" className="ask-voyara-parsed">
          <h2>{messages.parsedTitle}</h2>
          <div className="ask-voyara-fields">
            <div className={parsed.destination ? 'ask-voyara-field' : 'ask-voyara-field is-empty'}>
              <span>{messages.detectedDestination}</span>
              <strong>{parsed.destination ?? messages.notDetected}</strong>
            </div>
            <div className={parsed.departureDate ? 'ask-voyara-field' : 'ask-voyara-field is-empty'}>
              <span>{messages.detectedDates}</span>
              <strong>
                {parsed.departureDate
                  ? `${parsed.departureDate}${parsed.returnDate ? ` → ${parsed.returnDate}` : ''}`
                  : messages.notDetected}
              </strong>
            </div>
            <div className={parsed.adults ? 'ask-voyara-field' : 'ask-voyara-field is-empty'}>
              <span>{messages.detectedTravelers}</span>
              <strong>{parsed.adults ? parsed.adults : messages.notDetected}</strong>
            </div>
            <div className={parsed.budgetAzn ? 'ask-voyara-field' : 'ask-voyara-field is-empty'}>
              <span>{messages.detectedBudget}</span>
              <strong>{parsed.budgetAzn ? parsed.budgetAzn : messages.notDetected}</strong>
            </div>
          </div>
          {!parsed.destination && !parsed.departureDate && !parsed.adults && !parsed.budgetAzn ? (
            <p className="ask-voyara-status">{messages.emptyHint}</p>
          ) : null}
          <div className="ask-voyara-parsed-actions">
            <button className="button button-primary" disabled={busy} onClick={createDraft} type="button">
              {busy ? messages.working : messages.confirmCta}
            </button>
          </div>
          <p aria-live="polite" className="ask-voyara-status">{status}</p>
        </section>
      ) : null}

      <p className="ask-voyara-disclaimer">{messages.disclaimer}</p>
    </div>
  );
}
