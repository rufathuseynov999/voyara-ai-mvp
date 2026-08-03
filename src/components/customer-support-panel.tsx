'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { CustomerSupportCase, SupportCommandResult } from '@/server/support/contract';

const numberLocales: Record<Locale, string> = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };
const activeStatuses = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER']);

function dateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(numberLocales[locale], {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function CustomerSupportPanel({
  bookingId,
  cases,
  locale,
  messages
}: {
  bookingId: string;
  cases: CustomerSupportCase[];
  locale: Locale;
  messages: Dictionary['supportCustomer'];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const activeCase = cases.find((item) => activeStatuses.has(item.status));

  async function execute(body: object): Promise<boolean> {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/api/v1/customer/support', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(body)
      });
      const result = await response.json() as SupportCommandResult & { error?: string };
      if (!response.ok || result.status !== 'accepted') {
        setStatus(messages.failed);
        return false;
      }
      setStatus(messages.accepted);
      router.refresh();
      return true;
    } catch {
      setStatus(messages.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const accepted = await execute({
      action: 'support.case.open',
      bookingId,
      category: data.get('category'),
      urgency: data.get('urgency'),
      subject: data.get('subject'),
      message: data.get('message'),
      declarationConfirmed: data.get('declarationConfirmed') === 'on'
    });
    if (accepted) form.reset();
  }

  async function addMessage(event: FormEvent<HTMLFormElement>, caseId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const accepted = await execute({
      action: 'support.case.message',
      caseId,
      message: data.get('message')
    });
    if (accepted) form.reset();
  }

  return (
    <section className="customer-support-panel" aria-labelledby={`support-title-${bookingId}`}>
      <header>
        <span className="eyebrow">{messages.eyebrow}</span>
        <h3 id={`support-title-${bookingId}`}>{messages.title}</h3>
        <p>{messages.intro}</p>
      </header>
      <p className="authority-note">{messages.boundary}</p>

      {!activeCase ? (
        <form className="booking-evidence-form support-case-form" onSubmit={openCase}>
          <fieldset disabled={busy}>
            <legend>{messages.openTitle}</legend>
            <p>{messages.openBody}</p>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.category}</span>
                <select defaultValue="ITINERARY_QUESTION" name="category">
                  <option value="TRAVEL_DISRUPTION">{messages.categories.TRAVEL_DISRUPTION}</option>
                  <option value="SUPPLIER_SERVICE">{messages.categories.SUPPLIER_SERVICE}</option>
                  <option value="DOCUMENT_OR_VOUCHER">{messages.categories.DOCUMENT_OR_VOUCHER}</option>
                  <option value="ITINERARY_QUESTION">{messages.categories.ITINERARY_QUESTION}</option>
                  <option value="OTHER">{messages.categories.OTHER}</option>
                </select>
              </label>
              <label>
                <span>{messages.urgency}</span>
                <select defaultValue="NORMAL" name="urgency">
                  <option value="NORMAL">{messages.urgencies.NORMAL}</option>
                  <option value="URGENT">{messages.urgencies.URGENT}</option>
                </select>
              </label>
            </div>
            <label><span>{messages.subject}</span><input maxLength={120} minLength={5} name="subject" required /></label>
            <label><span>{messages.message}</span><textarea maxLength={2_000} minLength={10} name="message" required rows={4} /></label>
            <label className="check-label">
              <input name="declarationConfirmed" required type="checkbox" />
              <span>{messages.declaration}</span>
            </label>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.openButton}</button>
          </fieldset>
        </form>
      ) : <p className="support-active-limit">{messages.activeLimit}</p>}

      <section className="customer-support-cases" aria-labelledby={`support-cases-${bookingId}`}>
        <h4 id={`support-cases-${bookingId}`}>{messages.casesTitle}</h4>
        {cases.length === 0 ? <div className="empty-state"><p>{messages.empty}</p></div> : (
          <div className="support-case-list">
            {cases.map((item) => (
              <article className="support-case-card" key={item.id}>
                <header>
                  <div>
                    <span className="request-status">{messages.statusLabels[item.status]}</span>
                    <h5>{item.subject}</h5>
                  </div>
                  <span className="support-case-reference">{messages.caseReference} <strong>{item.id.slice(0, 8)}</strong></span>
                </header>
                <dl className="support-case-facts">
                  <div><dt>{messages.category}</dt><dd>{messages.categories[item.category]}</dd></div>
                  <div><dt>{messages.priority}</dt><dd>{messages.priorityLabels[item.priority]}</dd></div>
                  <div><dt>{messages.openedAt}</dt><dd>{dateTime(item.openedAt, locale)}</dd></div>
                  <div><dt>{messages.updatedAt}</dt><dd>{dateTime(item.updatedAt, locale)}</dd></div>
                </dl>
                <ol className="support-event-list">
                  {item.events.map((supportEvent) => (
                    <li key={supportEvent.id}>
                      <span>{supportEvent.sequence}</span>
                      <div>
                        <strong>{messages.eventLabels[supportEvent.eventType]}</strong>
                        <p>{supportEvent.message}</p>
                        <small>{dateTime(supportEvent.occurredAt, locale)}</small>
                      </div>
                    </li>
                  ))}
                </ol>
                {activeStatuses.has(item.status) ? (
                  <form className="booking-evidence-form support-message-form" onSubmit={(event) => addMessage(event, item.id)}>
                    <fieldset disabled={busy}>
                      <legend>{messages.addMessage}</legend>
                      <label>
                        <span>{messages.message}</span>
                        <textarea maxLength={2_000} minLength={5} name="message" required rows={3} />
                      </label>
                      <button className="button button-secondary" type="submit">{busy ? messages.working : messages.sendMessage}</button>
                    </fieldset>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
      <p aria-live="polite" className="form-status">{status}</p>
    </section>
  );
}
