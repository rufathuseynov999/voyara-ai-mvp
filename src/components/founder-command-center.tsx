import Link from 'next/link';
import { SimulationBanner } from '@/components/simulation-banner';
import { OrchestrationConsole } from '@/components/orchestration-console';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';
import type { FounderCommandCenterSnapshot } from '@/server/founder/contract';

const numberLocales: Record<Locale, string> = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };

function money(minor: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocales[locale], {
    style: 'currency',
    currency: 'AZN',
    minimumFractionDigits: 2
  }).format(minor / 100);
}

function dateTime(value: string | null, locale: Locale, unavailable: string): string {
  if (!value) return unavailable;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return unavailable;
  return new Intl.DateTimeFormat(numberLocales[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Baku'
  }).format(parsed);
}

function shortReference(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function FounderCommandCenter({
  dictionary,
  locale,
  snapshot
}: {
  dictionary: Dictionary;
  locale: Locale;
  snapshot: FounderCommandCenterSnapshot;
}) {
  const messages = dictionary.founderCommand;
  const screen = dictionary.screens.founder;
  const snapshotReason = messages.reasons[snapshot.reasonCode];

  return (
    <main className="screen-page founder-command-center" id="main-content" tabIndex={-1}>
      <SimulationBanner dictionary={dictionary} />
      <OrchestrationConsole mode="founder" labels={dictionary.phase3b} />
      <section className="screen-heading">
        <span className="screen-number screen-number-large">{screen.number}</span>
        <span className="eyebrow">{messages.eyebrow}</span>
        <h1>{screen.title}</h1>
        <p>{screen.description}</p>
      </section>

      <aside className="authority-strip founder-authority-strip" aria-label={messages.readModelStatus}>
        <div>
          <span>{messages.readModelStatus}</span>
          <strong>{snapshot.dataState === 'LIVE' ? messages.live : messages.unavailable}</strong>
        </div>
        <div>
          <span>{messages.authority}</span>
          <strong>{messages.postgresAuthority}</strong>
        </div>
        <div>
          <span>{messages.generated}</span>
          <strong>{dateTime(snapshot.generatedAt, locale, messages.unavailable)}</strong>
        </div>
      </aside>

      {snapshot.dataState === 'UNAVAILABLE' ? (
        <div className="founder-read-model-warning" role="status">
          <strong>{messages.unavailableTitle}</strong>
          <p>{snapshotReason}</p>
        </div>
      ) : null}

      <section className="founder-section" aria-labelledby="founder-decisions-title">
        <header className="founder-section-heading">
          <div>
            <span className="eyebrow">01 · {screen.states[0]}</span>
            <h2 id="founder-decisions-title">{messages.decisions.title}</h2>
            <p>{messages.decisions.body}</p>
          </div>
          <strong className="founder-total" aria-label={messages.decisions.count}>
            {snapshot.decisions.length}
          </strong>
        </header>
        {snapshot.decisions.length === 0 ? (
          <p className="empty-state">{snapshot.dataState === 'LIVE' ? messages.decisions.empty : snapshotReason}</p>
        ) : (
          <div className="founder-decision-list">
            {snapshot.decisions.map((item) => (
              <article className="founder-decision-card" key={`${item.queueCode}-${item.entityId}`}>
                <div>
                  <span className="status-badge">{messages.decisions.labels[item.queueCode]}</span>
                  <h3>{messages.decisions.labels[item.queueCode]}</h3>
                  <dl className="founder-inline-facts">
                    <div>
                      <dt>{messages.reference}</dt>
                      <dd><code>{shortReference(item.entityId)}</code></dd>
                    </div>
                    <div>
                      <dt>{messages.status}</dt>
                      <dd><code>{item.statusCode}</code></dd>
                    </div>
                    <div>
                      <dt>{messages.waitingSince}</dt>
                      <dd>{dateTime(item.waitingSince, locale, messages.unavailable)}</dd>
                    </div>
                    {item.amountMinor !== null ? (
                      <div>
                        <dt>{messages.amount}</dt>
                        <dd>{money(item.amountMinor, locale)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                <Link className="button button-primary" href={`/${locale}${item.targetPath}`}>
                  {messages.openQueue}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="founder-section" aria-labelledby="founder-financial-title">
        <header className="founder-section-heading">
          <div>
            <span className="eyebrow">02 · {screen.states[1]}</span>
            <h2 id="founder-financial-title">{messages.financial.title}</h2>
            <p>{messages.financial.body}</p>
          </div>
        </header>
        <div className="founder-metric-grid">
          {snapshot.metrics.map((metric) => (
            <article className="founder-metric-card" data-availability={metric.availability} key={metric.metricCode}>
              <span>{messages.financial.labels[metric.metricCode]}</span>
              <strong>
                {metric.availability === 'AVAILABLE' && metric.amountMinor !== null
                  ? money(metric.amountMinor, locale)
                  : messages.unavailable}
              </strong>
              <p>{messages.financial.basis[metric.basisCode as keyof typeof messages.financial.basis] ?? snapshotReason}</p>
              <small>
                {messages.records}: {metric.sourceRecordCount} · {messages.lastChanged}: {dateTime(metric.sourceUpdatedAt, locale, messages.unavailable)}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="founder-section" aria-labelledby="founder-pipeline-title">
        <header className="founder-section-heading">
          <div>
            <span className="eyebrow">03 · {messages.pipeline.eyebrow}</span>
            <h2 id="founder-pipeline-title">{messages.pipeline.title}</h2>
            <p>{messages.pipeline.body}</p>
          </div>
        </header>
        {snapshot.pipeline.length === 0 ? (
          <p className="empty-state">{snapshotReason}</p>
        ) : (
          <ol className="founder-pipeline">
            {snapshot.pipeline.map((stage) => (
              <li key={stage.stageCode}>
                <span>{String(stage.stageOrder).padStart(2, '0')}</span>
                <div>
                  <h3>{messages.pipeline.labels[stage.stageCode]}</h3>
                  <p>{stage.itemCount} {messages.pipeline.items}</p>
                </div>
                {stage.amountMinor !== null ? <strong>{money(stage.amountMinor, locale)}</strong> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="founder-section" aria-labelledby="founder-health-title">
        <header className="founder-section-heading">
          <div>
            <span className="eyebrow">04 · {screen.states[2]}</span>
            <h2 id="founder-health-title">{messages.operations.title}</h2>
            <p>{messages.operations.body}</p>
          </div>
        </header>
        <div className="founder-operations-grid">
          <section className="founder-operations-panel" aria-labelledby="founder-exceptions-title">
            <h3 id="founder-exceptions-title">{messages.exceptions.title}</h3>
            {snapshot.exceptions.length === 0 ? (
              <p>{snapshot.dataState === 'LIVE' ? messages.exceptions.empty : snapshotReason}</p>
            ) : (
              <ul className="founder-exception-list">
                {snapshot.exceptions.map((item) => (
                  <li key={`${item.exceptionCode}-${item.entityId}`}>
                    <span className={`status-badge ${item.severity === 'CRITICAL' ? 'status-danger' : ''}`}>
                      {messages.exceptions.severity[item.severity]}
                    </span>
                    <strong>{messages.exceptions.labels[item.exceptionCode]}</strong>
                    <code>{shortReference(item.entityId)} · {item.statusCode}</code>
                    {item.amountMinor !== null ? <span>{money(item.amountMinor, locale)}</span> : null}
                    <Link href={`/${locale}${item.targetPath}`}>{messages.openQueue}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="founder-operations-panel" aria-labelledby="founder-workload-title">
            <h3 id="founder-workload-title">{messages.workload.title}</h3>
            {snapshot.workloads.length === 0 ? (
              <p>{snapshot.dataState === 'LIVE' ? messages.workload.empty : snapshotReason}</p>
            ) : (
              <ul className="founder-workload-list">
                {snapshot.workloads.map((item) => (
                  <li key={item.actorId ?? 'unassigned'}>
                    <div>
                      <strong>
                        {item.actorId
                          ? item.displayName === 'TEAM_MEMBER' ? messages.workload.teamMember : item.displayName
                          : messages.workload.unassigned}
                      </strong>
                      <small>{item.actorId ? item.roleSummary : messages.workload.needsOwner}</small>
                    </div>
                    <span>{item.totalItems}</span>
                    <dl>
                      <div><dt>{messages.workload.travel}</dt><dd>{item.travelRequestItems}</dd></div>
                      <div><dt>{messages.workload.payment}</dt><dd>{item.paymentItems}</dd></div>
                      <div><dt>{messages.workload.booking}</dt><dd>{item.bookingItems}</dd></div>
                      <div><dt>{messages.workload.support}</dt><dd>{item.supportItems}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="founder-operations-panel" aria-labelledby="founder-sources-title">
            <h3 id="founder-sources-title">{messages.sources.title}</h3>
            {snapshot.sourceFreshness.length === 0 ? (
              <p>{snapshotReason}</p>
            ) : (
              <ul className="founder-source-list">
                {snapshot.sourceFreshness.map((source) => (
                  <li key={source.sourceCode}>
                    <div>
                      <strong>{messages.sources.labels[source.sourceCode]}</strong>
                      <small>{dateTime(source.lastChangedAt, locale, messages.unavailable)}</small>
                    </div>
                    <span data-source-status={source.sourceStatus}>
                      {messages.sources.status[source.sourceStatus]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>

      <section className="supporting-control">
        <div>
          <h2>{dictionary.founderAccess.linkTitle}</h2>
          <p>{dictionary.founderAccess.linkBody}</p>
        </div>
        <Link className="button button-primary" href={`/${locale}/staff/founder/access`}>
          {dictionary.founderAccess.open}
        </Link>
      </section>

      <aside className="authority-note founder-boundary-note">
        <strong>{messages.boundaryTitle}</strong>
        <p>{messages.boundary}</p>
      </aside>
    </main>
  );
}
