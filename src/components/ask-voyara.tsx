'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { TravelRequestCommandResult } from '@/server/travel-request/contract';
import { parseIntent, type ParsedIntent } from '@/lib/ask-voyara-parser';
import { TravelConversationPresentation } from './travel-workspace/travel-conversation-presentation';
import type { ConversationViewModel } from './travel-workspace/travel-workspace-types';

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
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const parsed = useMemo<ParsedIntent | null>(() => (submittedText ? parseIntent(submittedText) : null), [submittedText]);

  const samples = [messages.sample1, messages.sample2, messages.sample3];

  // E.2B.2B — production mapper: builds the exact same ConversationViewModel
  // shape the preview uses, from AskVoyara's own real state. No preview
  // fixture, no E.2B engine, and no new parsing logic — parsed still comes
  // entirely from the existing parseIntent() call above. interactionMode
  // is COMPOSE_CONFIRM (single-shot: type, parse, confirm) and
  // quickPromptBehavior is FILL_DRAFT (chips fill the composer, they have
  // never auto-submitted) — this is what preserves AskVoyara's real,
  // long-standing interaction contract instead of forcing it to behave
  // like the preview's multi-turn chat.
  const conversationModel: ConversationViewModel = {
    turns: submittedText ? [{ speaker: 'customer', text: submittedText }] : [],
    quickPrompts: submittedText ? [] : samples,
    briefFields: [
      { key: 'destination', label: messages.detectedDestination, value: parsed?.destination ?? null },
      {
        key: 'dates', label: messages.detectedDates,
        value: parsed?.departureDate ? `${parsed.departureDate}${parsed.returnDate ? ` → ${parsed.returnDate}` : ''}` : null
      },
      { key: 'travelers', label: messages.detectedTravelers, value: parsed?.adults ? String(parsed.adults) : null },
      { key: 'budget', label: messages.detectedBudget, value: parsed?.budgetAzn ? String(parsed.budgetAzn) : null }
    ],
    missingFieldLabel: parsed && !parsed.destination && !parsed.departureDate && !parsed.adults && !parsed.budgetAzn ? messages.emptyHint : null,
    correctionSummary: null,
    ready: Boolean(parsed),
    evidence: 'live',
    interactionMode: 'COMPOSE_CONFIRM',
    quickPromptBehavior: 'FILL_DRAFT'
  };

  function handleSend(value: string) {
    if (!value.trim()) return;
    setSubmittedText(value.trim());
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

      <TravelConversationPresentation
        model={conversationModel}
        callbacks={{
          onSend: handleSend,
          onBuild: parsed ? createDraft : undefined
        }}
        labels={{
          heading: messages.parsedTitle, send: messages.send, quickPromptsLabel: messages.quickChipsLabel,
          understandingTitle: messages.parsedTitle, correctionLabel: '', correctionPlaceholder: '', correctionApply: '',
          changed: '', buildJourney: messages.confirmCta, notProvidedLabel: messages.notDetected,
          busy, busyLabel: messages.working
        }}
      />

      <p aria-live="polite" className="ask-voyara-status">{status}</p>
      <p className="ask-voyara-disclaimer">{messages.disclaimer}</p>
    </div>
  );
}
