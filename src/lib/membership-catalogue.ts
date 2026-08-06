import { LOCKED_PLAN_PRICES, type PlanCode } from '@/server/agents/subscriptions/plan-authority';
import type { Locale } from '@/i18n/config';

/**
 * VOYARA AI — Authoritative Membership Catalogue (Phase A)
 *
 * This is the SINGLE commercial-presentation source of truth for all eight
 * VOYARA membership plans (four personal, four corporate). It is consumed by:
 *   - the landing-page membership cards;
 *   - the authenticated membership screen;
 *   - the personal and corporate comparison tables;
 *   - the standalone HTML generator;
 *   - entitlement / upgrade-trigger presentation.
 *
 * Pricing is NEVER duplicated here. Every price and every annual-saving
 * figure below is derived programmatically from `LOCKED_PLAN_PRICES` in
 * `plan-authority.ts`, which remains the sole pricing authority. Changing a
 * price still requires editing `plan-authority.ts` — this file cannot
 * override or bypass that.
 *
 * Fair-use and any other numerical service limits are represented as
 * `founderConfigurable: true` placeholders rather than invented numbers, per
 * standing instruction: do not invent unapproved numerical usage limits.
 *
 * Commercial language throughout follows the approved honest-wording list
 * (member-access rates / preferred offers where available / broader
 * supplier comparison / human-reviewed recommendations / conditions apply)
 * and never claims guaranteed lowest price, guaranteed savings, guaranteed
 * upgrades, or unlimited concierge labour.
 */

export type MembershipCategory = 'PERSONAL' | 'CORPORATE';

export type ServicePriorityLevel = 'STANDARD' | 'PRIORITY' | 'HIGHEST';
export type HumanReviewLevel = 'STANDARD_REVIEW' | 'PRIORITY_REVIEW' | 'NAMED_MANAGER_REVIEW';
export type ConciergeLevel = 'NONE' | 'STANDARD' | 'ENHANCED' | 'MANAGED_CONCIERGE' | 'NAMED_TRAVEL_MANAGER';
export type JourneyComplexity = 'SIMPLE' | 'MULTI_DESTINATION' | 'COMPLEX' | 'BESPOKE_VIP';

export interface LocalizedText {
  az: string;
  ru: string;
  en: string;
}

export interface LocalizedList {
  az: string[];
  ru: string[];
  en: string[];
}

/** A numerical or categorical limit the founder can configure at any time.
 *  No specific number is asserted here unless it is already locked
 *  elsewhere (e.g. pricing). This keeps the catalogue honest: it describes
 *  the *shape* of fair use, not invented figures. */
export interface FounderConfigurableLimit {
  founderConfigurable: true;
  description: LocalizedText;
}

export interface AiAgentInvolvement {
  agentKey:
    | 'SALES_AGENT'
    | 'CONCIERGE_AGENT'
    | 'OPERATIONS_AGENT'
    | 'VOICE_RECEPTION_AGENT'
    | 'CORPORATE_DESK_AGENT';
  role: LocalizedText;
}

/** Locale-independent capability flags for comparison-table rendering.
 *  These are the SINGLE structured source of truth for boolean comparison
 *  cells — never inferred by scanning translated benefit text with regex,
 *  which is locale-fragile (e.g. Azerbaijani capital İ does not
 *  case-fold to ASCII 'i' under JS's default Unicode case folding, so a
 *  naive /i-flag regex silently fails on sentence-initial "İcraçı..."). */
export interface CapabilityFlags {
  /** Personal: family and multi-destination itinerary planning. */
  familyMultiDestinationPlanning: boolean;
  /** Personal: visa, insurance, transfer, eSIM and activity coordination. */
  ancillaryCoordination: boolean;
  /** Corporate: any approval workflow (basic or multi-level) exists. */
  approvalWorkflow: boolean;
  /** Corporate: named traveller profiles. */
  travellerProfiles: boolean;
  /** Corporate: policy-aware travel governance. */
  policyGovernance: boolean;
  /** Corporate: reporting (basic or advanced). */
  reporting: boolean;
  /** Corporate: company travel dashboard. */
  companyDashboard: boolean;
  /** Corporate: executive travel handling. */
  executiveTravelHandling: boolean;
  /** Corporate: preferred-supplier / company-rate configuration. */
  supplierRateConfiguration: boolean;
}

export interface MembershipPlanDefinition {
  /** Matches PlanCode in plan-authority.ts exactly — the single join key
   *  between commercial presentation and the locked pricing/entitlement
   *  authority. */
  planCode: PlanCode;
  category: MembershipCategory;
  /** Internal engineering/display slug, e.g. 'smart', 'starter'. Never
   *  displayed raw to the customer — always resolved through `name`. */
  slug: string;
  displayOrder: number;
  name: LocalizedText;
  positioning: LocalizedText;
  bestFor: LocalizedText;
  /** Plan code this plan inherits from ("Everything in X, plus…").
   *  null for entry-level plans (Smart, Starter). */
  inheritsFrom: PlanCode | null;
  /** Benefits unique to this tier, i.e. the "plus" list shown after
   *  "Everything in {inheritsFrom}". For Smart/Starter this is the full
   *  benefit list since there is nothing to inherit from. */
  additionalBenefits: LocalizedList;
  memberRateAccess: LocalizedText;
  hotelFlightAncillaryCoordination: LocalizedList;
  searchDepth: LocalizedText;
  servicePriority: ServicePriorityLevel;
  humanReviewLevel: HumanReviewLevel;
  conciergeLevel: ConciergeLevel;
  supportedJourneyComplexity: JourneyComplexity;
  aiAgentInvolvement: AiAgentInvolvement[];
  humanApprovalBoundary: LocalizedText;
  fairUseDisclosure: LocalizedText;
  availabilityDisclosure: LocalizedText;
  ctaLabel: LocalizedText;
  upgradeTrigger: LocalizedText;
  /** Fair-use/service limits represented honestly as founder-configurable,
   *  never as invented hard numbers. */
  fairUseLimits: FounderConfigurableLimit[];
  /** Only corporate Enterprise has no public monthly price. */
  isCustomPriced: boolean;
  /** Locale-independent structured capability flags — see CapabilityFlags. */
  capabilityFlags: CapabilityFlags;
}

// ---------------------------------------------------------------------------
// Shared, reusable localized fragments
// ---------------------------------------------------------------------------

const HONEST_AVAILABILITY_DISCLOSURE: LocalizedText = {
  az: 'Yekun qiymət və şərtlər təsdiqdən əvvəl göstərilir. Təklif, marşrut və qiymət təchizatçıdan, təyinat məntəqəsindən və mövcud inventardan asılıdır.',
  ru: 'Итоговая цена и условия показываются до подтверждения. Предложение, маршрут и цена зависят от поставщика, направления и наличия инвентаря.',
  en: 'Final price and conditions are shown before approval. Offers depend on supplier, destination and inventory availability.'
};

const HONEST_MEMBER_RATE_LANGUAGE_PERSONAL: LocalizedText = {
  az: 'Üzvlərə açıq VOYARA tarifləri və mövcud olduqda üstünlük verilən təkliflərə çıxış.',
  ru: 'Доступ к тарифам VOYARA для участников и к предпочтительным предложениям, где они доступны.',
  en: 'Access to VOYARA member-access rates and preferred offers where available.'
};

function agentSales(role: LocalizedText): AiAgentInvolvement {
  return { agentKey: 'SALES_AGENT', role };
}
function agentConcierge(role: LocalizedText): AiAgentInvolvement {
  return { agentKey: 'CONCIERGE_AGENT', role };
}
function agentOps(role: LocalizedText): AiAgentInvolvement {
  return { agentKey: 'OPERATIONS_AGENT', role };
}
function agentVoice(role: LocalizedText): AiAgentInvolvement {
  return { agentKey: 'VOICE_RECEPTION_AGENT', role };
}
function agentCorporateDesk(role: LocalizedText): AiAgentInvolvement {
  return { agentKey: 'CORPORATE_DESK_AGENT', role };
}

const HAG_APPROVAL_TEXT: LocalizedText = {
  az: 'Bütün ödənişlər, rezervasiyalar və riskli dəyişikliklər insan tərəfindən təsdiqlənənə qədər icra olunmur — AI hazırlayır, insan təsdiqləyir, Voyara icra edir.',
  ru: 'Ни один платёж, бронирование или рискованное изменение не выполняется без подтверждения человеком — ИИ готовит, человек подтверждает, Voyara исполняет.',
  en: 'No payment, booking or risk-sensitive change is executed until a human approves it — AI prepares, the human approves, Voyara executes.'
};

// ---------------------------------------------------------------------------
// PERSONAL PLANS
// ---------------------------------------------------------------------------

const smart: MembershipPlanDefinition = {
  planCode: 'PERSONAL_SMART',
  category: 'PERSONAL',
  slug: 'smart',
  displayOrder: 1,
  name: { az: 'Smart', ru: 'Smart', en: 'Smart' },
  positioning: {
    az: 'Daha yaxşı planlaşdırma, üzv təklifləri və mütəxəssis yoxlaması istəyən səyahətçilər üçün ağıllı başlanğıc.',
    ru: 'Умная отправная точка для путешественников, которые хотят лучшего планирования, предложений для участников и экспертной проверки.',
    en: 'The intelligent starting point for travellers who want better planning, available member offers and expert verification.'
  },
  bestFor: {
    az: 'İlk dəfə üzv olan, ara-sıra səyahət edən müştərilər üçün',
    ru: 'Для новых участников, которые путешествуют время от времени',
    en: 'First-time members and occasional travellers'
  },
  inheritsFrom: null,
  additionalBenefits: {
    az: [
      'Mövcud VOYARA üzv otel tariflərinə və səyahət təkliflərinə çıxış',
      'AI dəstəkli təyinat, otel və uçuş araşdırması',
      'Mövcud otel, uçuş və transfer variantlarının müqayisəsi',
      'Öhdəlik götürməzdən əvvəl insan tərəfindən yoxlanılmış səyahət təklifi',
      'Otel rezervasiyası və aviabilet əlaqələndirilməsi',
      'Şəxsi Trip Room',
      'Səyahət sənədləri və yola çıxış üçün yoxlama siyahısı',
      'Standart dəstək',
      'Ödəniş və ya riskli rezervasiya əməliyyatlarından əvvəl insan təsdiqi'
    ],
    ru: [
      'Доступ к доступным тарифам на отели и предложениям для участников VOYARA',
      'Исследование направлений, отелей и рейсов с помощью ИИ',
      'Сравнение доступных вариантов отелей, рейсов и трансферов',
      'Предложение поездки, проверенное человеком, перед подтверждением',
      'Координация бронирования отеля и авиабилета',
      'Личный Trip Room',
      'Чек-лист документов и подготовки к поездке',
      'Стандартная поддержка',
      'Подтверждение человеком перед оплатой или рискованным бронированием'
    ],
    en: [
      'Access to available VOYARA member hotel rates and travel offers',
      'AI-assisted destination, hotel and flight research',
      'Comparison of available hotel, flight and transfer options',
      'Human-reviewed travel proposal before commitment',
      'Hotel-booking and flight-ticket coordination',
      'Personal Trip Room',
      'Travel-document and pre-departure checklist',
      'Standard support',
      'Human approval before payments or risk-sensitive booking actions'
    ]
  },
  memberRateAccess: HONEST_MEMBER_RATE_LANGUAGE_PERSONAL,
  hotelFlightAncillaryCoordination: {
    az: ['Otel rezervasiyası əlaqələndirilməsi', 'Aviabilet axtarışı və əlaqələndirilməsi'],
    ru: ['Координация бронирования отеля', 'Поиск и координация авиабилетов'],
    en: ['Hotel-booking coordination', 'Flight-ticket search and coordination']
  },
  searchDepth: {
    az: 'Əsas otel, uçuş və transfer variantlarının müqayisəsi',
    ru: 'Базовое сравнение вариантов отелей, рейсов и трансферов',
    en: 'Baseline comparison of hotel, flight and transfer options'
  },
  servicePriority: 'STANDARD',
  humanReviewLevel: 'STANDARD_REVIEW',
  conciergeLevel: 'NONE',
  supportedJourneyComplexity: 'SIMPLE',
  aiAgentInvolvement: [
    agentSales({
      az: 'Təyinat, otel və uçuş variantlarını araşdırır və hazırlayır',
      ru: 'Исследует и готовит варианты направлений, отелей и рейсов',
      en: 'Researches and prepares destination, hotel and flight options'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Standart dəstək ədalətli istifadə prinsipinə əsaslanır; tezlik hədləri founder tərəfindən konfiqurasiya olunur.',
    ru: 'Стандартная поддержка предоставляется на принципах добросовестного использования; лимиты частоты настраиваются учредителем.',
    en: 'Standard support operates on a fair-use basis; frequency limits are founder-configurable.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Smart-a qoşul', ru: 'Присоединиться к Smart', en: 'Join Smart' },
  upgradeTrigger: {
    az: 'Ailə və ya çoxməqsədli səyahət planlaşdırırsınızsa, daha geniş axtarış üçün Plus-a keçin.',
    ru: 'Если вы планируете семейную или многоцелевую поездку, перейдите на Plus для более широкого поиска.',
    en: 'Planning family or multi-destination travel? Upgrade to Plus for broader sourcing.'
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'Aylıq standart dəstək müraciətlərinin sayı founder tərəfindən müəyyən edilir',
        ru: 'Количество ежемесячных обращений в стандартную поддержку определяется учредителем',
        en: 'Monthly standard-support request volume is set by the founder'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: false,
    ancillaryCoordination: false,
    approvalWorkflow: false,
    travellerProfiles: false,
    policyGovernance: false,
    reporting: false,
    companyDashboard: false,
    executiveTravelHandling: false,
    supplierRateConfiguration: false
  },
  isCustomPriced: false
};

const plus: MembershipPlanDefinition = {
  planCode: 'PERSONAL_PLUS',
  category: 'PERSONAL',
  slug: 'plus',
  displayOrder: 2,
  name: { az: 'Plus', ru: 'Plus', en: 'Plus' },
  positioning: {
    az: 'Daha güclü mənbə tapma və daha sürətli dəstək istəyən tez-tez səyahət edən, ailə və çox təyinatlı müştərilər üçün.',
    ru: 'Для частых путешественников, семей и тех, кто планирует поездки с несколькими направлениями и хочет более глубокого поиска и быстрой поддержки.',
    en: 'For frequent, family and multi-destination travellers who want stronger sourcing and faster support.'
  },
  bestFor: {
    az: 'Tez-tez səyahət edən ailələr və çoxməqsədli marşrut planlaşdıranlar üçün',
    ru: 'Для часто путешествующих семей и тех, кто планирует маршруты с несколькими направлениями',
    en: 'Frequent-travelling families and multi-destination planners'
  },
  inheritsFrom: 'PERSONAL_SMART',
  additionalBenefits: {
    az: [
      'Mövcud tariflər və təklif kombinasiyaları üzrə genişləndirilmiş axtarış',
      'Otel otağı və tarif seçimlərinin daha dərin müqayisəsi',
      'Ailə və çoxməqsədli marşrut planlaşdırılması',
      'Yadda saxlanılan səyahətçi seçimləri',
      'Prioritetli insan yoxlaması',
      'Marşrut dəyişikliyi və yenidən planlaşdırma dəstəyi',
      'Viza, sığorta, transfer, eSIM və fəaliyyət əlaqələndirilməsi',
      'Ayrı səyahətlər arasında daha yaxşı davamlılıq',
      'Təklif və ya son tarix diqqət tələb etdikdə daha erkən eskalasiya'
    ],
    ru: [
      'Расширенный поиск по доступным тарифам и комбинациям предложений',
      'Более глубокое сравнение номеров и тарифов отелей',
      'Планирование семейных и многонаправленных маршрутов',
      'Сохранённые предпочтения путешественника',
      'Приоритетная проверка человеком',
      'Поддержка при изменении маршрута и перепланировании',
      'Координация виз, страхования, трансферов, eSIM и активностей',
      'Лучшая преемственность между отдельными поездками',
      'Более ранняя эскалация, когда предложение или срок требуют внимания'
    ],
    en: [
      'Expanded search across available rates and offer combinations',
      'Deeper hotel-room and fare comparison',
      'Family and multi-destination itinerary planning',
      'Saved traveller preferences',
      'Priority human review',
      'Itinerary-change and replanning support',
      'Visa, insurance, transfer, eSIM and activity coordination',
      'Better continuity between separate journeys',
      'Earlier escalation when an offer or deadline requires attention'
    ]
  },
  memberRateAccess: HONEST_MEMBER_RATE_LANGUAGE_PERSONAL,
  hotelFlightAncillaryCoordination: {
    az: ['Otel və uçuş əlaqələndirilməsi', 'Viza, sığorta, transfer, eSIM və fəaliyyət əlaqələndirilməsi'],
    ru: ['Координация отелей и рейсов', 'Координация виз, страхования, трансферов, eSIM и активностей'],
    en: ['Hotel and flight coordination', 'Visa, insurance, transfer, eSIM and activity coordination']
  },
  searchDepth: {
    az: 'Genişləndirilmiş axtarış və daha dərin tarif müqayisəsi',
    ru: 'Расширенный поиск и более глубокое сравнение тарифов',
    en: 'Expanded search and deeper fare comparison'
  },
  servicePriority: 'PRIORITY',
  humanReviewLevel: 'PRIORITY_REVIEW',
  conciergeLevel: 'STANDARD',
  supportedJourneyComplexity: 'MULTI_DESTINATION',
  aiAgentInvolvement: [
    agentSales({
      az: 'Genişləndirilmiş tarif kombinasiyalarını araşdırır',
      ru: 'Исследует расширенные комбинации тарифов',
      en: 'Researches expanded rate combinations'
    }),
    agentOps({
      az: 'Son tarixləri və dəyişiklikləri izləyir',
      ru: 'Отслеживает сроки и изменения',
      en: 'Tracks deadlines and changes'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Prioritetli yoxlama və genişləndirilmiş əlaqələndirmə ədalətli istifadə prinsipinə əsaslanır.',
    ru: 'Приоритетная проверка и расширенная координация предоставляются на принципах добросовестного использования.',
    en: 'Priority review and expanded coordination operate on a fair-use basis.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Plus seç', ru: 'Выбрать Plus', en: 'Choose Plus' },
  upgradeTrigger: {
    az: 'Mürəkkəb marşrutlar və xüsusi tələblər üçün Premium-a keçin.',
    ru: 'Для сложных маршрутов и особых запросов перейдите на Premium.',
    en: 'For complex itineraries and special requests, upgrade to Premium.'
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'Prioritetli yoxlama həcmi və eskalasiya tezliyi founder tərəfindən müəyyən edilir',
        ru: 'Объём приоритетной проверки и частота эскалации определяются учредителем',
        en: 'Priority-review volume and escalation frequency are founder-configurable'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: true,
    ancillaryCoordination: true,
    approvalWorkflow: false,
    travellerProfiles: false,
    policyGovernance: false,
    reporting: false,
    companyDashboard: false,
    executiveTravelHandling: false,
    supplierRateConfiguration: false
  },
  isCustomPriced: false
};

const premium: MembershipPlanDefinition = {
  planCode: 'PERSONAL_PREMIUM',
  category: 'PERSONAL',
  slug: 'premium',
  displayOrder: 3,
  name: { az: 'Premium', ru: 'Premium', en: 'Premium' },
  positioning: {
    az: 'Mürəkkəb və yüksək dəyərli səyahətlər üçün premium səyahət idarəetməsi və konsyerj üzvlüyü.',
    ru: 'Премиальное членство по управлению путешествиями и консьерж-сервису для сложных и более дорогих поездок.',
    en: 'A premium travel-management and concierge membership for complex and higher-value journeys.'
  },
  bestFor: {
    az: 'Mürəkkəb marşrutlar və yüksək gözləntili xidmət istəyən müştərilər üçün',
    ru: 'Для тех, кому нужны сложные маршруты и сервис высокого уровня',
    en: 'Complex itineraries and higher service expectations'
  },
  inheritsFrom: 'PERSONAL_PLUS',
  additionalBenefits: {
    az: [
      'Premium otel və daha yüksək kateqoriyalı otaq mənbə tapılması',
      'Mövcud olduqda əlavə dəyərli otel üstünlükləri və üstün təkliflər',
      'Mürəkkəb marşrut və xüsusi tələb idarəolunması',
      'Prioritetli səyahət dəstəyi',
      'Restoran, fəaliyyət və transfer əlaqələndirilməsi',
      'Proaktiv səyahətqabağı hazırlıq',
      'Səyahət monitorinqi və insan eskalasiyası',
      'Pozuntu və yenidən rezervasiya əlaqələndirilməsi',
      'Daha yüksək prioritetli təklif hazırlanması',
      'Konsyerj səviyyəli səyahət idarəetməsi'
    ],
    ru: [
      'Поиск премиальных отелей и номеров более высокой категории',
      'Дополнительные ценные преимущества отелей и предпочтительные предложения, где доступны',
      'Управление сложными маршрутами и особыми запросами',
      'Приоритетная поддержка в поездке',
      'Координация ресторанов, активностей и трансферов',
      'Проактивная подготовка к поездке',
      'Мониторинг поездки и эскалация человеку',
      'Координация при сбоях и повторном бронировании',
      'Подготовка предложений с более высоким приоритетом',
      'Управление поездкой на уровне консьержа'
    ],
    en: [
      'Premium-hotel and higher-category room sourcing',
      'Available value-added hotel benefits and preferred offers',
      'Complex itinerary and special-request handling',
      'Priority travel support',
      'Restaurant, activity and transfer coordination',
      'Proactive pre-trip preparation',
      'Journey monitoring and human escalation',
      'Disruption and rebooking coordination',
      'Higher-priority proposal preparation',
      'Concierge-level trip management'
    ]
  },
  memberRateAccess: {
    az: 'Premium otel kateqoriyalarına və mövcud olduqda əlavə dəyərli üstünlüklərə çıxış.',
    ru: 'Доступ к премиальным категориям отелей и дополнительным преимуществам, где они доступны.',
    en: 'Access to premium hotel categories and value-added benefits where available.'
  },
  hotelFlightAncillaryCoordination: {
    az: ['Premium otel əlaqələndirilməsi', 'Restoran, fəaliyyət və transfer əlaqələndirilməsi', 'Pozuntu/yenidən rezervasiya əlaqələndirilməsi'],
    ru: ['Координация премиальных отелей', 'Координация ресторанов, активностей и трансферов', 'Координация при сбоях/повторном бронировании'],
    en: ['Premium-hotel coordination', 'Restaurant, activity and transfer coordination', 'Disruption/rebooking coordination']
  },
  searchDepth: {
    az: 'Premium kateqoriyalar üzrə dərin axtarış və mürəkkəb marşrut idarəolunması',
    ru: 'Глубокий поиск по премиальным категориям и управление сложными маршрутами',
    en: 'Deep search across premium categories and complex-itinerary handling'
  },
  servicePriority: 'PRIORITY',
  humanReviewLevel: 'PRIORITY_REVIEW',
  conciergeLevel: 'MANAGED_CONCIERGE',
  supportedJourneyComplexity: 'COMPLEX',
  aiAgentInvolvement: [
    agentConcierge({
      az: 'Səyahət detallarını əlaqələndirir',
      ru: 'Координирует детали поездки',
      en: 'Coordinates journey details'
    }),
    agentOps({
      az: 'Səyahəti izləyir və pozuntuları erkən aşkarlayır',
      ru: 'Отслеживает поездку и раннее выявляет сбои',
      en: 'Monitors the journey and flags disruptions early'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Konsyerj səviyyəli koordinasiya ədalətli istifadə prinsipinə əsaslanır; həcm founder tərəfindən konfiqurasiya olunur.',
    ru: 'Координация консьерж-уровня предоставляется на принципах добросовестного использования; объём настраивается учредителем.',
    en: 'Concierge-level coordination operates on a fair-use basis; volume is founder-configurable.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Premium seç', ru: 'Выбрать Premium', en: 'Choose Premium' },
  upgradeTrigger: {
    az: 'VIP, təcili və ya adlı səyahət meneceri tələb edən səyahətlər üçün Black-ə müraciət edin.',
    ru: 'Для VIP, срочных поездок или персонального менеджера подайте заявку на Black.',
    en: 'For VIP, urgent travel or a named travel manager, request Black.'
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'Konsyerj koordinasiyasının aylıq həcmi founder tərəfindən müəyyən edilir',
        ru: 'Ежемесячный объём консьерж-координации определяется учредителем',
        en: 'Monthly concierge-coordination volume is founder-configurable'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: true,
    ancillaryCoordination: true,
    approvalWorkflow: false,
    travellerProfiles: false,
    policyGovernance: false,
    reporting: false,
    companyDashboard: false,
    executiveTravelHandling: false,
    supplierRateConfiguration: false
  },
  isCustomPriced: false
};

const black: MembershipPlanDefinition = {
  planCode: 'PERSONAL_BLACK',
  category: 'PERSONAL',
  slug: 'black',
  displayOrder: 4,
  name: { az: 'Black', ru: 'Black', en: 'Black' },
  positioning: {
    az: 'VIP, icraçı, ailə və son dəqiqə səyahətləri üçün VOYARA-nın ən yüksək şəxsi üzvlüyü.',
    ru: 'Наивысшее персональное членство VOYARA для VIP, руководителей, семей и поездок в последнюю минуту.',
    en: "VOYARA's highest personal membership for VIP, executive, family and last-minute travel."
  },
  bestFor: {
    az: 'VIP, icraçı və son dəqiqə səyahət tələb edənlər üçün — müraciət əsaslı',
    ru: 'Для VIP, руководителей и срочных поездок в последнюю минуту — на основе заявки',
    en: 'VIP, executive and last-minute travel — application-based'
  },
  inheritsFrom: 'PERSONAL_PREMIUM',
  additionalBenefits: {
    az: [
      'Ən yüksək müraciət prioriteti',
      'Adlı səyahət meneceri',
      'Fərdi (bespoke) səyahət mənbə tapılması',
      'VIP, icraçı, ailə və təcili səyahət idarəolunması',
      'Ailə və çoxsəyahətçi profil əlaqələndirilməsi',
      'Premium və tapılması çətin olan inventar araşdırılması',
      'Təcili insan eskalasiyası ilə 24/7 AI qəbulu',
      'Aeroport, transfer, yemək və təcrübə əlaqələndirilməsi',
      'Xüsusi hadisə və mürəkkəb tələb idarəolunması',
      'Bütün aktiv səyahətlər arasında davamlılıq'
    ],
    ru: [
      'Наивысший приоритет запроса',
      'Персональный тревел-менеджер',
      'Индивидуальный (bespoke) поиск поездки',
      'Организация VIP, руководящих, семейных и срочных поездок',
      'Координация профилей семьи и нескольких путешественников',
      'Поиск премиального и труднодоступного инвентаря',
      'Круглосуточный приём ИИ с экстренной эскалацией человеку',
      'Координация аэропорта, трансфера, питания и впечатлений',
      'Управление особыми событиями и сложными запросами',
      'Непрерывность по всем активным поездкам'
    ],
    en: [
      'Highest request priority',
      'Named travel manager',
      'Bespoke travel sourcing',
      'VIP, executive and urgent travel handling',
      'Family and multi-traveller profile coordination',
      'Premium and difficult-to-source inventory research',
      '24/7 AI reception with urgent human escalation',
      'Airport, transfer, dining and experience coordination',
      'Special-occasion and complex-request management',
      'Continuity across all active journeys'
    ]
  },
  memberRateAccess: {
    az: 'Bespoke mənbə tapılması vasitəsilə ən geniş mümkün inventar araşdırılması; qarantiyalı deyil, lakin prioritetli araşdırılır.',
    ru: 'Максимально широкий поиск инвентаря через индивидуальный подбор; не гарантирован, но исследуется в приоритетном порядке.',
    en: 'The widest reasonable inventory search via bespoke sourcing; not guaranteed, but researched with top priority.'
  },
  hotelFlightAncillaryCoordination: {
    az: ['Fərdi (bespoke) otel və uçuş mənbə tapılması', 'Aeroport və VIP transfer əlaqələndirilməsi', 'Yemək və təcrübə əlaqələndirilməsi'],
    ru: ['Индивидуальный поиск отелей и рейсов', 'Координация аэропорта и VIP-трансфера', 'Координация питания и впечатлений'],
    en: ['Bespoke hotel and flight sourcing', 'Airport and VIP transfer coordination', 'Dining and experience coordination']
  },
  searchDepth: {
    az: 'Bespoke, tapılması çətin olan inventar üzrə tam araşdırma',
    ru: 'Полное исследование индивидуального, труднодоступного инвентаря',
    en: 'Full bespoke research across difficult-to-source inventory'
  },
  servicePriority: 'HIGHEST',
  humanReviewLevel: 'NAMED_MANAGER_REVIEW',
  conciergeLevel: 'NAMED_TRAVEL_MANAGER',
  supportedJourneyComplexity: 'BESPOKE_VIP',
  aiAgentInvolvement: [
    agentVoice({
      az: '24/7 tələbləri qəbul edir və təcili halları insan menecerinə yönləndirir',
      ru: 'Принимает запросы 24/7 и направляет срочные случаи персональному менеджеру',
      en: 'Receives requests 24/7 and routes urgent cases to the human manager'
    }),
    agentConcierge({
      az: 'Fərdi səyahət detallarını hazırlayır, adlı menecer təsdiqləyir',
      ru: 'Готовит детали индивидуальной поездки, персональный менеджер подтверждает',
      en: 'Prepares bespoke journey details for the named manager to confirm'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Black üzvlüyü qeyri-məhdud xidmət deyil — tutum idarə olunur və müraciət əsasında qəbul edilə bilər.',
    ru: 'Членство Black не является неограниченным сервисом — вместимость контролируется и может основываться на заявке.',
    en: 'Black is not an unlimited service — capacity is managed and may be application-based.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Black üzvlüyünə müraciət et', ru: 'Подать заявку на Black', en: 'Request Black Membership' },
  upgradeTrigger: {
    az: 'Şirkət səyahəti idarəetməsi üçün Korporativ üzvlüklərə baxın.',
    ru: 'Для управления корпоративными поездками ознакомьтесь с корпоративными членствами.',
    en: 'For company travel governance, see Corporate memberships.'
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'Black tutumu və qəbul şərtləri founder tərəfindən müəyyən edilir',
        ru: 'Вместимость Black и условия приёма определяются учредителем',
        en: 'Black capacity and acceptance criteria are founder-configurable'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: true,
    ancillaryCoordination: true,
    approvalWorkflow: false,
    travellerProfiles: false,
    policyGovernance: false,
    reporting: false,
    companyDashboard: false,
    executiveTravelHandling: false,
    supplierRateConfiguration: false
  },
  isCustomPriced: false
};

// ---------------------------------------------------------------------------
// CORPORATE PLANS
// ---------------------------------------------------------------------------

const starter: MembershipPlanDefinition = {
  planCode: 'CORPORATE_STARTER',
  category: 'CORPORATE',
  slug: 'starter',
  displayOrder: 5,
  name: { az: 'Starter', ru: 'Starter', en: 'Starter' },
  positioning: {
    az: 'Komandaların işgüzar səyahət ehtiyaclarını təşkil etməyə başlamaq üçün',
    ru: 'Для команд, начинающих организовывать потребности в деловых поездках',
    en: 'For teams starting to organize their business travel needs'
  },
  bestFor: {
    az: 'Kiçik komandalar və mərkəzləşdirilmiş qeydlərə ehtiyacı olan startaplar üçün',
    ru: 'Для небольших команд и стартапов, которым нужны централизованные записи',
    en: 'Small teams and startups needing centralized records'
  },
  inheritsFrom: null,
  additionalBenefits: {
    az: [
      'İşçi səyahət tələbi qəbulu',
      'Mövcud biznes otel və tarif mənbə tapılması',
      'Əsas menecer təsdiq iş axını',
      'Mərkəzi səyahət qeydləri',
      'Standart əməliyyat əlaqələndirilməsi',
      'Əsas hesabatlıq'
    ],
    ru: [
      'Приём заявок сотрудников на командировки',
      'Поиск доступных корпоративных отелей и тарифов',
      'Базовый рабочий процесс утверждения менеджером',
      'Центральные записи о поездках',
      'Стандартная операционная координация',
      'Базовая отчётность'
    ],
    en: [
      'Employee travel-request intake',
      'Available business hotel and fare sourcing',
      'Basic manager approval workflow',
      'Central trip records',
      'Standard operational coordination',
      'Basic reporting'
    ]
  },
  memberRateAccess: {
    az: 'Mövcud olduqda korporativ tariflərə çıxış; şirkət razılaşmaları konfiqurasiya edildikdə tətbiq olunur.',
    ru: 'Доступ к корпоративным тарифам, где они доступны; корпоративные договорённости применяются при настройке.',
    en: 'Access to corporate rates where available; company agreements apply once configured.'
  },
  hotelFlightAncillaryCoordination: {
    az: ['Biznes otel əlaqələndirilməsi', 'Əsas aviabilet əlaqələndirilməsi'],
    ru: ['Координация бизнес-отелей', 'Базовая координация авиабилетов'],
    en: ['Business-hotel coordination', 'Basic flight coordination']
  },
  searchDepth: {
    az: 'Əsas korporativ tarif müqayisəsi',
    ru: 'Базовое сравнение корпоративных тарифов',
    en: 'Basic corporate fare comparison'
  },
  servicePriority: 'STANDARD',
  humanReviewLevel: 'STANDARD_REVIEW',
  conciergeLevel: 'NONE',
  supportedJourneyComplexity: 'SIMPLE',
  aiAgentInvolvement: [
    agentCorporateDesk({
      az: 'İşçi tələblərini qəbul edir və menecer təsdiqinə hazırlayır',
      ru: 'Принимает заявки сотрудников и готовит их к утверждению менеджером',
      en: 'Intakes employee requests and prepares them for manager approval'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Standart əməliyyat əlaqələndirilməsi ədalətli istifadə prinsipinə əsaslanır.',
    ru: 'Стандартная операционная координация предоставляется на принципах добросовестного использования.',
    en: 'Standard operational coordination operates on a fair-use basis.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Korporativ üzvlüyə başla', ru: 'Начать корпоративное членство', en: 'Start Corporate Membership' },
  upgradeTrigger: {
    az: 'Çoxsəviyyəli təsdiq və siyasət idarəolunması lazımdırsa, Standard-a keçin.',
    ru: 'Если нужны многоуровневое утверждение и управление политикой, перейдите на Standard.',
    en: 'Need multi-level approvals and policy handling? Upgrade to Standard.'
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'Aylıq tələb həcmi founder tərəfindən müəyyən edilir',
        ru: 'Ежемесячный объём заявок определяется учредителем',
        en: 'Monthly request volume is founder-configurable'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: false,
    ancillaryCoordination: false,
    approvalWorkflow: true,
    travellerProfiles: false,
    policyGovernance: false,
    reporting: true,
    companyDashboard: false,
    executiveTravelHandling: false,
    supplierRateConfiguration: false
  },
  isCustomPriced: false
};

const standard: MembershipPlanDefinition = {
  planCode: 'CORPORATE_STANDARD',
  category: 'CORPORATE',
  slug: 'standard',
  displayOrder: 6,
  name: { az: 'Standard', ru: 'Standard', en: 'Standard' },
  positioning: {
    az: 'Böyüyən komandalar üçün siyasətə uyğun səyahət idarəolunması',
    ru: 'Управление поездками с учётом политики для растущих команд',
    en: 'Policy-aware travel management for growing teams'
  },
  bestFor: {
    az: 'Çoxsəviyyəli təsdiqə ehtiyacı olan orta ölçülü komandalar üçün',
    ru: 'Для средних команд, которым нужно многоуровневое утверждение',
    en: 'Mid-sized teams needing multi-level approvals'
  },
  inheritsFrom: 'CORPORATE_STARTER',
  additionalBenefits: {
    az: [
      'Daha geniş tarif və marşrut müqayisəsi',
      'Çoxsəviyyəli təsdiqlər',
      'Siyasətə uyğun səyahət idarəolunması',
      'Səyahətçi profilləri',
      'Şirkət səyahət paneli',
      'Konsolidasiya olunmuş qeydlər',
      'Dəyişiklik və istisna əlaqələndirilməsi'
    ],
    ru: [
      'Более широкое сравнение тарифов и маршрутов',
      'Многоуровневые утверждения',
      'Управление поездками с учётом политики',
      'Профили путешественников',
      'Корпоративная панель управления поездками',
      'Консолидированные записи',
      'Координация изменений и исключений'
    ],
    en: [
      'Broader rate and itinerary comparison',
      'Multi-level approvals',
      'Policy-aware travel handling',
      'Traveller profiles',
      'Company travel dashboard',
      'Consolidated records',
      'Change and exception coordination'
    ]
  },
  memberRateAccess: {
    az: 'Mövcud olduqda genişləndirilmiş korporativ tariflər və üstün tariflər.',
    ru: 'Расширенные корпоративные тарифы и предпочтительные тарифы, где они доступны.',
    en: 'Broader corporate and preferred rates where available.'
  },
  hotelFlightAncillaryCoordination: {
    az: ['Genişləndirilmiş otel/uçuş əlaqələndirilməsi', 'Siyasətə uyğun dəyişiklik idarəolunması'],
    ru: ['Расширенная координация отелей/рейсов', 'Управление изменениями с учётом политики'],
    en: ['Expanded hotel/flight coordination', 'Policy-aware change handling']
  },
  searchDepth: {
    az: 'Genişləndirilmiş tarif və marşrut müqayisəsi',
    ru: 'Расширенное сравнение тарифов и маршрутов',
    en: 'Expanded rate and itinerary comparison'
  },
  servicePriority: 'PRIORITY',
  humanReviewLevel: 'PRIORITY_REVIEW',
  conciergeLevel: 'STANDARD',
  supportedJourneyComplexity: 'MULTI_DESTINATION',
  aiAgentInvolvement: [
    agentCorporateDesk({
      az: 'Çoxsəviyyəli təsdiq iş axınını idarə edir',
      ru: 'Управляет многоуровневым процессом утверждения',
      en: 'Manages the multi-level approval workflow'
    }),
    agentOps({
      az: 'Dəyişiklik və istisnaları izləyir',
      ru: 'Отслеживает изменения и исключения',
      en: 'Tracks changes and exceptions'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Çoxsəviyyəli təsdiq həcmi ədalətli istifadə prinsipinə əsaslanır.',
    ru: 'Объём многоуровневого утверждения предоставляется на принципах добросовестного использования.',
    en: 'Multi-level approval volume operates on a fair-use basis.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Korporativ üzvlüyə başla', ru: 'Начать корпоративное членство', en: 'Start Corporate Membership' },
  upgradeTrigger: {
    az: 'İcraçı səyahət və qabaqcıl hesabatlıq lazımdırsa, Professional-a keçin.',
    ru: 'Если нужны поездки руководителей и расширенная отчётность, перейдите на Professional.',
    en: 'Need executive travel and advanced reporting? Upgrade to Professional.'
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'Çoxsəviyyəli təsdiq addımlarının sayı founder tərəfindən konfiqurasiya olunur',
        ru: 'Количество шагов многоуровневого утверждения настраивается учредителем',
        en: 'Number of multi-level approval steps is founder-configurable'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: false,
    ancillaryCoordination: false,
    approvalWorkflow: true,
    travellerProfiles: true,
    policyGovernance: true,
    reporting: true,
    companyDashboard: true,
    executiveTravelHandling: false,
    supplierRateConfiguration: false
  },
  isCustomPriced: false
};

const professional: MembershipPlanDefinition = {
  planCode: 'CORPORATE_PROFESSIONAL',
  category: 'CORPORATE',
  slug: 'professional',
  displayOrder: 7,
  name: { az: 'Professional', ru: 'Professional', en: 'Professional' },
  positioning: {
    az: 'İcraçı səyahəti və mürəkkəb korporativ marşrutlar üçün xüsusi əlaqələndirmə',
    ru: 'Специализированная координация для поездок руководителей и сложных корпоративных маршрутов',
    en: 'Dedicated coordination for executive travel and complex corporate itineraries'
  },
  bestFor: {
    az: 'İcraçı səyahət və mürəkkəb, çoxşəhərli marşrutları olan şirkətlər üçün',
    ru: 'Для компаний с поездками руководителей и сложными многогородскими маршрутами',
    en: 'Companies with executive travel and complex multi-city itineraries'
  },
  inheritsFrom: 'CORPORATE_STANDARD',
  additionalBenefits: {
    az: [
      'İcraçı səyahət idarəolunması',
      'Prioritetli korporativ dəstək',
      'Qabaqcıl hesabatlıq',
      'Siyasət istisnası eskalasiyası',
      'Mürəkkəb və çoxşəhərli marşrut əlaqələndirilməsi',
      'Xüsusi korporativ səyahət əlaqələndirilməsi',
      'Konfiqurasiya edildikdə üstün təchizatçı və şirkət tarifi idarəolunması'
    ],
    ru: [
      'Управление поездками руководителей',
      'Приоритетная корпоративная поддержка',
      'Расширенная отчётность',
      'Эскалация исключений из политики',
      'Координация сложных многогородских маршрутов',
      'Выделенная корпоративная координация поездок',
      'Управление предпочтительными поставщиками и корпоративными тарифами при настройке'
    ],
    en: [
      'Executive travel handling',
      'Priority corporate support',
      'Advanced reporting',
      'Policy-exception escalation',
      'Complex and multi-city journey coordination',
      'Dedicated corporate travel coordination',
      'Preferred-supplier and company-rate handling where configured'
    ]
  },
  memberRateAccess: {
    az: 'Konfiqurasiya edildikdə üstün təchizatçı razılaşmaları və şirkət tarifi idarəolunması.',
    ru: 'Соглашения с предпочтительными поставщиками и корпоративные тарифы при настройке.',
    en: 'Preferred-supplier agreements and company-rate handling where configured.'
  },
  hotelFlightAncillaryCoordination: {
    az: ['İcraçı otel/uçuş əlaqələndirilməsi', 'Çoxşəhərli marşrut əlaqələndirilməsi', 'Xüsusi korporativ dəstək'],
    ru: ['Координация отелей/рейсов для руководителей', 'Координация многогородских маршрутов', 'Выделенная корпоративная поддержка'],
    en: ['Executive hotel/flight coordination', 'Multi-city itinerary coordination', 'Dedicated corporate support']
  },
  searchDepth: {
    az: 'İcraçı və mürəkkəb marşrutlar üzrə dərin axtarış',
    ru: 'Глубокий поиск для руководителей и сложных маршрутов',
    en: 'Deep search for executive and complex itineraries'
  },
  servicePriority: 'PRIORITY',
  humanReviewLevel: 'PRIORITY_REVIEW',
  conciergeLevel: 'ENHANCED',
  supportedJourneyComplexity: 'COMPLEX',
  aiAgentInvolvement: [
    agentCorporateDesk({
      az: 'İcraçı və mürəkkəb marşrut tələblərini idarə edir',
      ru: 'Обрабатывает запросы руководителей и сложные маршруты',
      en: 'Handles executive and complex-itinerary requests'
    }),
    agentOps({
      az: 'Siyasət istisnalarını eskalasiya edir',
      ru: 'Эскалирует исключения из политики',
      en: 'Escalates policy exceptions'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Xüsusi korporativ əlaqələndirmə ədalətli istifadə prinsipinə əsaslanır; həcm founder tərəfindən konfiqurasiya olunur.',
    ru: 'Выделенная корпоративная координация предоставляется на принципах добросовестного использования; объём настраивается учредителем.',
    en: 'Dedicated corporate coordination operates on a fair-use basis; volume is founder-configurable.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Korporativ üzvlüyə başla', ru: 'Начать корпоративное членство', en: 'Start Corporate Membership' },
  upgradeTrigger: {
    az: 'Fərdi razılaşmalar və xüsusi iş axınları lazımdırsa, Korporativ Masaya müraciət edin.',
    ru: 'Если нужны индивидуальные договорённости и особые рабочие процессы, обратитесь в Корпоративный отдел.',
    en: 'Need custom agreements and tailored workflows? Speak with the Corporate Desk.'
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'İcraçı dəstəyinin aylıq həcmi founder tərəfindən müəyyən edilir',
        ru: 'Ежемесячный объём поддержки руководителей определяется учредителем',
        en: 'Monthly executive-support volume is founder-configurable'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: false,
    ancillaryCoordination: false,
    approvalWorkflow: true,
    travellerProfiles: true,
    policyGovernance: true,
    reporting: true,
    companyDashboard: true,
    executiveTravelHandling: true,
    supplierRateConfiguration: true
  },
  isCustomPriced: false
};

const enterprise: MembershipPlanDefinition = {
  planCode: 'CORPORATE_ENTERPRISE',
  category: 'CORPORATE',
  slug: 'enterprise',
  displayOrder: 8,
  name: { az: 'Enterprise', ru: 'Enterprise', en: 'Enterprise' },
  positioning: {
    az: 'Fərdi hazırlanmış iş axınları və danışıqlı xidmət səviyyələri olan böyük təşkilatlar üçün',
    ru: 'Для крупных организаций с индивидуальными рабочими процессами и согласованными уровнями обслуживания',
    en: 'For large organizations with tailored workflows and negotiated service levels'
  },
  bestFor: {
    az: 'Fərdi idarəetmə və inteqrasiyalar tələb edən böyük müəssisələr üçün',
    ru: 'Для крупных предприятий, которым требуется индивидуальное управление и интеграции',
    en: 'Large enterprises requiring custom governance and integrations'
  },
  inheritsFrom: 'CORPORATE_PROFESSIONAL',
  additionalBenefits: {
    az: [
      'Fərdi təsdiq iş axınları',
      'Fərdi rollar və icazələr',
      'Danışıqlı xidmət səviyyələri',
      'Fərdiləşdirilmiş hesabatlıq',
      'Razılaşdırılmış inteqrasiyalar',
      'Şirkətə xas səyahət qaydaları',
      'Xüsusi hesab idarəetməsi',
      'Fərdi təchizatçı və korporativ tarif konfiqurasiyası'
    ],
    ru: [
      'Индивидуальные рабочие процессы утверждения',
      'Индивидуальные роли и права доступа',
      'Согласованные уровни обслуживания',
      'Индивидуальная отчётность',
      'Согласованные интеграции',
      'Специфичные для компании правила поездок',
      'Выделенное управление аккаунтом',
      'Индивидуальная настройка поставщиков и корпоративных тарифов'
    ],
    en: [
      'Custom approval workflows',
      'Custom roles and permissions',
      'Negotiated service levels',
      'Tailored reporting',
      'Agreed integrations',
      'Company-specific travel rules',
      'Dedicated account governance',
      'Custom supplier and corporate-rate configuration'
    ]
  },
  memberRateAccess: {
    az: 'Fərdi danışıqlar əsasında müəyyən edilən korporativ tariflər və inteqrasiyalar.',
    ru: 'Корпоративные тарифы и интеграции определяются индивидуальными переговорами.',
    en: 'Corporate rates and integrations are determined through individual negotiation.'
  },
  hotelFlightAncillaryCoordination: {
    az: ['Fərdi hazırlanmış otel/uçuş idarəetməsi', 'Razılaşdırılmış təchizatçı inteqrasiyaları'],
    ru: ['Индивидуально настроенное управление отелями/рейсами', 'Согласованные интеграции поставщиков'],
    en: ['Custom-configured hotel/flight governance', 'Agreed supplier integrations']
  },
  searchDepth: {
    az: 'Danışıqlı, şirkətə xas mənbə tapılması',
    ru: 'Согласованный, специфичный для компании поиск',
    en: 'Negotiated, company-specific sourcing'
  },
  servicePriority: 'HIGHEST',
  humanReviewLevel: 'NAMED_MANAGER_REVIEW',
  conciergeLevel: 'NAMED_TRAVEL_MANAGER',
  supportedJourneyComplexity: 'BESPOKE_VIP',
  aiAgentInvolvement: [
    agentCorporateDesk({
      az: 'Şirkətə xas qaydalar çərçivəsində fərdi iş axınlarını idarə edir',
      ru: 'Управляет индивидуальными рабочими процессами в рамках специфичных для компании правил',
      en: 'Manages custom workflows within company-specific rules'
    })
  ],
  humanApprovalBoundary: HAG_APPROVAL_TEXT,
  fairUseDisclosure: {
    az: 'Xidmət səviyyələri müqavilə əsasında danışıqlıdır; qeyri-məhdud əmək tələb etmir.',
    ru: 'Уровни обслуживания согласовываются по договору; не подразумевают неограниченный труд.',
    en: 'Service levels are contractually negotiated; they do not imply unlimited labour.'
  },
  availabilityDisclosure: HONEST_AVAILABILITY_DISCLOSURE,
  ctaLabel: { az: 'Korporativ Masa ilə əlaqə saxla', ru: 'Связаться с Корпоративным отделом', en: 'Speak with Corporate Desk' },
  upgradeTrigger: {
    az: 'Enterprise VOYARA-nın ən yüksək korporativ səviyyəsidir — əlavə səviyyə yoxdur.',
    ru: 'Enterprise — высший корпоративный уровень VOYARA, дальнейшего уровня нет.',
    en: "Enterprise is VOYARA's top corporate tier — there is no further tier."
  },
  fairUseLimits: [
    {
      founderConfigurable: true,
      description: {
        az: 'Bütün xidmət səviyyələri fərdi müqavilə ilə müəyyən edilir',
        ru: 'Все уровни обслуживания определяются индивидуальным договором',
        en: 'All service levels are set by individual contract'
      }
    }
  ],
  capabilityFlags: {
    familyMultiDestinationPlanning: false,
    ancillaryCoordination: false,
    approvalWorkflow: true,
    travellerProfiles: true,
    policyGovernance: true,
    reporting: true,
    companyDashboard: true,
    executiveTravelHandling: true,
    supplierRateConfiguration: true
  },
  isCustomPriced: true
};

export const MEMBERSHIP_CATALOGUE: readonly MembershipPlanDefinition[] = [
  smart, plus, premium, black, starter, standard, professional, enterprise
];

export const PERSONAL_PLANS = MEMBERSHIP_CATALOGUE.filter((p) => p.category === 'PERSONAL');
export const CORPORATE_PLANS = MEMBERSHIP_CATALOGUE.filter((p) => p.category === 'CORPORATE');

export function getPlanByCode(planCode: PlanCode): MembershipPlanDefinition {
  const plan = MEMBERSHIP_CATALOGUE.find((p) => p.planCode === planCode);
  if (!plan) throw new Error(`membership-catalogue: unknown planCode "${planCode}"`);
  return plan;
}

/** Full inherited benefit list: parent's additionalBenefits (recursively)
 *  followed by this plan's own additionalBenefits, for a given locale. */
export function getFullBenefitList(planCode: PlanCode, locale: Locale): string[] {
  const plan = getPlanByCode(planCode);
  const inherited = plan.inheritsFrom ? getFullBenefitList(plan.inheritsFrom, locale) : [];
  return [...inherited, ...plan.additionalBenefits[locale]];
}

/** "Everything in {ParentName}" label for a locale, or null if the plan has
 *  no parent (entry-level plan). */
export function getInheritanceLabel(planCode: PlanCode, locale: Locale): string | null {
  const plan = getPlanByCode(planCode);
  if (!plan.inheritsFrom) return null;
  const parent = getPlanByCode(plan.inheritsFrom);
  const templates: LocalizedText = {
    az: `${parent.name.az}-da olan hər şey`,
    ru: `Всё, что есть в ${parent.name.ru}`,
    en: `Everything in ${parent.name.en}`
  };
  return templates[locale];
}

// ---------------------------------------------------------------------------
// Pricing (derived — never re-declared) and annual-savings computation
// ---------------------------------------------------------------------------

export interface ResolvedPricing {
  monthlyMinorUnits: number | null;
  annualMinorUnits: number | null;
  monthlyDisplay: number | null;
  annualDisplay: number | null;
  /** monthly * 12 - annual, in display units (₼). null if either price is
   *  unavailable (e.g. Enterprise). */
  annualSavingDisplay: number | null;
  isCustomPriced: boolean;
}

export function getResolvedPricing(planCode: PlanCode): ResolvedPricing {
  const locked = LOCKED_PLAN_PRICES[planCode];
  const monthlyMinorUnits = locked.MONTHLY;
  const annualMinorUnits = locked.ANNUAL;
  const monthlyDisplay = monthlyMinorUnits === null ? null : monthlyMinorUnits / 100;
  const annualDisplay = annualMinorUnits === null ? null : annualMinorUnits / 100;
  const annualSavingDisplay =
    monthlyDisplay !== null && annualDisplay !== null
      ? Math.round((monthlyDisplay * 12 - annualDisplay) * 100) / 100
      : null;
  return {
    monthlyMinorUnits,
    annualMinorUnits,
    monthlyDisplay,
    annualDisplay,
    annualSavingDisplay,
    isCustomPriced: monthlyMinorUnits === null && annualMinorUnits === null
  };
}

/** "12 months for the price of 10" — localized annual-value framing text,
 *  reused wherever the annual selector is shown. */
export const ANNUAL_VALUE_FRAMING: LocalizedText = {
  az: '12 ay üçün 10 ayın qiyməti',
  ru: '12 месяцев по цене 10',
  en: '12 months for the price of 10'
};
