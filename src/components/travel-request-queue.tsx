'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type {
  StaffTravelRequestQueueItem,
  TravelRequestCommandResult
} from '@/server/travel-request/contract';

type StaffAction = 'travel_request.claim' | 'travel_request.start_ai_preparation' | 'travel_request.start_human_review';

export function TravelRequestQueue({
  initialItems,
  locale,
  messages,
  purposeLabels,
  statusLabels,
  viewerId
}: {
  initialItems: StaffTravelRequestQueueItem[];
  locale: Locale;
  messages: Dictionary['travelRequestStaff'];
  purposeLabels: Dictionary['travelRequest']['purposes'];
  statusLabels: Dictionary['travelRequest']['statusLabels'];
  viewerId: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState('');
  const [status, setStatus] = useState('');

  async function execute(item: StaffTravelRequestQueueItem, action: StaffAction) {
    setBusyId(item.id);
    setStatus('');
    try {
      const response = await fetch('/api/v1/staff/travel-requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify({ action, requestId: item.id })
      });
      const result = await response.json() as TravelRequestCommandResult;
      if (!response.ok || result.status !== 'accepted') {
        setStatus(messages.failed);
        return;
      }
      setItems((current) => current.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        assignedStaffId: result.assignedStaffId ?? candidate.assignedStaffId,
        status: result.requestStatus ?? candidate.status
      } : candidate));
      setStatus(messages.accepted);
    } catch {
      setStatus(messages.failed);
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="staff-request-section" aria-labelledby="travel-request-queue-title">
      <div className="section-heading section-heading-wide">
        <span className="eyebrow">{messages.eyebrow}</span>
        <h2 id="travel-request-queue-title">{messages.queueTitle}</h2>
        <p>{messages.queueBody}</p>
      </div>
      <p className="authority-note">{messages.humanControlNote}</p>
      {items.length === 0 ? <div className="empty-state"><p>{messages.noRequests}</p></div> : (
        <div className="staff-request-grid">
          {items.map((item) => {
            const mine = item.assignedStaffId === viewerId;
            return (
              <article className="staff-request-card" key={item.id}>
                <header>
                  <div>
                    <span className="request-status">{statusLabels[item.status]}</span>
                    <h3>{item.destination}</h3>
                  </div>
                  <code title={item.payloadHash}>{item.payloadHash.slice(0, 12)}</code>
                </header>
                <dl className="request-facts">
                  <div><dt>{messages.customer}</dt><dd>{item.customerId.slice(0, 8)}</dd></div>
                  <div><dt>{messages.dates}</dt><dd>{item.departureDate} — {item.returnDate}</dd></div>
                  <div><dt>{messages.travelers}</dt><dd>{item.travelers.adults + item.travelers.children + item.travelers.infants}</dd></div>
                  <div><dt>{messages.budget}</dt><dd>{item.budgetAzn.toLocaleString('en-US')} AZN</dd></div>
                  <div><dt>{messages.purpose}</dt><dd>{purposeLabels[item.tripPurpose]}</dd></div>
                  <div><dt>{messages.owner}</dt><dd>{!item.assignedStaffId ? messages.unassigned : mine ? messages.mine : messages.assignedOther}</dd></div>
                </dl>
                {item.notes ? <p className="request-notes"><strong>{messages.notes}</strong> {item.notes}</p> : null}
                <div className="queue-actions">
                  {!item.assignedStaffId ? (
                    <button className="button button-primary" disabled={busyId === item.id} onClick={() => execute(item, 'travel_request.claim')} type="button">
                      {busyId === item.id ? messages.working : messages.claim}
                    </button>
                  ) : null}
                  {mine && item.status === 'SUBMITTED' ? (
                    <button className="button button-primary" disabled={busyId === item.id} onClick={() => execute(item, 'travel_request.start_ai_preparation')} type="button">
                      {busyId === item.id ? messages.working : messages.startAi}
                    </button>
                  ) : null}
                  {mine && item.status === 'AI_PREPARATION' ? (
                    <button className="button button-primary" disabled={busyId === item.id} onClick={() => execute(item, 'travel_request.start_human_review')} type="button">
                      {busyId === item.id ? messages.working : messages.startReview}
                    </button>
                  ) : null}
                  {mine && item.status === 'HUMAN_REVIEW' ? (
                    <Link className="button button-primary" href={`/${locale}/staff/approvals`}>
                      {messages.openApproval}
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p aria-live="polite" className="form-status">{status}</p>
    </section>
  );
}
