'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import {
  administrationCommandSchema,
  crmTaskTypes,
  supplierOperationalChannels,
  supplierServiceCategories,
  type AdministrationCommandResult,
  type AdministrationSnapshot,
  type AdministrationSupplier,
  type AdministrationTask
} from '@/server/administration/contract';

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

export function AdministrationWorkspace({
  initialSnapshot,
  locale,
  messages,
  viewerId,
  viewerRoles
}: {
  initialSnapshot: AdministrationSnapshot;
  locale: Locale;
  messages: Dictionary['administration'];
  viewerId: string;
  viewerRoles: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const elevated = viewerRoles.some((role) => ['manager', 'admin', 'founder'].includes(role));
  const live = initialSnapshot.source === 'POSTGRESQL';
  const teamName = (id: string | null) => id
    ? initialSnapshot.team.find((member) => member.id === id)?.displayName ?? id.slice(0, 8)
    : messages.unassigned;
  // Admin screens are English-governed (locked language discipline); en-US
  // formatting is also engine-stable, so SSR and browser hydration agree even
  // where the runtime lacks az ICU data.
  const timestamp = (date: string) => new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(date));
  const money = (minor: number | null) => minor === null
    ? messages.customPrice
    : `${(minor / 100).toLocaleString('en-US')} AZN`;

  async function execute(candidate: unknown, key: string) {
    const command = administrationCommandSchema.safeParse(candidate);
    if (!command.success) {
      setStatus(messages.invalid);
      return;
    }
    setBusy(key);
    setStatus('');
    try {
      const response = await fetch('/api/v1/staff/administration', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(command.data)
      });
      const result = await response.json() as AdministrationCommandResult;
      if (!response.ok || result.status !== 'accepted') {
        setStatus(messages.failed);
        return;
      }
      setStatus(`${messages.accepted} ${messages.receipt} ${result.authorityHash?.slice(0, 12) ?? ''}`);
      router.refresh();
    } catch {
      setStatus(messages.failed);
    } finally {
      setBusy('');
    }
  }

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const owner = value(form, 'ownerId');
    const due = value(form, 'dueAt');
    execute({
      action: 'crm.task.create',
      travelRequestId: value(form, 'travelRequestId'),
      taskType: value(form, 'taskType'),
      title: value(form, 'title'),
      ownerId: owner || null,
      dueAt: Number.isNaN(new Date(due).getTime()) ? due : new Date(due).toISOString(),
      note: value(form, 'note')
    }, 'task-create');
  }

  function changeTask(event: FormEvent<HTMLFormElement>, task: AdministrationTask) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const action = value(form, 'action');
    const base = {
      action,
      taskId: task.id,
      expectedVersion: task.currentVersion,
      expectedHash: task.currentHash
    };
    execute(action === 'crm.task.status.set' ? {
      ...base,
      nextStatus: value(form, 'nextStatus'),
      note: value(form, 'note')
    } : action === 'crm.task.reassign' ? {
      ...base,
      ownerId: value(form, 'ownerId'),
      reason: value(form, 'reason')
    } : action === 'crm.task.cancel' ? {
      ...base,
      reason: value(form, 'reason')
    } : base, `${task.id}:${action}`);
  }

  function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    execute({
      action: 'supplier.configuration.create',
      code: value(form, 'code').toUpperCase(),
      displayName: value(form, 'displayName'),
      serviceCategory: value(form, 'serviceCategory'),
      operationalChannel: value(form, 'operationalChannel'),
      status: value(form, 'status'),
      operationsNote: value(form, 'operationsNote')
    }, 'supplier-create');
  }

  function reviseSupplier(event: FormEvent<HTMLFormElement>, supplier: AdministrationSupplier) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    execute({
      action: 'supplier.configuration.revise',
      supplierId: supplier.id,
      expectedVersion: supplier.currentVersion,
      expectedHash: supplier.currentHash,
      displayName: value(form, 'displayName'),
      serviceCategory: value(form, 'serviceCategory'),
      operationalChannel: value(form, 'operationalChannel'),
      status: value(form, 'status'),
      operationsNote: value(form, 'operationsNote'),
      reason: value(form, 'reason')
    }, `supplier:${supplier.id}`);
  }

  return (
    <section className="administration-workspace" aria-labelledby="administration-title">
      <header className="section-heading section-heading-wide">
        <span className="eyebrow">{messages.eyebrow}</span>
        <h2 id="administration-title">{messages.title}</h2>
        <p>{messages.intro}</p>
      </header>

      <div className="administration-source" role="status" data-source={initialSnapshot.source}>
        <strong>{messages.source}:</strong>
        <span>{messages.sourceLabels[initialSnapshot.source]}</span>
        <small>{messages.generated}: {timestamp(initialSnapshot.generatedAt)}</small>
      </div>
      {!live ? <p className="authority-note">{messages.previewBoundary}</p> : null}

      <section className="administration-panel" aria-labelledby="crm-derived-pipeline-title">
        <div className="section-heading section-heading-wide">
          <h3 id="crm-derived-pipeline-title">{messages.pipelineTitle}</h3>
          <p>{messages.pipelineBody}</p>
        </div>
        {initialSnapshot.pipeline.length === 0 ? <p className="empty-state">{messages.pipelineEmpty}</p> : (
          <ol className="administration-pipeline-list">
            {initialSnapshot.pipeline.map((item) => (
              <li key={item.travelRequestId}>
                <div>
                  <strong>{messages.stageLabels[item.stage]}</strong>
                  <span>{messages.request} {item.travelRequestId.slice(0, 8)} · {item.authorityStatus}</span>
                </div>
                <code title={item.authorityHash}>{item.authorityHash.slice(0, 12)}</code>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="administration-panel" aria-labelledby="crm-tasks-title">
        <div className="section-heading section-heading-wide">
          <h3 id="crm-tasks-title">{messages.tasksTitle}</h3>
          <p>{messages.tasksBody}</p>
        </div>
        <form className="administration-form" onSubmit={createTask}>
          <fieldset disabled={!live || busy !== ''}>
            <legend>{messages.createTask}</legend>
            <div className="form-grid-three">
              <label>{messages.request}
                <select name="travelRequestId" required defaultValue="">
                  <option disabled value="">{messages.select}</option>
                  {initialSnapshot.pipeline.map((item) => (
                    <option key={item.travelRequestId} value={item.travelRequestId}>
                      {item.travelRequestId.slice(0, 8)} · {messages.stageLabels[item.stage]}
                    </option>
                  ))}
                </select>
              </label>
              <label>{messages.taskType}
                <select name="taskType" required defaultValue="CUSTOMER_FOLLOW_UP">
                  {crmTaskTypes.map((type) => <option key={type} value={type}>{messages.taskTypeLabels[type]}</option>)}
                </select>
              </label>
              <label>{messages.owner}
                <select name="ownerId" defaultValue="">
                  <option value="">{messages.unassigned}</option>
                  {initialSnapshot.team.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.roles}</option>)}
                </select>
              </label>
            </div>
            <div className="form-grid-two">
              <label>{messages.taskTitle}<input name="title" required minLength={5} maxLength={120} /></label>
              <label>{messages.dueAt}<input name="dueAt" required type="datetime-local" /></label>
            </div>
            <label>{messages.accountableNote}<textarea name="note" required minLength={8} maxLength={500} /></label>
            <button className="button button-primary" type="submit">{busy === 'task-create' ? messages.working : messages.createTask}</button>
          </fieldset>
        </form>

        {initialSnapshot.tasks.length === 0 ? <p className="empty-state">{messages.tasksEmpty}</p> : (
          <div className="administration-card-grid">
            {initialSnapshot.tasks.map((task) => {
              const canWork = task.ownerId === viewerId || elevated;
              const terminal = task.status === 'DONE' || task.status === 'CANCELLED';
              return (
                <article className="administration-card" key={task.id}>
                  <header>
                    <div><span className="request-status">{messages.taskStatusLabels[task.status]}</span><h4>{task.title}</h4></div>
                    <code title={task.currentHash}>{task.currentHash.slice(0, 12)}</code>
                  </header>
                  <dl className="administration-facts">
                    <div><dt>{messages.taskType}</dt><dd>{messages.taskTypeLabels[task.taskType]}</dd></div>
                    <div><dt>{messages.owner}</dt><dd>{teamName(task.ownerId)}</dd></div>
                    <div><dt>{messages.dueAt}</dt><dd>{timestamp(task.dueAt)}</dd></div>
                    <div><dt>{messages.version}</dt><dd>{task.currentVersion}</dd></div>
                  </dl>
                  {!terminal && task.ownerId === null ? (
                    <form onSubmit={(event) => changeTask(event, task)}>
                      <input type="hidden" name="action" value="crm.task.claim" />
                      <button className="button button-secondary" disabled={!live || busy !== ''} type="submit">{messages.claimTask}</button>
                    </form>
                  ) : null}
                  {!terminal && canWork ? (
                    <form className="administration-inline-form" onSubmit={(event) => changeTask(event, task)}>
                      <input type="hidden" name="action" value="crm.task.status.set" />
                      <label>{messages.nextStatus}
                        <select name="nextStatus" defaultValue={task.status === 'OPEN' ? 'IN_PROGRESS' : 'DONE'}>
                          {task.status === 'OPEN' ? <option value="IN_PROGRESS">{messages.taskStatusLabels.IN_PROGRESS}</option> : null}
                          <option value="DONE">{messages.taskStatusLabels.DONE}</option>
                        </select>
                      </label>
                      <label>{messages.accountableNote}<input name="note" required minLength={8} maxLength={500} /></label>
                      <button className="button button-secondary" disabled={!live || busy !== ''} type="submit">{messages.recordState}</button>
                    </form>
                  ) : null}
                  {!terminal && elevated ? (
                    <details>
                      <summary>{messages.reassignOrCancel}</summary>
                      <form className="administration-inline-form" onSubmit={(event) => changeTask(event, task)}>
                        <input type="hidden" name="action" value="crm.task.reassign" />
                        <label>{messages.owner}<select name="ownerId" required defaultValue="">
                          <option disabled value="">{messages.select}</option>
                          {initialSnapshot.team.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
                        </select></label>
                        <label>{messages.reason}<input name="reason" required minLength={8} maxLength={500} /></label>
                        <button className="button button-secondary" disabled={!live || busy !== ''} type="submit">{messages.reassign}</button>
                      </form>
                      <form className="administration-inline-form" onSubmit={(event) => changeTask(event, task)}>
                        <input type="hidden" name="action" value="crm.task.cancel" />
                        <label>{messages.reason}<input name="reason" required minLength={8} maxLength={500} /></label>
                        <button className="button button-secondary" disabled={!live || busy !== ''} type="submit">{messages.cancelTask}</button>
                      </form>
                    </details>
                  ) : null}
                  <details>
                    <summary>{messages.history} ({task.events.length})</summary>
                    <ol className="administration-history">
                      {task.events.map((entry) => (
                        <li key={entry.version}><strong>{messages.eventLabels[entry.eventType]}</strong><span>{entry.note}</span><code>{entry.eventHash.slice(0, 12)}</code></li>
                      ))}
                    </ol>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="administration-panel" aria-labelledby="membership-catalogue-title">
        <div className="section-heading section-heading-wide">
          <h3 id="membership-catalogue-title">{messages.membershipTitle}</h3>
          <p>{messages.membershipBody}</p>
        </div>
        <div className="membership-authority-grid">
          {initialSnapshot.membershipPlans.map((plan) => (
            <article key={plan.planCode}>
              <span>{messages.audienceLabels[plan.audience]}</span>
              <h4>{plan.displayName}</h4>
              <p><strong>{money(plan.monthlyMinor)}</strong> {plan.monthlyMinor === null ? '' : messages.monthly}</p>
              {plan.annualMinor === null ? null : <p>{money(plan.annualMinor)} {messages.annual}</p>}
              <code title={plan.payloadHash}>v{plan.versionNumber} · {plan.payloadHash.slice(0, 12)}</code>
            </article>
          ))}
        </div>
        <p className="authority-note">{messages.noBenefits}</p>
      </section>

      <section className="administration-panel" aria-labelledby="supplier-registry-title">
        <div className="section-heading section-heading-wide">
          <h3 id="supplier-registry-title">{messages.suppliersTitle}</h3>
          <p>{messages.suppliersBody}</p>
        </div>
        {elevated ? (
          <form className="administration-form" onSubmit={createSupplier}>
            <fieldset disabled={!live || busy !== ''}>
              <legend>{messages.createSupplier}</legend>
              <div className="form-grid-three">
                <label>{messages.supplierCode}<input name="code" required minLength={3} maxLength={40} /></label>
                <label>{messages.supplierName}<input name="displayName" required minLength={2} maxLength={120} /></label>
                <label>{messages.serviceCategory}<select name="serviceCategory" defaultValue="HOTEL">
                  {supplierServiceCategories.map((category) => <option key={category} value={category}>{messages.serviceCategoryLabels[category]}</option>)}
                </select></label>
                <label>{messages.channel}<select name="operationalChannel" defaultValue="EMAIL">
                  {supplierOperationalChannels.map((channel) => <option key={channel} value={channel}>{messages.channelLabels[channel]}</option>)}
                </select></label>
                <label>{messages.supplierStatus}<select name="status" defaultValue="ACTIVE">
                  <option value="ACTIVE">{messages.supplierStatusLabels.ACTIVE}</option>
                  <option value="PAUSED">{messages.supplierStatusLabels.PAUSED}</option>
                </select></label>
              </div>
              <label>{messages.operationsNote}<textarea name="operationsNote" maxLength={500} /></label>
              <p className="field-note">{messages.noCredentials}</p>
              <button className="button button-primary" type="submit">{busy === 'supplier-create' ? messages.working : messages.createSupplier}</button>
            </fieldset>
          </form>
        ) : <p className="authority-note">{messages.supplierReadOnly}</p>}

        {initialSnapshot.suppliers.length === 0 ? <p className="empty-state">{messages.suppliersEmpty}</p> : (
          <div className="administration-card-grid">
            {initialSnapshot.suppliers.map((supplier) => (
              <article className="administration-card" key={supplier.id}>
                <header><div><span className="request-status">{messages.supplierStatusLabels[supplier.status]}</span><h4>{supplier.displayName}</h4></div><code>{supplier.currentHash.slice(0, 12)}</code></header>
                <p>{supplier.code} · {messages.serviceCategoryLabels[supplier.serviceCategory]} · {messages.channelLabels[supplier.operationalChannel]}</p>
                {supplier.operationsNote ? <p>{supplier.operationsNote}</p> : null}
                <small>{messages.version} {supplier.currentVersion}</small>
                {elevated ? (
                  <details><summary>{messages.reviseSupplier}</summary>
                    <form className="administration-inline-form" onSubmit={(event) => reviseSupplier(event, supplier)}>
                      <label>{messages.supplierName}<input name="displayName" defaultValue={supplier.displayName} required minLength={2} maxLength={120} /></label>
                      <label>{messages.serviceCategory}<select name="serviceCategory" defaultValue={supplier.serviceCategory}>{supplierServiceCategories.map((category) => <option key={category} value={category}>{messages.serviceCategoryLabels[category]}</option>)}</select></label>
                      <label>{messages.channel}<select name="operationalChannel" defaultValue={supplier.operationalChannel}>{supplierOperationalChannels.map((channel) => <option key={channel} value={channel}>{messages.channelLabels[channel]}</option>)}</select></label>
                      <label>{messages.supplierStatus}<select name="status" defaultValue={supplier.status}><option value="ACTIVE">{messages.supplierStatusLabels.ACTIVE}</option><option value="PAUSED">{messages.supplierStatusLabels.PAUSED}</option></select></label>
                      <label>{messages.operationsNote}<textarea name="operationsNote" defaultValue={supplier.operationsNote} maxLength={500} /></label>
                      <label>{messages.reason}<input name="reason" required minLength={8} maxLength={500} /></label>
                      <button className="button button-secondary" disabled={!live || busy !== ''} type="submit">{messages.reviseSupplier}</button>
                    </form>
                  </details>
                ) : null}
                <details><summary>{messages.history} ({supplier.versions.length})</summary>
                  <ol className="administration-history">{supplier.versions.map((entry) => <li key={entry.versionNumber}><strong>v{entry.versionNumber}</strong><span>{entry.reason}</span><code>{entry.configurationHash.slice(0, 12)}</code></li>)}</ol>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="administration-panel governance-boundaries" aria-labelledby="governance-boundaries-title">
        <div className="section-heading section-heading-wide"><h3 id="governance-boundaries-title">{messages.governanceTitle}</h3><p>{messages.governanceBody}</p></div>
        <div className="governance-grid">
          <article><h4>{messages.rolesTitle}</h4><p>{messages.rolesBody}</p>{viewerRoles.includes('founder') ? <Link className="button button-secondary" href={`/${locale}/staff/founder/access`}>{messages.openAccessConsole}</Link> : null}</article>
          <article><h4>{messages.limitsTitle}</h4><p>{messages.limitsBody}</p><span className="blocked-status">{messages.notConfigured}</span></article>
          <article><h4>{messages.refundsTitle}</h4><p>{messages.refundsBody}</p><span className="blocked-status">{messages.blocked}</span></article>
        </div>
      </section>

      <p aria-live="polite" className="form-status">{status}</p>
      <p className="authority-note">{messages.boundary}</p>
    </section>
  );
}
