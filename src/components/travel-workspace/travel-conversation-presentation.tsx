'use client';

import { useState } from 'react';
import type { ConversationViewModel, ConversationCallbacks } from './travel-workspace-types';

/**
 * E.2B.2A — TravelConversationPresentation. This component has NO
 * awareness of Supabase, the Travel Request API, or the E.2B preview
 * engine. It receives a fully-formed ConversationViewModel and a small
 * set of callbacks; all real behavior (real parsing, real API calls, or
 * deterministic preview extraction) lives entirely in the caller. This is
 * what makes the same markup usable by both production AskVoyara (real
 * data/commands) and the preview workspace (fixture data/no-op commands)
 * without either one depending on the other.
 */
export function TravelConversationPresentation({
  model,
  callbacks,
  labels
}: {
  model: ConversationViewModel;
  callbacks: ConversationCallbacks;
  labels: {
    heading: string; send: string; quickPromptsLabel: string; understandingTitle: string;
    correctionLabel: string; correctionPlaceholder: string; correctionApply: string; changed: string; buildJourney: string; notProvidedLabel: string;
    busy?: boolean; busyLabel?: string;
  };
}) {
  const [inputValue, setInputValue] = useState('');
  const [correctionValue, setCorrectionValue] = useState('');
  const busy = labels.busy ?? false;

  return (
    <section className="e2b-section">
      <h2>{labels.heading}</h2>
      <div className="e2b-conversation">
        {model.turns.map((turn, i) => (
          <div key={i} className={`e2b-turn e2b-turn-${turn.speaker === 'assistant' ? 'voyara' : 'customer'}`}>{turn.text}</div>
        ))}
      </div>
      <form className="e2b-input-row" onSubmit={(e) => { e.preventDefault(); if (inputValue.trim() && !busy) { callbacks.onSend(inputValue); if (model.interactionMode === 'MULTI_TURN') setInputValue(''); } }}>
        <input value={inputValue} onChange={(e) => setInputValue(e.target.value)} aria-label={labels.heading} className="e2b-text-input" />
        <button type="submit" className="button button-primary" disabled={busy || !inputValue.trim()}>{busy && labels.busyLabel ? labels.busyLabel : labels.send}</button>
      </form>
      {model.quickPrompts.length > 0 && (
        <div className="e2b-quick-prompts">
          <span>{labels.quickPromptsLabel}</span>
          {model.quickPrompts.map((prompt, i) => (
            <button
              key={i} type="button" className="button button-tertiary"
              onClick={() => {
                // E.2B.2B — the two real, distinct interaction contracts:
                // production's chips have ALWAYS only filled the composer
                // (the customer still reviews/edits before submitting);
                // the preview's chips have always sent immediately as a
                // multi-turn message. quickPromptBehavior makes this an
                // explicit, typed choice rather than an accidental
                // behavior difference — neither side is forced to fake
                // the other's contract.
                if (model.quickPromptBehavior === 'FILL_DRAFT') {
                  setInputValue(prompt);
                  callbacks.onQuickPromptFill?.(prompt);
                } else {
                  callbacks.onSend(prompt);
                }
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {model.turns.length > 0 && (
        <div className="e2b-brief">
          <h3>{labels.understandingTitle}</h3>
          <dl>
            {model.briefFields.map((field) => (
              <div key={field.key}><dt>{field.label}</dt><dd>{field.value ?? labels.notProvidedLabel}</dd></div>
            ))}
          </dl>
          {model.missingFieldLabel && <p className="e2b-illustrative-note">{model.missingFieldLabel}</p>}
        </div>
      )}

      {callbacks.onCorrect && (
        <div className="e2b-correction-panel">
          <label htmlFor="e2b-correction">{labels.correctionLabel}</label>
          <form onSubmit={(e) => { e.preventDefault(); if (correctionValue.trim()) { callbacks.onCorrect!(correctionValue); setCorrectionValue(''); } }} className="e2b-input-row">
            <input id="e2b-correction" value={correctionValue} onChange={(e) => setCorrectionValue(e.target.value)} placeholder={labels.correctionPlaceholder} className="e2b-text-input" />
            <button type="submit" className="button button-secondary">{labels.correctionApply}</button>
          </form>
          {model.correctionSummary && <p className="e2b-what-changed">{labels.changed}: {model.correctionSummary}</p>}
        </div>
      )}

      {model.ready && callbacks.onBuild && (
        <button className="button button-primary" disabled={busy} onClick={callbacks.onBuild}>{busy && labels.busyLabel ? labels.busyLabel : labels.buildJourney}</button>
      )}
    </section>
  );
}
