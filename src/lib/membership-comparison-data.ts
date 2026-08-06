import {
  getResolvedPricing,
  type MembershipPlanDefinition
} from '@/lib/membership-catalogue';
import type { PlanCode } from '@/server/agents/subscriptions/plan-authority';
import type { Locale } from '@/i18n/config';

/**
 * Phase C3 / C7.2 — shared membership comparison data authority.
 *
 * Row DEFINITIONS (label + a `values` function per row) live here so both
 * the React component (membership-comparison.tsx) and the standalone HTML
 * export bridge evaluate the exact same logic against the exact same
 * catalogue — no separate hand-written comparison content for the
 * standalone demo.
 */

export const HEADER_TEXT: Record<Locale, { personalTitle: string; corporateTitle: string; feature: string }> = {
  az: { personalTitle: 'Şəxsi planların müqayisəsi', corporateTitle: 'Korporativ planların müqayisəsi', feature: 'Xüsusiyyət' },
  ru: { personalTitle: 'Сравнение личных планов', corporateTitle: 'Сравнение корпоративных планов', feature: 'Функция' },
  en: { personalTitle: 'Personal plan comparison', corporateTitle: 'Corporate plan comparison', feature: 'Feature' }
};

export const FAIR_USE_WORDING: Record<Locale, string> = {
  az: 'Ədalətli istifadəyə uyğun olaraq konfiqurasiya olunub',
  ru: 'Настроено согласно принципу добросовестного использования',
  en: 'Configured according to fair use'
};

export const CUSTOM_ENTERPRISE_WORDING: Record<Locale, string> = {
  az: 'Enterprise üçün fərdi',
  ru: 'Индивидуально для Enterprise',
  en: 'Custom for Enterprise'
};

export const NOT_INCLUDED: Record<Locale, string> = { az: '—', ru: '—', en: '—' };

export type CellValue = string | boolean;

export interface ComparisonRow {
  key: string;
  label: Record<Locale, string>;
  values: (plan: MembershipPlanDefinition, locale: Locale) => CellValue;
}

export function cellDisplay(value: CellValue, locale: Locale): string {
  if (typeof value === 'boolean') return value ? '✓' : NOT_INCLUDED[locale];
  return value;
}

// ---------------------------------------------------------------------------
// PERSONAL rows
// ---------------------------------------------------------------------------

export const PERSONAL_ROWS: ComparisonRow[] = [
  {
    key: 'bestFor',
    label: { az: 'Kimin üçün uyğundur', ru: 'Кому подходит', en: 'Best for' },
    values: (plan, locale) => plan.bestFor[locale]
  },
  {
    key: 'memberRateAccess',
    label: { az: 'Üzv tarifi çıxışı', ru: 'Доступ к тарифам участника', en: 'Member-rate access' },
    values: (plan, locale) => plan.memberRateAccess[locale]
  },
  {
    key: 'hotelFlightSourcing',
    label: { az: 'Otel və uçuş mənbə tapılması', ru: 'Поиск отелей и рейсов', en: 'Hotel and flight sourcing' },
    values: (plan, locale) => plan.hotelFlightAncillaryCoordination[locale].join(' · ')
  },
  {
    key: 'searchDepth',
    label: { az: 'Axtarış dərinliyi', ru: 'Глубина поиска', en: 'Search depth' },
    values: (plan, locale) => plan.searchDepth[locale]
  },
  {
    key: 'humanReview',
    label: { az: 'İnsan yoxlaması', ru: 'Проверка человеком', en: 'Human review' },
    values: (plan, locale) => ({
      STANDARD_REVIEW: { az: 'Standart', ru: 'Стандартная', en: 'Standard' },
      PRIORITY_REVIEW: { az: 'Prioritetli', ru: 'Приоритетная', en: 'Priority' },
      NAMED_MANAGER_REVIEW: { az: 'Adlı menecer', ru: 'Персональный менеджер', en: 'Named manager' }
    }[plan.humanReviewLevel][locale])
  },
  {
    key: 'multiDestination',
    label: { az: 'Ailə və çoxməqsədli planlaşdırma', ru: 'Семейное и многонаправленное планирование', en: 'Family and multi-destination planning' },
    values: (plan) => plan.capabilityFlags.familyMultiDestinationPlanning
  },
  {
    key: 'ancillaryCoordination',
    label: { az: 'Viza, sığorta, transfer, eSIM, fəaliyyət', ru: 'Виза, страхование, трансфер, eSIM, активности', en: 'Visa, insurance, transfer, eSIM, activities' },
    values: (plan) => plan.capabilityFlags.ancillaryCoordination
  },
  {
    key: 'complexItinerary',
    label: { az: 'Premium və mürəkkəb marşrut idarəolunması', ru: 'Управление премиальными и сложными маршрутами', en: 'Premium and complex itinerary handling' },
    values: (plan) => plan.supportedJourneyComplexity === 'COMPLEX' || plan.supportedJourneyComplexity === 'BESPOKE_VIP'
  },
  {
    key: 'conciergeLevel',
    label: { az: 'Konsyerj səviyyəsi', ru: 'Уровень консьержа', en: 'Concierge level' },
    values: (plan, locale) => ({
      NONE: { az: 'Yoxdur', ru: 'Отсутствует', en: 'None' },
      STANDARD: { az: 'Standart', ru: 'Стандартный', en: 'Standard' },
      ENHANCED: { az: 'Genişləndirilmiş', ru: 'Расширенный', en: 'Enhanced' },
      MANAGED_CONCIERGE: { az: 'İdarə olunan', ru: 'Управляемый', en: 'Managed' },
      NAMED_TRAVEL_MANAGER: { az: 'Adlı meneceri', ru: 'Персональный менеджер', en: 'Named manager' }
    }[plan.conciergeLevel][locale])
  },
  {
    key: 'servicePriority',
    label: { az: 'Xidmət prioriteti', ru: 'Приоритет обслуживания', en: 'Service priority' },
    values: (plan, locale) => ({
      STANDARD: { az: 'Standart', ru: 'Стандартный', en: 'Standard' },
      PRIORITY: { az: 'Prioritetli', ru: 'Приоритетный', en: 'Priority' },
      HIGHEST: { az: 'Ən yüksək', ru: 'Наивысший', en: 'Highest' }
    }[plan.servicePriority][locale])
  },
  {
    key: 'aiReception',
    label: { az: '24/7 AI qəbulu', ru: 'Приём ИИ 24/7', en: '24/7 AI reception' },
    values: (plan) => plan.aiAgentInvolvement.some((a) => a.agentKey === 'VOICE_RECEPTION_AGENT')
  },
  {
    key: 'namedManager',
    label: { az: 'Adlı səyahət meneceri', ru: 'Персональный тревел-менеджер', en: 'Named travel manager' },
    values: (plan) => plan.conciergeLevel === 'NAMED_TRAVEL_MANAGER'
  },
  {
    key: 'annualSaving',
    label: { az: 'İllik qənaət', ru: 'Годовая экономия', en: 'Annual saving' },
    values: (plan, locale) => {
      const resolved = getResolvedPricing(plan.planCode as PlanCode);
      return resolved.annualSavingDisplay !== null ? `${resolved.annualSavingDisplay} ₼` : NOT_INCLUDED[locale];
    }
  },
  {
    key: 'humanApproval',
    label: { az: 'Rezervasiya və ödənişdən əvvəl insan təsdiqi', ru: 'Подтверждение человеком перед бронированием и оплатой', en: 'Human approval before booking and payment' },
    values: () => true
  }
];

// ---------------------------------------------------------------------------
// CORPORATE rows
// ---------------------------------------------------------------------------

export const CORPORATE_ROWS: ComparisonRow[] = [
  {
    key: 'requestIntake',
    label: { az: 'Səyahət tələbi qəbulu', ru: 'Приём заявок на поездки', en: 'Travel-request intake' },
    values: () => true
  },
  {
    key: 'hotelFareSourcing',
    label: { az: 'Otel və tarif mənbə tapılması', ru: 'Поиск отелей и тарифов', en: 'Hotel and fare sourcing' },
    values: (plan, locale) => plan.hotelFlightAncillaryCoordination[locale].join(' · ')
  },
  {
    key: 'approvals',
    label: { az: 'Təsdiq iş axını', ru: 'Процесс утверждения', en: 'Approval workflow' },
    values: (plan) => plan.capabilityFlags.approvalWorkflow
  },
  {
    key: 'travellerProfiles',
    label: { az: 'Səyahətçi profilləri', ru: 'Профили путешественников', en: 'Traveller profiles' },
    values: (plan) => plan.capabilityFlags.travellerProfiles
  },
  {
    key: 'policyGovernance',
    label: { az: 'Siyasət idarəolunması', ru: 'Управление политикой', en: 'Policy governance' },
    values: (plan) => plan.capabilityFlags.policyGovernance
  },
  {
    key: 'reporting',
    label: { az: 'Hesabatlıq', ru: 'Отчётность', en: 'Reporting' },
    values: (plan) => plan.capabilityFlags.reporting
  },
  {
    key: 'dashboard',
    label: { az: 'Şirkət paneli', ru: 'Корпоративная панель', en: 'Company dashboard' },
    values: (plan) => plan.capabilityFlags.companyDashboard
  },
  {
    key: 'executiveTravel',
    label: { az: 'İcraçı səyahət idarəolunması', ru: 'Организация поездок руководителей', en: 'Executive travel handling' },
    values: (plan) => plan.capabilityFlags.executiveTravelHandling
  },
  {
    key: 'complexMultiCity',
    label: { az: 'Mürəkkəb və çoxşəhərli səyahət', ru: 'Сложные и многогородские поездки', en: 'Complex and multi-city travel' },
    values: (plan) => plan.supportedJourneyComplexity === 'COMPLEX' || plan.supportedJourneyComplexity === 'BESPOKE_VIP'
  },
  {
    key: 'dedicatedCoordination',
    label: { az: 'Xüsusi əlaqələndirmə', ru: 'Выделенная координация', en: 'Dedicated coordination' },
    values: (plan) => plan.conciergeLevel === 'ENHANCED' || plan.conciergeLevel === 'NAMED_TRAVEL_MANAGER'
  },
  {
    key: 'supplierRateConfig',
    label: { az: 'Təchizatçı/şirkət tarifi konfiqurasiyası', ru: 'Настройка тарифов поставщика/компании', en: 'Supplier/company-rate configuration' },
    values: (plan) => plan.capabilityFlags.supplierRateConfiguration
  },
  {
    key: 'customRoles',
    label: { az: 'Fərdi rollar', ru: 'Индивидуальные роли', en: 'Custom roles' },
    values: (plan) => plan.planCode === 'CORPORATE_ENTERPRISE'
  },
  {
    key: 'integrations',
    label: { az: 'İnteqrasiyalar', ru: 'Интеграции', en: 'Integrations' },
    values: (plan) => plan.planCode === 'CORPORATE_ENTERPRISE'
  },
  {
    key: 'serviceGovernance',
    label: { az: 'Xidmət səviyyəsi idarəetməsi', ru: 'Управление уровнем обслуживания', en: 'Service-level governance' },
    values: (plan, locale) => plan.planCode === 'CORPORATE_ENTERPRISE' ? CUSTOM_ENTERPRISE_WORDING[locale] : FAIR_USE_WORDING[locale]
  }
];

