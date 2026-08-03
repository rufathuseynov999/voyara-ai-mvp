export const dynamic = 'force-dynamic';

import { staffAreaRoles } from '@/server/auth/roles';
import { requireAssuranceLevel, requireViewerRole } from '@/server/auth/viewer';
import { requireLocale } from '@/i18n/server';
import { getDictionary } from '@/i18n/dictionaries';
import { loadStaffConsoleSnapshot } from '@/server/agents/automation/staff-console-queries';
import { StaffConsoleActions, ApproveStepButton, RetryDeadLetterButton } from '@/components/staff-console-actions';

export default async function StaffAutomationConsolePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const path = `/${locale}/staff/automation`;
  const viewer = await requireViewerRole(locale, staffAreaRoles, path);
  requireAssuranceLevel(locale, viewer, 'aal2', path);

  const t = getDictionary(locale).staffAutomation;
  const snapshot = await loadStaffConsoleSnapshot();

  return (
    <main className="screen-page staff-automation-console" id="main-content" tabIndex={-1}>
      <h1>{t.title}</h1>

      <section className="state-card">
        <h2>{t.pendingApprovals}</h2>
        {snapshot.pendingApprovals === null ? (
          <p className="orch-note">{t.unavailable}</p>
        ) : snapshot.pendingApprovals.length === 0 ? (
          <p>{t.noPendingApprovals}</p>
        ) : (
          <ul>
            {snapshot.pendingApprovals.map((a) => (
              <li key={a.stepId}>
                {a.stepCode} (run {a.workflowRunId}) — {a.createdAt}
                {' '}<ApproveStepButton locale={locale} stepId={a.stepId} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="state-card">
        <h2>{t.deadLetterQueue}</h2>
        {snapshot.deadLetterQueue === null ? (
          <p className="orch-note">{t.unavailable}</p>
        ) : snapshot.deadLetterQueue.length === 0 ? (
          <p>{t.noDeadLetters}</p>
        ) : (
          <ul>
            {snapshot.deadLetterQueue.map((d) => (
              <li key={d.alertId}>
                {d.reasonCode} (run {d.workflowRunId ?? '—'}) — {d.createdAt}
                {' '}<RetryDeadLetterButton locale={locale} deadLetterId={d.alertId} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="state-card">
        <h2>{t.handoverEscalations}</h2>
        {snapshot.handoverEscalations === null ? (
          <p className="orch-note">{t.unavailable}</p>
        ) : snapshot.handoverEscalations.length === 0 ? (
          <p>{t.noEscalations}</p>
        ) : (
          <ul>
            {snapshot.handoverEscalations.map((h) => (
              <li key={h.conversationId}>
                {h.channel} — since {h.lastInboundAt ?? '—'} — owner: {h.assignedOwnerId ?? 'unassigned'}
                {' '}<StaffConsoleActions locale={locale} conversationId={h.conversationId} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
