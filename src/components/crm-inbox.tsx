'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Phase 4B — unified staff inbox. Reads/writes only through
 * /api/v1/inbox, which requires AAL2 staff on every call — the same
 * transport-and-authority pattern as OrchestrationConsole. No
 * cross-customer leakage is possible from this component: it never receives
 * or requests data for more than one conversation's contact at a time, and
 * every request is scoped server-side by the authenticated staff session,
 * not by anything this component sends.
 */

type Summary = {
  conversationId: string; contactId: string; contactName: string | null; channel: string;
  customerFacingBrand: 'RTRAVEL' | 'VOYARA' | null; status: string; handoverStatus: 'AI' | 'HUMAN';
  assignedOwnerId: string | null; preferredLocale: string | null; lastMessageAt: string | null; createdAt: string;
  unread: boolean; slaOverdue: boolean;
};
type VoiceCall = {
  callId: string; calledNumber: string; callerNumber: string; brand: 'RTRAVEL' | 'VOYARA'; status: string;
  detectedLanguage: string | null; durationSeconds: number | null; transcript: string | null; aiSummary: string | null;
  urgency: string | null; transferStatus: string | null; handoverStatus: 'AI' | 'HUMAN';
  consent: { aiDisclosure: string; recording: string; transcription: string; crmStorage: string; followUp: string };
  recordingEnabled: boolean; startedAt: string; endedAt: string | null;
  callbackTasks: Array<{ taskId: string; dueAt: string; status: string; notes: string | null }>;
  callEvents: Array<{ kind: string; actorKind: string; reasonCode: string | null; occurredAt: string }>;
};
type Detail = Summary & {
  linkedIdentities: Array<{ identityKind: string; externalId: string; verified: boolean }>;
  messages: Array<{ messageId: string; direction: string; senderKind: string; body: string; status: string; createdAt: string }>;
  paymentLinks: Array<{ paymentLinkId: string; orderReference: string; status: string; amountMinor: number; currency: string; transactionType: string }>;
  voiceCall: VoiceCall | null;
};

export type InboxLabels = {
  title: string; description: string; filterBrand: string; filterChannel: string; filterLanguage: string; filterStatus: string; filterOwner: string;
  allBrands: string; allChannels: string; allLanguages: string; allStatuses: string; noConversations: string; selectConversation: string;
  linkedIdentities: string; timeline: string; paymentLinks: string; assign: string; handoverToHuman: string; handoverToAi: string; escalate: string;
  assigned: string; unassigned: string; handoverAi: string; handoverHuman: string; verified: string; unverified: string;
  filterCallStatus: string; filterUrgency: string; filterCallback: string; allCallStatuses: string; anyUrgency: string; anyCallback: string;
  callbackRequiredOpt: string; callbackCompletedOpt: string; voiceCallTitle: string; aiSummaryTitle: string; transcriptTitle: string;
  callbackTasksTitle: string; callAuditTitle: string; calledLabel: string; callerLabel: string; statusLabel: string; durationLabel: string;
  languageLabel: string; urgencyLabel: string; transferLabel: string; recordingLabel: string; enabledWord: string; disabledWord: string;
  consentLabel: string; dueLabel: string; unreadAria: string; slaOverdueTitle: string;
};

export function CrmInbox({ labels }: { labels: InboxLabels }) {
  const [conversations, setConversations] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [filters, setFilters] = useState<{ brand: string; channel: string; language: string; status: string; callStatus: string; urgency: string; callbackRequired: string }>({ brand: '', channel: '', language: '', status: '', callStatus: '', urgency: '', callbackRequired: '' });
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.brand) params.set('brand', filters.brand);
    if (filters.channel) params.set('channel', filters.channel);
    if (filters.language) params.set('language', filters.language);
    if (filters.status) params.set('status', filters.status);
    if (filters.callStatus) params.set('callStatus', filters.callStatus);
    if (filters.urgency) params.set('urgency', filters.urgency);
    if (filters.callbackRequired) params.set('callbackRequired', filters.callbackRequired);
    const response = await fetch(`/api/v1/inbox?${params.toString()}`);
    const body = await response.json();
    setConversations(response.ok ? body.conversations ?? [] : []);
    setLoading(false);
  }, [filters]);

  useEffect(() => { void loadList(); }, [loadList]);

  async function openConversation(conversationId: string) {
    const response = await fetch(`/api/v1/inbox?conversationId=${conversationId}`);
    const body = await response.json();
    setSelected(response.ok ? body.conversation : null);
  }

  async function runAction(action: 'assign' | 'handover' | 'escalate', extra: Record<string, unknown> = {}) {
    if (!selected) return;
    await fetch('/api/v1/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ action, conversationId: selected.conversationId, ...extra })
    });
    await openConversation(selected.conversationId);
    await loadList();
  }

  return (
    <section className="crm-inbox state-card">
      <h2>{labels.title}</h2>
      <p className="orch-note">{labels.description}</p>

      <div className="inbox-filters">
        <select aria-label={labels.filterBrand} onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))} value={filters.brand}>
          <option value="">{labels.allBrands}</option>
          <option value="RTRAVEL">R-Travel</option>
          <option value="VOYARA">VOYARA</option>
        </select>
        <select aria-label={labels.filterChannel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))} value={filters.channel}>
          <option value="">{labels.allChannels}</option>
          <option value="INSTAGRAM_DM">Instagram DM</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="WEB_CHAT">Web Chat</option>
          <option value="VOICE">Voice</option>
          <option value="SIMULATION">Simulation</option>
        </select>
        <select aria-label={labels.filterLanguage} onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value }))} value={filters.language}>
          <option value="">{labels.allLanguages}</option>
          <option value="az">AZ</option>
          <option value="ru">RU</option>
          <option value="en">EN</option>
        </select>
        <select aria-label={labels.filterStatus} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} value={filters.status}>
          <option value="">{labels.allStatuses}</option>
          <option value="OPEN">OPEN</option>
          <option value="PENDING_HUMAN">PENDING_HUMAN</option>
          <option value="ESCALATED">ESCALATED</option>
          <option value="RESOLVED">RESOLVED</option>
        </select>
        <select aria-label={labels.filterCallStatus} onChange={(e) => setFilters((f) => ({ ...f, callStatus: e.target.value }))} value={filters.callStatus}>
          <option value="">{labels.allCallStatuses}</option>
          <option value="STARTED">STARTED</option>
          <option value="RINGING">RINGING</option>
          <option value="ANSWERED">ANSWERED</option>
          <option value="TRANSFERRED">TRANSFERRED</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <select aria-label={labels.filterUrgency} onChange={(e) => setFilters((f) => ({ ...f, urgency: e.target.value }))} value={filters.urgency}>
          <option value="">{labels.anyUrgency}</option>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
        </select>
        <select aria-label={labels.filterCallback} onChange={(e) => setFilters((f) => ({ ...f, callbackRequired: e.target.value }))} value={filters.callbackRequired}>
          <option value="">{labels.anyCallback}</option>
          <option value="true">{labels.callbackRequiredOpt}</option>
          <option value="false">{labels.callbackCompletedOpt}</option>
        </select>
      </div>

      <div className="inbox-layout">
        <ul className="inbox-list" aria-busy={loading}>
          {conversations.length === 0 ? <li className="inbox-empty">{labels.noConversations}</li> : null}
          {conversations.map((c) => (
            <li key={c.conversationId}>
              <button className={`inbox-row${selected?.conversationId === c.conversationId ? ' is-active' : ''}${c.unread ? ' is-unread' : ''}`} onClick={() => openConversation(c.conversationId)}>
                {c.unread && <span className="inbox-unread-dot" aria-label={labels.unreadAria} />}
                <span className={`inbox-brand-badge inbox-brand-${(c.customerFacingBrand ?? 'unknown').toLowerCase()}`}>{c.customerFacingBrand ?? '—'}</span>
                <span className="inbox-contact">{c.contactName ?? c.contactId.slice(0, 8)}</span>
                <span className="inbox-channel">{c.channel}</span>
                <span className="inbox-status">{c.status}</span>
                {c.slaOverdue && <span className="inbox-sla-badge" title={labels.slaOverdueTitle}>SLA</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="inbox-detail">
          {!selected ? <p className="orch-note">{labels.selectConversation}</p> : (
            <>
              <div className="inbox-detail-header">
                <span className={`inbox-brand-badge inbox-brand-${(selected.customerFacingBrand ?? 'unknown').toLowerCase()}`}>{selected.customerFacingBrand ?? '—'}</span>
                <strong>{selected.contactName ?? selected.contactId}</strong>
                <span>{selected.assignedOwnerId ? labels.assigned : labels.unassigned}</span>
                <span>{selected.handoverStatus === 'AI' ? labels.handoverAi : labels.handoverHuman}</span>
              </div>

              <div className="inbox-actions">
                <button className="button button-outline-dark" onClick={() => runAction('assign')}>{labels.assign}</button>
                {selected.handoverStatus === 'AI' ? (
                  <button className="button button-secondary" onClick={() => runAction('handover', { status: 'HUMAN' })}>{labels.handoverToHuman}</button>
                ) : (
                  <button className="button button-outline-dark" onClick={() => runAction('handover', { status: 'AI' })}>{labels.handoverToAi}</button>
                )}
                <button className="button button-danger" onClick={() => runAction('escalate', { reasonCode: 'STAFF_ESCALATED' })}>{labels.escalate}</button>
              </div>

              <h3>{labels.linkedIdentities}</h3>
              <ul className="inbox-identities">
                {selected.linkedIdentities.map((i) => (
                  <li key={`${i.identityKind}-${i.externalId}`}>{i.identityKind}: {i.externalId} ({i.verified ? labels.verified : labels.unverified})</li>
                ))}
              </ul>

              <h3>{labels.paymentLinks}</h3>
              <ul className="inbox-payment-links">
                {selected.paymentLinks.map((p) => (
                  <li key={p.paymentLinkId}>{p.orderReference} — {p.transactionType} — {(p.amountMinor / 100).toFixed(2)} {p.currency} — {p.status}</li>
                ))}
              </ul>

              {selected.voiceCall && (
                <>
                  <h3>{labels.voiceCallTitle}</h3>
                  <ul className="inbox-voice-detail">
                    <li>{labels.calledLabel}: {selected.voiceCall.calledNumber} ({selected.voiceCall.brand}) — {labels.callerLabel}: {selected.voiceCall.callerNumber}</li>
                    <li>{labels.statusLabel}: {selected.voiceCall.status} — {labels.durationLabel}: {selected.voiceCall.durationSeconds ?? '—'}s — {labels.languageLabel}: {selected.voiceCall.detectedLanguage ?? '—'}</li>
                    {selected.voiceCall.urgency && <li className={`inbox-urgency inbox-urgency-${selected.voiceCall.urgency.toLowerCase()}`}>{labels.urgencyLabel}: {selected.voiceCall.urgency}</li>}
                    {selected.voiceCall.transferStatus && <li>{labels.transferLabel}: {selected.voiceCall.transferStatus}</li>}
                    <li>{labels.recordingLabel}: {selected.voiceCall.recordingEnabled ? labels.enabledWord : labels.disabledWord} ({labels.consentLabel}: {selected.voiceCall.consent.recording})</li>
                  </ul>
                  {selected.voiceCall.aiSummary && (
                    <>
                      <h4>{labels.aiSummaryTitle}</h4>
                      <p className="inbox-voice-summary">{selected.voiceCall.aiSummary}</p>
                    </>
                  )}
                  {selected.voiceCall.transcript && (
                    <>
                      <h4>{labels.transcriptTitle}</h4>
                      <p className="inbox-voice-transcript">{selected.voiceCall.transcript}</p>
                    </>
                  )}
                  {selected.voiceCall.callbackTasks.length > 0 && (
                    <>
                      <h4>{labels.callbackTasksTitle}</h4>
                      <ul className="inbox-callback-tasks">
                        {selected.voiceCall.callbackTasks.map((t) => (
                          <li key={t.taskId}>{t.status} — {labels.dueLabel} {new Date(t.dueAt).toLocaleString()} {t.notes ? `— ${t.notes}` : ''}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <h4>{labels.callAuditTitle}</h4>
                  <ul className="inbox-call-events">
                    {selected.voiceCall.callEvents.map((e, i) => (
                      <li key={i}>{e.kind} ({e.actorKind}){e.reasonCode ? ` — ${e.reasonCode}` : ''} — {new Date(e.occurredAt).toLocaleString()}</li>
                    ))}
                  </ul>
                </>
              )}

              <h3>{labels.timeline}</h3>
              <ul className="inbox-timeline">
                {selected.messages.map((m) => (
                  <li key={m.messageId} className={`inbox-message inbox-message-${m.direction.toLowerCase()}`}>
                    <span className="inbox-message-meta">{m.senderKind} · {m.status}</span>
                    <span className="inbox-message-body">{m.body}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
