'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { StaffSupportCase, SupportCommandResult } from '@/server/support/contract';

const numberLocales: Record<Locale, string> = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };
const activeStatuses = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER']);

function dateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(numberLocales[locale], {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function SupportOperationsCard({
  item,
  locale,
  messages,
  viewerId,
  canManage
}: {
  item: StaffSupportCase;
  locale: Locale;
  messages: Dictionary['supportStaff'];
  viewerId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const canAct = item.ownerId === viewerId || canManage;
  const active = activeStatuses.has(item.status);

  async function execute(body: object): Promise<boolean> {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/api/v1/staff/support', {
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
        setStatus(`${messages.failed}${result.reasonCode ? ` (${result.reasonCode})` : ''}`);
        return false;
      }
      setStatus(`${messages.accepted} ${messages.receipt} ${result.eventId ?? ''}`.trim());
      router.refresh();
      return true;
    } catch {
      setStatus(messages.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function claim() {
    void execute({ action: 'support.case.claim', caseId: item.id });
  }

  async function setPriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await execute({
      action: 'support.case.priority.set',
      caseId: item.id,
      priority: data.get('priority'),
      reason: data.get('reason')
    })) form.reset();
  }

  async function escalate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await execute({
      action: 'support.case.escalate',
      caseId: item.id,
      targetLevel: data.get('targetLevel'),
      reason: data.get('reason')
    })) form.reset();
  }

  async function customerUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await execute({
      action: 'support.case.customer_update',
      caseId: item.id,
      message: data.get('message'),
      nextStatus: data.get('nextStatus')
    })) form.reset();
  }

  async function internalNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await execute({
      action: 'support.case.internal_note',
      caseId: item.id,
      message: data.get('message')
    })) form.reset();
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await execute({
      action: 'support.case.resolve',
      caseId: item.id,
      resolution: data.get('resolution'),
      financialAuthorityUnaffectedConfirmed: data.get('authorityDeclaration') === 'on'
    })) form.reset();
  }

  async function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await execute({
      action: 'support.case.close',
      caseId: item.id,
      closureNote: data.get('closureNote'),
      financialAuthorityUnaffectedConfirmed: data.get('authorityDeclaration') === 'on'
    })) form.reset();
  }

  return (
    <article className="support-operations-card">
      <header className="support-operations-header">
        <div>
          <span className={`request-status priority-${item.priority.toLowerCase()}`}>{messages.priorityLabels[item.priority]}</span>
          <h2>{item.subject}</h2>
          <p>{messages.categoryLabels[item.category]} · {messages.statusLabels[item.status]}</p>
        </div>
        <span className="support-case-reference">{messages.caseReference} <strong>{item.id.slice(0, 8)}</strong></span>
      </header>

      <dl className="support-case-facts support-staff-facts">
        <div><dt>{messages.customer}</dt><dd>{item.customerId.slice(0, 8)}</dd></div>
        <div><dt>{messages.booking}</dt><dd>{item.bookingId.slice(0, 8)}</dd></div>
        <div><dt>{messages.openedAt}</dt><dd>{dateTime(item.openedAt, locale)}</dd></div>
        <div><dt>{messages.owner}</dt><dd>{item.ownerId?.slice(0, 8) ?? messages.unassigned}</dd></div>
        <div><dt>{messages.escalation}</dt><dd>{messages.escalationLabels[item.escalationLevel]}</dd></div>
        <div><dt>{messages.priority}</dt><dd>{messages.priorityLabels[item.priority]}</dd></div>
        <div className="booking-hash"><dt>{messages.authorityHash}</dt><dd><code>{item.caseAuthorityHash}</code></dd></div>
      </dl>

      {item.status === 'OPEN' && !item.ownerId ? (
        <button className="button button-primary" disabled={busy} onClick={claim} type="button">
          {busy ? messages.working : messages.claim}
        </button>
      ) : null}

      {canManage && item.status !== 'CLOSED' ? (
        <form className="booking-evidence-form compact-support-form" onSubmit={setPriority}>
          <fieldset disabled={busy}>
            <legend>{messages.priority}</legend>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.priority}</span>
                <select defaultValue={item.priority} name="priority">
                  <option value="P1_CRITICAL">{messages.priorityLabels.P1_CRITICAL}</option>
                  <option value="P2_HIGH">{messages.priorityLabels.P2_HIGH}</option>
                  <option value="P3_NORMAL">{messages.priorityLabels.P3_NORMAL}</option>
                  <option value="P4_LOW">{messages.priorityLabels.P4_LOW}</option>
                </select>
              </label>
              <label><span>{messages.reason}</span><input maxLength={500} minLength={8} name="reason" required /></label>
            </div>
            <button className="button button-secondary" type="submit">{busy ? messages.working : messages.setPriority}</button>
          </fieldset>
        </form>
      ) : null}

      {active && canAct && item.escalationLevel !== 'FOUNDER' ? (
        <form className="booking-evidence-form compact-support-form" onSubmit={escalate}>
          <fieldset disabled={busy}>
            <legend>{messages.escalation}</legend>
            <div className="form-grid form-grid-two">
              <label>
                <span>{messages.targetLevel}</span>
                <select defaultValue={item.escalationLevel === 'NONE' ? 'MANAGER' : 'FOUNDER'} name="targetLevel">
                  {item.escalationLevel === 'NONE' ? <option value="MANAGER">{messages.escalationLabels.MANAGER}</option> : null}
                  {canManage ? <option value="FOUNDER">{messages.escalationLabels.FOUNDER}</option> : null}
                </select>
              </label>
              <label><span>{messages.reason}</span><input maxLength={500} minLength={8} name="reason" required /></label>
            </div>
            <button className="button button-secondary" type="submit">{busy ? messages.working : messages.escalate}</button>
          </fieldset>
        </form>
      ) : null}

      {active && item.status !== 'OPEN' && canAct ? (
        <div className="support-action-grid">
          <form className="booking-evidence-form compact-support-form" onSubmit={customerUpdate}>
            <fieldset disabled={busy}>
              <legend>{messages.customerUpdate}</legend>
              <label><span>{messages.customerMessage}</span><textarea maxLength={2_000} minLength={5} name="message" required rows={4} /></label>
              <label>
                <span>{messages.nextStatus}</span>
                <select defaultValue="IN_PROGRESS" name="nextStatus">
                  <option value="IN_PROGRESS">{messages.statusLabels.IN_PROGRESS}</option>
                  <option value="WAITING_CUSTOMER">{messages.statusLabels.WAITING_CUSTOMER}</option>
                </select>
              </label>
              <button className="button button-primary" type="submit">{busy ? messages.working : messages.sendUpdate}</button>
            </fieldset>
          </form>
          <form className="booking-evidence-form compact-support-form internal-support-form" onSubmit={internalNote}>
            <fieldset disabled={busy}>
              <legend>{messages.internalNote}</legend>
              <label><span>{messages.internalMessage}</span><textarea maxLength={2_000} minLength={5} name="message" required rows={4} /></label>
              <button className="button button-secondary" type="submit">{busy ? messages.working : messages.addNote}</button>
            </fieldset>
          </form>
        </div>
      ) : null}

      {active && item.status !== 'OPEN' && canAct ? (
        <form className="booking-evidence-form resolution-support-form" onSubmit={resolve}>
          <fieldset disabled={busy}>
            <legend>{messages.resolve}</legend>
            <label><span>{messages.resolution}</span><textarea maxLength={2_000} minLength={10} name="resolution" required rows={4} /></label>
            <label className="check-label"><input name="authorityDeclaration" required type="checkbox" /><span>{messages.resolveDeclaration}</span></label>
            <button className="button button-primary" type="submit">{busy ? messages.working : messages.resolveButton}</button>
          </fieldset>
        </form>
      ) : null}

      {item.status === 'RESOLVED' && canAct ? (
        <form className="booking-evidence-form resolution-support-form" onSubmit={close}>
          <fieldset disabled={busy}>
            <legend>{messages.close}</legend>
            <label><span>{messages.closureNote}</span><textarea maxLength={500} minLength={8} name="closureNote" required rows={3} /></label>
            <label className="check-label"><input name="authorityDeclaration" required type="checkbox" /><span>{messages.closeDeclaration}</span></label>
            <button className="button button-secondary" type="submit">{busy ? messages.working : messages.closeButton}</button>
          </fieldset>
        </form>
      ) : null}

      <section className="support-event-history" aria-labelledby={`support-events-${item.id}`}>
        <h3 id={`support-events-${item.id}`}>{messages.eventHistory}</h3>
        <ol className="support-event-list">
          {item.events.map((supportEvent) => (
            <li className={supportEvent.visibility === 'INTERNAL' ? 'is-internal' : ''} key={supportEvent.id}>
              <span>{supportEvent.sequence}</span>
              <div>
                <strong>{messages.eventLabels[supportEvent.eventType]}</strong>
                <small>{messages.visibility[supportEvent.visibility]} · {messages.actor}: {supportEvent.actorId.slice(0, 8)} · {dateTime(supportEvent.occurredAt, locale)}</small>
                <p>{supportEvent.message}</p>
                <code>{messages.eventHash}: {supportEvent.eventHash}</code>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <p className="authority-note">{messages.boundary}</p>
      <p aria-live="polite" className="form-status">{status}</p>
    </article>
  );
}

export function SupportOperationsQueue({
  cases,
  locale,
  messages,
  viewerId,
  canManage
}: {
  cases: StaffSupportCase[];
  locale: Locale;
  messages: Dictionary['supportStaff'];
  viewerId: string;
  canManage: boolean;
}) {
  return (
    <section className="support-operations-workspace" aria-labelledby="support-queue-title">
      <div className="section-heading section-heading-wide">
        <span className="eyebrow">{messages.eyebrow}</span>
        <h2 id="support-queue-title">{messages.queueTitle}</h2>
        <p>{messages.queueBody}</p>
      </div>
      <p className="authority-note">{messages.authorityNote}</p>
      {cases.length === 0 ? <div className="empty-state"><p>{messages.empty}</p></div> : (
        <div className="support-operations-list">
          {cases.map((item) => (
            <SupportOperationsCard
              canManage={canManage}
              item={item}
              key={item.id}
              locale={locale}
              messages={messages}
              viewerId={viewerId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
