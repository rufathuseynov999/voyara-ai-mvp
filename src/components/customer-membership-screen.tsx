import type { Locale } from '@/i18n/config';
import type { PlanComparisonEntry, CurrentMembership, PaymentHistoryEntry } from '@/server/agents/subscriptions/customer-subscription-queries';

/**
 * Phase 4F — customer-facing membership screen. All prices displayed come
 * directly from the founder's locked catalog (via loadPlanComparison,
 * which reads LOCKED_PLAN_PRICES) — this component never hardcodes a price
 * of its own. Upgrade/downgrade/cancellation are presented as REQUESTS the
 * customer can initiate; the actual state change still goes through the
 * lifecycle service's own AAL2/actor-checked functions, never this
 * component directly.
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
    cancelPending: 'Ləğvetmə tələbiniz qeydə alınıb — dövrün sonunda qüvvəyə minəcək.'
  },
  ru: {
    title: 'Членство', planComparison: 'Сравнение планов', monthly: 'Ежемесячно', annual: 'Ежегодно',
    currentMembership: 'Ваше текущее членство', noMembership: 'У вас нет активного членства.', status: 'Статус',
    renewalDate: 'Дата продления', billingCycle: 'Цикл оплаты', paymentHistory: 'История платежей',
    noPayments: 'История платежей отсутствует.', entitlementUsage: 'Использование лимитов', noUsage: 'Данные об использовании отсутствуют.',
    requestUpgrade: 'Обратитесь в службу поддержки для повышения плана.', requestDowngrade: 'Обратитесь в службу поддержки для понижения плана.',
    requestCancellation: 'Обратитесь в службу поддержки для отмены — вступит в силу в конце периода.',
    failedPaymentRecovery: 'Платёж не прошёл. Обновите способ оплаты или свяжитесь со службой поддержки.',
    cancelPending: 'Ваш запрос на отмену зарегистрирован — вступит в силу в конце периода.'
  },
  en: {
    title: 'Membership', planComparison: 'Plan comparison', monthly: 'Monthly', annual: 'Annual',
    currentMembership: 'Your current membership', noMembership: 'You have no active membership.', status: 'Status',
    renewalDate: 'Renewal date', billingCycle: 'Billing cycle', paymentHistory: 'Payment history',
    noPayments: 'No payment history yet.', entitlementUsage: 'Entitlement usage', noUsage: 'No usage data yet.',
    requestUpgrade: 'Contact support to request a plan upgrade.', requestDowngrade: 'Contact support to request a plan downgrade.',
    requestCancellation: 'Contact support to request cancellation — takes effect at the end of your current period.',
    failedPaymentRecovery: 'Your last payment failed. Please update your payment method or contact support.',
    cancelPending: 'Your cancellation request is on file — it will take effect at the end of your current period.'
  }
};

const PLAN_DISPLAY_NAMES: Record<Locale, Record<string, string>> = {
  az: { PERSONAL_SMART: 'Smart', PERSONAL_PLUS: 'Plus', PERSONAL_PREMIUM: 'Premium', PERSONAL_BLACK: 'Black', CORPORATE_STARTER: 'Starter', CORPORATE_STANDARD: 'Standard', CORPORATE_PROFESSIONAL: 'Professional' },
  ru: { PERSONAL_SMART: 'Smart', PERSONAL_PLUS: 'Plus', PERSONAL_PREMIUM: 'Premium', PERSONAL_BLACK: 'Black', CORPORATE_STARTER: 'Starter', CORPORATE_STANDARD: 'Standard', CORPORATE_PROFESSIONAL: 'Professional' },
  en: { PERSONAL_SMART: 'Smart', PERSONAL_PLUS: 'Plus', PERSONAL_PREMIUM: 'Premium', PERSONAL_BLACK: 'Black', CORPORATE_STARTER: 'Starter', CORPORATE_STANDARD: 'Standard', CORPORATE_PROFESSIONAL: 'Professional' }
};

function formatPrice(minorUnits: number | null): string {
  if (minorUnits === null) return '—';
  return `${(minorUnits / 100).toFixed(0)} ₼`;
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
  const planNames = PLAN_DISPLAY_NAMES[locale];

  return (
    <main className="screen-page membership-page" id="main-content" tabIndex={-1}>
      <h1>{t.title}</h1>

      <section className="state-card">
        <h2>{t.currentMembership}</h2>
        {!membership ? (
          <p>{t.noMembership}</p>
        ) : (
          <>
            <p><strong>{planNames[membership.planCode] ?? membership.planCode}</strong> — {t.status}: {membership.status}</p>
            <p>{t.billingCycle}: {membership.billingCycle === 'ANNUAL' ? t.annual : t.monthly}</p>
            {membership.nextPaymentDate && <p>{t.renewalDate}: {membership.nextPaymentDate}</p>}
            {membership.status === 'PAYMENT_FAILED' && <p className="orch-note">{t.failedPaymentRecovery}</p>}
            {membership.cancelAtPeriodEnd && <p className="orch-note">{t.cancelPending}</p>}
            <p className="orch-note">{t.requestUpgrade}</p>
            <p className="orch-note">{t.requestDowngrade}</p>
            {!membership.cancelAtPeriodEnd && <p className="orch-note">{t.requestCancellation}</p>}
          </>
        )}
      </section>

      <section className="state-card">
        <h2>{t.planComparison}</h2>
        <table>
          <thead><tr><th /><th>{t.monthly}</th><th>{t.annual}</th></tr></thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.planCode}>
                <td>{planNames[plan.planCode] ?? plan.planCode}</td>
                <td>{formatPrice(plan.monthlyPriceMinorUnits)}</td>
                <td>{formatPrice(plan.annualPriceMinorUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {membership && (
        <section className="state-card">
          <h2>{t.entitlementUsage}</h2>
          {usage.length === 0 ? <p>{t.noUsage}</p> : (
            <ul>{usage.map((u) => <li key={`${u.usageKey}-${u.periodStart}`}>{u.usageKey}: {u.usedAmount} ({u.periodStart} – {u.periodEnd})</li>)}</ul>
          )}
        </section>
      )}

      {membership && (
        <section className="state-card">
          <h2>{t.paymentHistory}</h2>
          {paymentHistory.length === 0 ? <p>{t.noPayments}</p> : (
            <ul>{paymentHistory.map((p) => <li key={p.eventId}>{p.receivedAt.slice(0, 10)} — {p.transactionType} — {p.amountMinorUnits !== null ? formatPrice(p.amountMinorUnits) : '—'} — {p.accepted ? '✓' : '✗'}</li>)}</ul>
          )}
        </section>
      )}
    </main>
  );
}
