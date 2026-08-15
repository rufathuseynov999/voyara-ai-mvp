'use client';

import { WhatsAppConversionPanel, type Detail, type ConversionResult } from './crm-inbox';
import type { InboxLabels } from './crm-inbox';

/**
 * E.2A — mounts the REAL CrmInbox two-column structure (.inbox-layout:
 * .inbox-list + .inbox-detail, exactly the real grid production uses) and
 * the REAL WhatsAppConversionPanel in previewMode, for the internal
 * preview route. No separate mock layout — a real single-item list is
 * rendered so the grid's two real columns are both genuinely occupied,
 * matching the actual desktop composition instead of leaving one grid
 * track empty.
 */
export function CrmInboxPreviewShell({
  detail,
  labels,
  initialResult,
  initialConfirmationId,
  initialAckId
}: {
  detail: Detail;
  labels: InboxLabels;
  initialResult: ConversionResult | null;
  initialConfirmationId: string;
  initialAckId: string;
}) {
  return (
    <section className="crm-inbox state-card e2a-preview-shell">
      <h2>{labels.title}</h2>
      <p className="orch-note">{labels.description}</p>

      <div className="inbox-layout">
        <ul className="inbox-list" aria-label={labels.selectConversation}>
          <li>
            <button className="inbox-row is-active" type="button" tabIndex={-1} aria-disabled="true">
              <span className={`inbox-brand-badge inbox-brand-${(detail.customerFacingBrand ?? 'unknown').toLowerCase()}`}>{detail.customerFacingBrand ?? '—'}</span>
              <span className="inbox-contact">{detail.contactName ?? detail.contactId}</span>
              <span className="inbox-channel">{detail.channel}</span>
              <span className="inbox-status">{detail.status}</span>
            </button>
          </li>
        </ul>

        <div className="inbox-detail e2a-preview-detail">
          <div className="inbox-detail-header">
            <span className={`inbox-brand-badge inbox-brand-${(detail.customerFacingBrand ?? 'unknown').toLowerCase()}`}>{detail.customerFacingBrand ?? '—'}</span>
            <strong>{detail.contactName ?? detail.contactId}</strong>
            <span>{detail.handoverStatus === 'AI' ? labels.handoverAi : labels.handoverHuman}</span>
          </div>

          <h3>{labels.timeline}</h3>
          <ul className="inbox-timeline">
            {detail.messages.map((m) => (
              <li key={m.messageId} className={`inbox-message inbox-message-${m.direction.toLowerCase()}`}>
                <span className="inbox-message-meta">{m.senderKind} · {m.status}</span>
                <span className="inbox-message-body">{m.body}</span>
              </li>
            ))}
          </ul>

          <WhatsAppConversionPanel
            detail={detail}
            labels={labels}
            onConverted={() => {}}
            previewMode
            initialResult={initialResult}
            initialConfirmationId={initialConfirmationId}
            initialAckId={initialAckId}
            initialContent={initialAckId ? { destination: 'İstanbul', departureDate: '2026-09-01', returnDate: '2026-09-05', adults: 2, budgetAzn: 3000 } : undefined}
          />
        </div>
      </div>
    </section>
  );
}
