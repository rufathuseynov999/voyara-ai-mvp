'use client';

import type { ReactNode } from 'react';
import type { JourneyCanvasViewModel, JourneyCanvasCallbacks } from './travel-workspace-types';
import { RouteVisualization, HotelIllustration, DiningIllustration, ExperienceIllustration } from '../e2b-illustrations/e2b-illustrations';

/**
 * E.2B.2B — JourneyCanvasPresentation. Pure and callback-driven: no
 * PublishedProposalView import, no payment/booking store import, no
 * fetch, no operational status derivation. It only ever renders whatever
 * JourneyCanvasViewModel it's given, and the evidenceMode field ('LIVE'
 * vs 'ILLUSTRATIVE') is always visibly surfaced so illustrative preview
 * content can never be mistaken for confirmed production evidence.
 *
 * `slots` lets production pass its own real, authoritative domain
 * components (PublishedProposals, NextActionCard, the existing stage
 * track, existing navigation links) straight through as plain ReactNode
 * — this component never imports PublishedProposals or NextActionCard
 * itself, never re-implements their behavior, and never makes an
 * authority decision about what they show. It only decides WHERE they
 * render inside the shared visual frame.
 */
export function JourneyCanvasPresentation({
  model,
  callbacks,
  labels,
  slots
}: {
  model: JourneyCanvasViewModel;
  callbacks: JourneyCanvasCallbacks;
  labels: {
    journeySubtitle: string; hotelCandidate: string; dining: string; notLiveLabel: string;
    whatChanged: string; applyEdit: string; showOriginal: string; showRevised: string; showingRevised: boolean;
    compareTitle: string; selectDirection: string; selectedPlan: string;
    pace: string; hotelLevel: string; included: string; budgetRange: string; flexibility: string; serviceLevel: string;
    timeLabels: Record<'morning' | 'afternoon' | 'evening', string>; dayLabelTemplate: string;
    liveLabel: string; illustrativeLabel: string; editPromptText?: string;
  };
  /** Optional — production-only. Preview never supplies these. */
  slots?: {
    stageContent?: ReactNode;
    proposalContent?: ReactNode;
    nextActionContent?: ReactNode;
    secondaryActionsContent?: ReactNode;
  };
}) {
  return (
    <>
      <section className="e2b-section">
        <h2>{model.heading}</h2>
        <p className="e2b-illustrative-note">{labels.journeySubtitle}</p>
        <p className="e2b-evidence-badge">
          {model.evidenceMode === 'LIVE' ? labels.liveLabel : labels.illustrativeLabel}
        </p>
        {slots?.stageContent}
        {model.routeLabel && <RouteVisualization locale="en" label={model.routeLabel} />}

        {(model.hotelCandidate || model.diningCandidate) && (
          <div className="e2b-canvas-cards">
            {model.hotelCandidate && (
              <article className="e2b-rich-card">
                <HotelIllustration />
                <div className="e2b-rich-card-body">
                  <h4>{labels.hotelCandidate}</h4>
                  <p className="e2b-rich-card-title">{model.hotelCandidate.title}</p>
                  {model.hotelCandidate.neighborhood && <p className="e2b-rich-card-meta">{model.hotelCandidate.neighborhood}</p>}
                  {model.hotelCandidate.reason && <p>{model.hotelCandidate.reason}</p>}
                  {model.hotelCandidate.evidence === 'illustrative' && <p className="e2b-illustrative-note">{labels.notLiveLabel}</p>}
                </div>
              </article>
            )}
            {model.diningCandidate && (
              <article className="e2b-rich-card">
                <DiningIllustration />
                <div className="e2b-rich-card-body">
                  <h4>{labels.dining}</h4>
                  <p className="e2b-rich-card-title">{model.diningCandidate.title}</p>
                  {model.diningCandidate.neighborhood && <p className="e2b-rich-card-meta">{model.diningCandidate.neighborhood}</p>}
                  {model.diningCandidate.reason && <p>{model.diningCandidate.reason}</p>}
                  {model.diningCandidate.evidence === 'illustrative' && <p className="e2b-illustrative-note">{labels.notLiveLabel}</p>}
                </div>
              </article>
            )}
          </div>
        )}

        {(model.experienceCards?.length ?? 0) > 0 && (
          <div className="e2b-experience-row">
            {(model.experienceCards ?? []).map((card, i) => card && (
              <div key={i} className="e2b-experience-card">
                <ExperienceIllustration variant={(['morning', 'afternoon', 'evening'] as const)[i % 3]} />
                <p className="e2b-time-label">{card.title}</p>
                {card.neighborhood && <p className="e2b-rich-card-meta">{card.neighborhood}</p>}
              </div>
            ))}
          </div>
        )}

        {(model.days?.length ?? 0) > 0 && (
          <ol className="e2b-itinerary">
            {(model.days ?? []).map((day) => (
              <li key={day.day} className="e2b-itinerary-day">
                <strong>{labels.dayLabelTemplate.replace('{n}', String(day.day))}: {day.theme}</strong>
                <ul>
                  {day.activities.map((a, i) => (
                    <li key={i}><span className="e2b-time-label">{labels.timeLabels[a.time]}</span> {a.title}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}

        {callbacks.onApplyEdit || model.whatChanged ? (
          <div className="e2b-edit-panel">
            {labels.editPromptText && <p className="e2b-turn e2b-turn-customer">{labels.editPromptText}</p>}
            {!model.whatChanged && callbacks.onApplyEdit ? (
              <button className="button button-secondary" onClick={callbacks.onApplyEdit}>{labels.applyEdit}</button>
            ) : model.whatChanged ? (
              <>
                <p className="e2b-what-changed"><strong>{labels.whatChanged}:</strong> {model.whatChanged}</p>
                {callbacks.onToggleVersion && (
                  <button className="button button-tertiary" onClick={callbacks.onToggleVersion}>
                    {labels.showingRevised ? labels.showOriginal : labels.showRevised}
                  </button>
                )}
              </>
            ) : null}
          </div>
        ) : null}
        {slots?.nextActionContent}
        {slots?.proposalContent}
        {slots?.secondaryActionsContent}
      </section>

      {(model.compareOptions?.length ?? 0) > 0 && (
        <section className="e2b-section">
          <h2>{labels.compareTitle}</h2>
          <div className="e2b-compare-grid">
            {(model.compareOptions ?? []).map((option) => (
              <article key={option.id} className={`e2b-compare-card ${option.selected ? 'is-selected' : ''}`}>
                <h3>{option.label}</h3>
                <dl>
                  {option.pace && <div><dt>{labels.pace}</dt><dd>{option.pace}</dd></div>}
                  {option.hotelLevel && <div><dt>{labels.hotelLevel}</dt><dd>{option.hotelLevel}</dd></div>}
                  {option.includedExperiences && <div><dt>{labels.included}</dt><dd>{option.includedExperiences}</dd></div>}
                  {option.budgetRangeLabel && <div><dt>{labels.budgetRange}</dt><dd>{option.budgetRangeLabel}</dd></div>}
                  {option.flexibility && <div><dt>{labels.flexibility}</dt><dd>{option.flexibility}</dd></div>}
                  {option.serviceLevel && <div><dt>{labels.serviceLevel}</dt><dd>{option.serviceLevel}</dd></div>}
                </dl>
                {callbacks.onSelectOption && (
                  <button className="button button-tertiary" onClick={() => callbacks.onSelectOption!(option.id)}>{labels.selectDirection}</button>
                )}
              </article>
            ))}
          </div>
          {model.selectedOptionLabel && <p className="e2b-illustrative-note">{labels.selectedPlan}: {model.selectedOptionLabel}</p>}
        </section>
      )}
    </>
  );
}
