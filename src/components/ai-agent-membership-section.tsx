import type { Locale } from '@/i18n/config';
import type { AgentStatus, AgentKey, AgentSectionEntry } from '@/lib/ai-agent-membership-data';
import {
  SECTION_TITLE,
  SECTION_INTRO,
  STATUS_LABEL,
  AGENTS_BY_LOCALE,
  FIELD_LABELS
} from '@/lib/ai-agent-membership-data';

/**
 * Phase C5 / C7.2 — AI-Agent Membership Value section component.
 *
 * All localized content and statuses live in
 * src/lib/ai-agent-membership-data.ts, the shared authority also consumed
 * by the standalone HTML export bridge — this file only renders.
 */

export function AiAgentMembershipSection({ locale }: { locale: Locale }) {
  const agents = AGENTS_BY_LOCALE[locale];
  const labels = FIELD_LABELS[locale];
  const statusLabels = STATUS_LABEL[locale];

  return (
    <section className="ai-agent-membership-section" aria-labelledby="ai-agent-section-title">
      <div className="section-heading">
        <span className="eyebrow">VOYARA AI</span>
        <h2 id="ai-agent-section-title">{SECTION_TITLE[locale]}</h2>
        <p>{SECTION_INTRO[locale]}</p>
      </div>

      <div className="ai-agent-grid">
        {agents.map((agent) => (
          <article className="ai-agent-card" key={agent.key}>
            <div className="ai-agent-card-header">
              <h3>{agent.name}</h3>
              <span className={`ai-agent-status ai-agent-status-${agent.status.toLowerCase().replace(/_/g, '-')}`}>
                {statusLabels[agent.status]}
              </span>
            </div>
            <p className="ai-agent-benefit">{agent.memberBenefit}</p>
            <dl className="ai-agent-detail-list">
              <dt>{labels.prepares}</dt>
              <dd>{agent.prepares}</dd>

              <dt>{labels.automates}</dt>
              <dd>{agent.safelyAutomates}</dd>

              <dt>{labels.approval}</dt>
              <dd>{agent.requiresApproval}</dd>

              <dt>{labels.channel}</dt>
              <dd>{agent.channel}</dd>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
