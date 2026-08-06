import type { Locale } from '@/i18n/config';
import type { PlanComparisonEntry, CurrentMembership, PaymentHistoryEntry } from '@/server/agents/subscriptions/customer-subscription-queries';
import {
  MEMBERSHIP_CATALOGUE,
  PERSONAL_PLANS,
  CORPORATE_PLANS,
  getFullBenefitList,
  getInheritanceLabel,
  getResolvedPricing,
  ANNUAL_VALUE_FRAMING,
  type MembershipPlanDefinition
} from '@/lib/membership-catalogue';
import { PersonalMembershipComparison, CorporateMembershipComparison } from '@/components/membership-comparison';
import { MemberValueJourney } from '@/components/member-value-journey';
import { AiAgentMembershipSection } from '@/components/ai-agent-membership-section';
import type { PlanCode } from '@/server/agents/subscriptions/plan-authority';

/**
 * Phase 4F/C2 — customer-facing membership screen.
 *
 * Pricing is never hardcoded here: `PlanComparisonEntry[]` (via
 * loadPlanComparison → LOCKED_PLAN_PRICES) remains the sole pricing
 * authority. All plan NAMES, POSITIONING, BENEFITS, and CTA copy come
 * exclusively from `src/lib/membership-catalogue.ts` — this component does
 * not maintain a second copy of that content (the old `PLAN_DISPLAY_NAMES`
 * map has been removed).
 *
 * Every status, billing-cycle, transaction-type and usage-key value coming
 * from the database is an internal enum and is never rendered raw — each is
 * mapped through a localized dictionary below before display.
 *
 * Upgrade/downgrade/cancellation remain presented as REQUESTS the customer
 * can initiate; the actual state change still goes through the lifecycle
 * service's own AAL2/actor-checked functions, never this component
 * directly.
 */

const TEXT: Record<Locale, Record<string, string>> = {
  az: {
    title: 'Üzvlük', planComparison: 'Planların müqayisəsi', monthly: 'Aylıq', annual: 'İllik',
    currentMembership: 'Cari üzvlüyünüz', noMembership: 'Aktiv üzvlüyünüz yoxdur.', status: 'Status',
    renewalDate: 'Yenilənmə tarixi', billingCycle: 'Ödəniş dövrü', paymentHistory: 'Ödəniş tarixçəsi',
    noPayments: 'Ödəniş tarixçəsi yoxdur.', entitlementUsage: 'İstifadə həddi', noUsage: 'İstifadə məlumatı yoxdur.',
    requestUpgrade: 'Planı yüksəltmək üçün dəstək xidmətinə müraciət edin.', requestDowngrade: 'Planı endirmək üçün dəstək xidmətinə müraciət edin.',
    requestCancellation: 'Ləğv etmək üçün dəstək xidmətinə müraciət edin — dövrün sonunda qüvvəyə minəcək.',
    failedPaymentRecovery: 'Ödəniş uğursuz oldu. Zəhmət olmasa ödəniş üsulunuzu yeniləyin və ya dəstək xidməti ilə əlaqə saxlayın.',
    cancelPending: 'Ləğvetmə tələbiniz qeydə alınıb — dövrün sonunda qüvvəyə minəcək.',
    personalPlans: 'Şəxsi planlar', corporatePlans: 'Korporativ planlar', bestFor: 'Kimin üçün uyğundur',
    memberRateAccess: 'Üzv tarifi çıxışı', searchDepth: 'Axtarış dərinliyi', servicePriority: 'Xidmət prioriteti',
    humanReview: 'İnsan yoxlaması', concierge: 'Konsyerj səviyyəsi', aiAgents: 'AI agent iştirakı',
    approvalGate: 'İnsan Təsdiq Qapısı', fairUse: 'Ədalətli istifadə', availability: 'Mövcudluq şərtləri',
    upgradeTrigger: 'Nə vaxt yüksəltmək lazımdır', annualSaving: 'İllik qənaət', currentPlanBadge: 'Cari planınız'
  },
  ru: {
    title: 'Членство', planComparison: 'Сравнение планов', monthly: 'Ежемесячно', annual: 'Ежегодно',
    currentMembership: 'Ваше текущее членство', noMembership: 'У вас нет активного членства.', status: 'Статус',
    renewalDate: 'Дата продления', billingCycle: 'Цикл оплаты', paymentHistory: 'История платежей',
    noPayments: 'История платежей отсутствует.', entitlementUsage: 'Использование лимитов', noUsage: 'Данные об использовании отсутствуют.',
    requestUpgrade: 'Обратитесь в службу поддержки для повышения плана.', requestDowngrade: 'Обратитесь в службу поддержки для понижения плана.',
    requestCancellation: 'Обратитесь в службу поддержки для отмены — вступит в силу в конце периода.',
    failedPaymentRecovery: 'Платёж не прошёл. Обновите способ оплаты или свяжитесь со службой поддержки.',
    cancelPending: 'Ваш запрос на отмену зарегистрирован — вступит в силу в конце периода.',
    personalPlans: 'Личные планы', corporatePlans: 'Корпоративные планы', bestFor: 'Кому подходит',
    memberRateAccess: 'Доступ к тарифам участника', searchDepth: 'Глубина поиска', servicePriority: 'Приоритет обслуживания',
    humanReview: 'Проверка человеком', concierge: 'Уровень консьержа', aiAgents: 'Участие ИИ-агентов',
    approvalGate: 'Шлюз подтверждения человеком', fairUse: 'Добросовестное использование', availability: 'Условия доступности',
    upgradeTrigger: 'Когда стоит перейти выше', annualSaving: 'Годовая экономия', currentPlanBadge: 'Ваш текущий план'
  },
  en: {
    title: 'Membership', planComparison: 'Plan comparison', monthly: 'Monthly', annual: 'Annual',
    currentMembership: 'Your current membership', noMembership: 'You have no active membership.', status: 'Status',
    renewalDate: 'Renewal date', billingCycle: 'Billing cycle', paymentHistory: 'Payment history',
    noPayments: 'No payment history yet.', entitlementUsage: 'Entitlement usage', noUsage: 'No usage data yet.',
    requestUpgrade: 'Contact support to request a plan upgrade.', requestDowngrade: 'Contact support to request a plan downgrade.',
    requestCancellation: 'Contact support to request cancellation — takes effect at the end of your current period.',
    failedPaymentRecovery: 'Your last payment failed. Please update your payment method or contact support.',
    cancelPending: 'Your cancellation request is on file — it will take effect at the end of your current period.',
    personalPlans: 'Personal plans', corporatePlans: 'Corporate plans', bestFor: 'Best for',
    memberRateAccess: 'Member-rate access', searchDepth: 'Search depth', servicePriority: 'Service priority',
    humanReview: 'Human review', concierge: 'Concierge level', aiAgents: 'AI-agent involvement',
    approvalGate: 'Human Approval Gate', fairUse: 'Fair use', availability: 'Availability conditions',
    upgradeTrigger: 'When to upgrade', annualSaving: 'Annual saving', currentPlanBadge: 'Your current plan'
  }
};

// ---------------------------------------------------------------------------
// Enum -> localized professional text. Nothing raw is ever rendered.
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<Locale, Record<string, string>> = {
  az: {
    ACTIVE: 'Aktiv', GRACE_PERIOD: 'Güzəşt müddəti', PAYMENT_FAILED: 'Ödəniş uğursuz oldu', TRIAL: 'Sınaq müddəti',
    PENDING_PAYMENT: 'Ödəniş gözlənilir', RENEWAL_PENDING: 'Yenilənmə gözlənilir',
    SCHEDULED_UPGRADE: 'Yüksəltmə planlaşdırılıb', SCHEDULED_DOWNGRADE: 'Endirmə planlaşdırılıb'
  },
  ru: {
    ACTIVE: 'Активно', GRACE_PERIOD: 'Льготный период', PAYMENT_FAILED: 'Платёж не прошёл', TRIAL: 'Пробный период',
    PENDING_PAYMENT: 'Ожидается оплата', RENEWAL_PENDING: 'Ожидается продление',
    SCHEDULED_UPGRADE: 'Запланировано повышение', SCHEDULED_DOWNGRADE: 'Запланировано понижение'
  },
  en: {
    ACTIVE: 'Active', GRACE_PERIOD: 'Grace period', PAYMENT_FAILED: 'Payment failed', TRIAL: 'Trial',
    PENDING_PAYMENT: 'Payment pending', RENEWAL_PENDING: 'Renewal pending',
    SCHEDULED_UPGRADE: 'Upgrade scheduled', SCHEDULED_DOWNGRADE: 'Downgrade scheduled'
  }
};

const TRANSACTION_TYPE_TEXT: Record<Locale, Record<string, string>> = {
  az: {
    INITIAL_PAYMENT: 'İlkin ödəniş', RENEWAL: 'Yenilənmə', UPGRADE: 'Yüksəltmə', DOWNGRADE_ADJUSTMENT: 'Endirmə tənzimləməsi',
    FAILED_PAYMENT_RETRY: 'Uğursuz ödənişin təkrarı', CORPORATE_SUBSCRIPTION: 'Korporativ abunə',
    AUTHORISED_BALANCE_PAYMENT: 'Təsdiqlənmiş balans ödənişi'
  },
  ru: {
    INITIAL_PAYMENT: 'Первоначальный платёж', RENEWAL: 'Продление', UPGRADE: 'Повышение', DOWNGRADE_ADJUSTMENT: 'Корректировка при понижении',
    FAILED_PAYMENT_RETRY: 'Повтор неудавшегося платежа', CORPORATE_SUBSCRIPTION: 'Корпоративная подписка',
    AUTHORISED_BALANCE_PAYMENT: 'Подтверждённый платёж с баланса'
  },
  en: {
    INITIAL_PAYMENT: 'Initial payment', RENEWAL: 'Renewal', UPGRADE: 'Upgrade', DOWNGRADE_ADJUSTMENT: 'Downgrade adjustment',
    FAILED_PAYMENT_RETRY: 'Failed-payment retry', CORPORATE_SUBSCRIPTION: 'Corporate subscription',
    AUTHORISED_BALANCE_PAYMENT: 'Authorised balance payment'
  }
};

/** Known usage-key labels. `usageLimits` keys are founder-configurable
 *  (see plan-authority.ts), so this list is deliberately not exhaustive —
 *  any key not listed here is humanized (camelCase -> spaced words) rather
 *  than shown as a raw programmatic identifier. */
const USAGE_KEY_TEXT: Record<Locale, Record<string, string>> = {
  az: { tripsPerMonth: 'Aylıq səyahət sayı' },
  ru: { tripsPerMonth: 'Поездок в месяц' },
  en: { tripsPerMonth: 'Trips per month' }
};

function humanizeIdentifier(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function localizedUsageKey(locale: Locale, key: string): string {
  return USAGE_KEY_TEXT[locale][key] ?? humanizeIdentifier(key);
}

function localizedStatus(locale: Locale, status: string): string {
  return STATUS_TEXT[locale][status] ?? humanizeIdentifier(status);
}

function localizedTransactionType(locale: Locale, type: string): string {
  return TRANSACTION_TYPE_TEXT[locale][type] ?? humanizeIdentifier(type);
}

function localizedBillingCycle(locale: Locale, billingCycle: string, t: Record<string, string>): string {
  return billingCycle === 'ANNUAL' ? t.annual : t.monthly;
}

function catalogueEntryForPlanCode(planCode: string): MembershipPlanDefinition | null {
  return MEMBERSHIP_CATALOGUE.find((p) => p.planCode === planCode) ?? null;
}

const UNKNOWN_PLAN_TEXT: Record<Locale, string> = { az: 'Naməlum plan', ru: 'Неизвестный план', en: 'Unknown plan' };

function formatPrice(minorUnits: number | null): string {
  if (minorUnits === null) return '—';
  return `${(minorUnits / 100).toFixed(0)} ₼`;
}

function localeTag(locale: Locale): string {
  return locale === 'az' ? 'az-AZ' : locale === 'ru' ? 'ru-RU' : 'en-US';
}

function formatDate(locale: Locale, isoDate: string | null): string | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(localeTag(locale), { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export function CustomerMembershipScreen({
  locale, plans, membership, paymentHistory, usage
}: {
  locale: Locale;
  plans: PlanComparisonEntry[];
  membership: CurrentMembership;
  paymentHistory: PaymentHistoryEntry[];
  usage: Array<{ usageKey: string; usedAmount: number; periodStart: string; periodEnd: string }>;
}) {
  const t = TEXT[locale];
  const priceByCode = new Map(plans.map((p) => [p.planCode as string, p]));
  const currentPlanEntry = membership ? catalogueEntryForPlanCode(membership.planCode) : null;
  const currentPlanName = currentPlanEntry ? currentPlanEntry.name[locale] : UNKNOWN_PLAN_TEXT[locale];

  return (
    <main className="screen-page membership-page" id="main-content" tabIndex={-1}>
      <h1>{t.title}</h1>

      <section className="state-card">
        <h2>{t.currentMembership}</h2>
        {!membership ? (
          <p>{t.noMembership}</p>
        ) : (
          <>
            <p><strong>{currentPlanName}</strong> — {t.status}: {localizedStatus(locale, membership.status)}</p>
            <p>{t.billingCycle}: {localizedBillingCycle(locale, membership.billingCycle, t)}</p>
            {formatDate(locale, membership.nextPaymentDate) && (
              <p>{t.renewalDate}: {formatDate(locale, membership.nextPaymentDate)}</p>
            )}
            {membership.status === 'PAYMENT_FAILED' && <p className="orch-note">{t.failedPaymentRecovery}</p>}
            {membership.cancelAtPeriodEnd && <p className="orch-note">{t.cancelPending}</p>}
            <p className="orch-note">{t.requestUpgrade}</p>
            <p className="orch-note">{t.requestDowngrade}</p>
            {!membership.cancelAtPeriodEnd && <p className="orch-note">{t.requestCancellation}</p>}
          </>
        )}
      </section>

      <MembershipPlanGroup
        title={t.personalPlans}
        plans={PERSONAL_PLANS}
        locale={locale}
        t={t}
        priceByCode={priceByCode}
        currentPlanCode={membership?.planCode ?? null}
      />

      <MembershipPlanGroup
        title={t.corporatePlans}
        plans={CORPORATE_PLANS}
        locale={locale}
        t={t}
        priceByCode={priceByCode}
        currentPlanCode={membership?.planCode ?? null}
      />

      <section className="state-card">
        <h2>{t.planComparison}</h2>
        <PersonalMembershipComparison locale={locale} />
        <CorporateMembershipComparison locale={locale} />
      </section>

      <MemberValueJourney locale={locale} />

      <AiAgentMembershipSection locale={locale} />

      {membership && (
        <section className="state-card">
          <h2>{t.entitlementUsage}</h2>
          {usage.length === 0 ? <p>{t.noUsage}</p> : (
            <ul>
              {usage.map((u) => (
                <li key={`${u.usageKey}-${u.periodStart}`}>
                  {localizedUsageKey(locale, u.usageKey)}: {u.usedAmount} ({formatDate(locale, u.periodStart)} – {formatDate(locale, u.periodEnd)})
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {membership && (
        <section className="state-card">
          <h2>{t.paymentHistory}</h2>
          {paymentHistory.length === 0 ? <p>{t.noPayments}</p> : (
            <ul>
              {paymentHistory.map((p) => (
                <li key={p.eventId}>
                  {formatDate(locale, p.receivedAt) ?? p.receivedAt.slice(0, 10)} — {localizedTransactionType(locale, p.transactionType)} — {p.amountMinorUnits !== null ? formatPrice(p.amountMinorUnits) : '—'} — {p.accepted ? '✓' : '✗'}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Rich plan presentation — the 16-item Phase C2 requirement, sourced
// entirely from the authoritative catalogue.
// ---------------------------------------------------------------------------

function MembershipPlanGroup({
  title, plans, locale, t, priceByCode, currentPlanCode
}: {
  title: string;
  plans: readonly MembershipPlanDefinition[];
  locale: Locale;
  t: Record<string, string>;
  priceByCode: Map<string, PlanComparisonEntry>;
  currentPlanCode: string | null;
}) {
  return (
    <section className="state-card membership-plan-group">
      <h2>{title}</h2>
      <div className="membership-plan-grid">
        {plans.map((plan) => (
          <MembershipPlanCard
            key={plan.planCode}
            plan={plan}
            locale={locale}
            t={t}
            priceEntry={priceByCode.get(plan.planCode)}
            isCurrent={currentPlanCode === plan.planCode}
          />
        ))}
      </div>
    </section>
  );
}

function MembershipPlanCard({
  plan, locale, t, priceEntry, isCurrent
}: {
  plan: MembershipPlanDefinition;
  locale: Locale;
  t: Record<string, string>;
  priceEntry: PlanComparisonEntry | undefined;
  isCurrent: boolean;
}) {
  const resolved = getResolvedPricing(plan.planCode as PlanCode);
  const inheritanceLabel = getInheritanceLabel(plan.planCode as PlanCode, locale);
  const fullBenefits = getFullBenefitList(plan.planCode as PlanCode, locale);
  const monthly = priceEntry ? formatPrice(priceEntry.monthlyPriceMinorUnits) : resolved.monthlyDisplay !== null ? `${resolved.monthlyDisplay} ₼` : '—';
  const annual = priceEntry ? formatPrice(priceEntry.annualPriceMinorUnits) : resolved.annualDisplay !== null ? `${resolved.annualDisplay} ₼` : '—';

  return (
    <article className={`membership-plan-card${isCurrent ? ' current' : ''}`}>
      {isCurrent && <span className="plan-tag">{t.currentPlanBadge}</span>}
      <h3>{plan.name[locale]}</h3>
      <p className="plan-positioning">{plan.positioning[locale]}</p>
      <p className="plan-best-for"><strong>{t.bestFor}:</strong> {plan.bestFor[locale]}</p>

      <p className="plan-pricing">
        {resolved.isCustomPriced ? (
          <span>{plan.name[locale]}</span>
        ) : (
          <>
            <span>{monthly}/{t.monthly.toLowerCase()}</span>
            {resolved.annualDisplay !== null && (
              <span> · {annual}/{t.annual.toLowerCase()}</span>
            )}
            {resolved.annualSavingDisplay !== null && (
              <span className="plan-annual-saving"> · {ANNUAL_VALUE_FRAMING[locale]} — {t.annualSaving}: {resolved.annualSavingDisplay} ₼</span>
            )}
          </>
        )}
      </p>

      {inheritanceLabel && <p className="plan-inherit">{inheritanceLabel}</p>}
      <ul className="plan-benefits">
        {fullBenefits.map((benefit) => (
          <li key={benefit}>{benefit}</li>
        ))}
      </ul>

      <dl className="plan-detail-list">
        <dt>{t.memberRateAccess}</dt>
        <dd>{plan.memberRateAccess[locale]}</dd>

        <dt>{t.searchDepth}</dt>
        <dd>{plan.searchDepth[locale]}</dd>

        <dt>{t.servicePriority}</dt>
        <dd>{SERVICE_PRIORITY_TEXT[locale][plan.servicePriority]}</dd>

        <dt>{t.humanReview}</dt>
        <dd>{HUMAN_REVIEW_TEXT[locale][plan.humanReviewLevel]}</dd>

        <dt>{t.concierge}</dt>
        <dd>{CONCIERGE_TEXT[locale][plan.conciergeLevel]}</dd>

        <dt>{t.aiAgents}</dt>
        <dd>
          <ul>
            {plan.aiAgentInvolvement.map((a) => (
              <li key={a.agentKey}>{a.role[locale]}</li>
            ))}
          </ul>
        </dd>

        <dt>{t.approvalGate}</dt>
        <dd>{plan.humanApprovalBoundary[locale]}</dd>

        <dt>{t.fairUse}</dt>
        <dd>{plan.fairUseDisclosure[locale]}</dd>

        <dt>{t.availability}</dt>
        <dd>{plan.availabilityDisclosure[locale]}</dd>

        <dt>{t.upgradeTrigger}</dt>
        <dd>{plan.upgradeTrigger[locale]}</dd>
      </dl>

      {!isCurrent && <p className="orch-note plan-cta">{plan.ctaLabel[locale]}</p>}
    </article>
  );
}

const SERVICE_PRIORITY_TEXT: Record<Locale, Record<string, string>> = {
  az: { STANDARD: 'Standart', PRIORITY: 'Prioritetli', HIGHEST: 'Ən yüksək' },
  ru: { STANDARD: 'Стандартный', PRIORITY: 'Приоритетный', HIGHEST: 'Наивысший' },
  en: { STANDARD: 'Standard', PRIORITY: 'Priority', HIGHEST: 'Highest' }
};

const HUMAN_REVIEW_TEXT: Record<Locale, Record<string, string>> = {
  az: { STANDARD_REVIEW: 'Standart yoxlama', PRIORITY_REVIEW: 'Prioritetli yoxlama', NAMED_MANAGER_REVIEW: 'Adlı menecer yoxlaması' },
  ru: { STANDARD_REVIEW: 'Стандартная проверка', PRIORITY_REVIEW: 'Приоритетная проверка', NAMED_MANAGER_REVIEW: 'Проверка персональным менеджером' },
  en: { STANDARD_REVIEW: 'Standard review', PRIORITY_REVIEW: 'Priority review', NAMED_MANAGER_REVIEW: 'Named-manager review' }
};

const CONCIERGE_TEXT: Record<Locale, Record<string, string>> = {
  az: {
    NONE: 'Yoxdur', STANDARD: 'Standart', ENHANCED: 'Genişləndirilmiş',
    MANAGED_CONCIERGE: 'İdarə olunan konsyerj', NAMED_TRAVEL_MANAGER: 'Adlı səyahət meneceri'
  },
  ru: {
    NONE: 'Отсутствует', STANDARD: 'Стандартный', ENHANCED: 'Расширенный',
    MANAGED_CONCIERGE: 'Управляемый консьерж', NAMED_TRAVEL_MANAGER: 'Персональный тревел-менеджер'
  },
  en: {
    NONE: 'None', STANDARD: 'Standard', ENHANCED: 'Enhanced',
    MANAGED_CONCIERGE: 'Managed concierge', NAMED_TRAVEL_MANAGER: 'Named travel manager'
  }
};
