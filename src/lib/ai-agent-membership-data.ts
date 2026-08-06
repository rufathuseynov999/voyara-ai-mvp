import type { Locale } from '@/i18n/config';

/**
 * Phase C5 / C7.2 — AI-Agent Membership Value shared data authority.
 *
 * Sole source of the section's localized content and honest, source-
 * verified statuses (see VOYARA-AI-AGENT-RUNTIME-READINESS.md for the full
 * audit this data reflects). Both the React component
 * (ai-agent-membership-section.tsx) and the standalone HTML export bridge
 * import from here — neither maintains its own copy.
 */

export type AgentStatus =
  | 'IMPLEMENTED'
  | 'DETERMINISTIC'
  | 'SIMULATED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'ACTIVATION_PENDING';

export type AgentKey =
  | 'VOICE_RECEPTION' | 'SALES' | 'CONCIERGE' | 'OPERATIONS'
  | 'CORPORATE_DESK' | 'SMM_CONTENT' | 'MARKETING_STRATEGIST' | 'COO';

export interface AgentSectionEntry {
  key: AgentKey;
  name: string;
  memberBenefit: string;
  prepares: string;
  safelyAutomates: string;
  requiresApproval: string;
  channel: string;
  status: AgentStatus;
}

export const SECTION_TITLE: Record<Locale, string> = {
  az: 'VOYARA AI agent sistemi',
  ru: 'Система ИИ-агентов VOYARA',
  en: 'VOYARA AI agent system'
};

export const SECTION_INTRO: Record<Locale, string> = {
  az: 'Üzvlüyünüzün arxasında işləyən agentlər — hər biri hazırlıq işini görür, insan mütəxəssis təsdiqləyir.',
  ru: 'Агенты, работающие за вашим членством, — каждый выполняет подготовительную работу, а подтверждает человек-эксперт.',
  en: "The agents working behind your membership — each does the preparation work, a human expert approves."
};

export const STATUS_LABEL: Record<Locale, Record<AgentStatus, string>> = {
  az: {
    IMPLEMENTED: 'Tətbiq olunub', DETERMINISTIC: 'Qaydaya əsaslanan (deterministik)', SIMULATED: 'Simulyasiya rejimində',
    PROVIDER_NOT_CONFIGURED: 'Provayder konfiqurasiya olunmayıb', HUMAN_APPROVAL_REQUIRED: 'İnsan təsdiqi tələb olunur',
    ACTIVATION_PENDING: 'Aktivləşdirmə gözlənilir'
  },
  ru: {
    IMPLEMENTED: 'Реализовано', DETERMINISTIC: 'Детерминированное (на основе правил)', SIMULATED: 'В режиме симуляции',
    PROVIDER_NOT_CONFIGURED: 'Провайдер не настроен', HUMAN_APPROVAL_REQUIRED: 'Требуется подтверждение человеком',
    ACTIVATION_PENDING: 'Ожидает активации'
  },
  en: {
    IMPLEMENTED: 'Implemented', DETERMINISTIC: 'Deterministic (rule-based)', SIMULATED: 'Simulated',
    PROVIDER_NOT_CONFIGURED: 'Provider not configured', HUMAN_APPROVAL_REQUIRED: 'Human approval required',
    ACTIVATION_PENDING: 'Activation pending'
  }
};

export const AZ_AGENTS: AgentSectionEntry[] = [
  {
    key: 'VOICE_RECEPTION', name: 'Səs Qəbulu Agenti',
    memberBenefit: 'Zəngləriniz 24/7 qəbul olunur, əsas məlumat toplanır və lazım olduqda insan komandasına yönləndirilir.',
    prepares: 'Zəng məzmununu qeyd edir və aşağı riskli sorğular üçün cavab layihəsi hazırlayır.',
    safelyAutomates: 'Adi sualların ilkin qeydə alınmasını və məlumat toplanmasını.',
    requiresApproval: 'Hər hansı rezervasiya, ödəniş və ya riskli əməliyyat tələb edən zəng insan komandasına ötürülür.',
    channel: 'Telefon / səs',
    status: 'SIMULATED'
  },
  {
    key: 'SALES', name: 'Satış Agenti',
    memberBenefit: 'Sorğunuz araşdırılır və mütəxəssis komandası üçün hazır təklif layihəsi hazırlanır.',
    prepares: 'Təyinat, tarif və təklif araşdırmasını; təqib mesajlarının layihəsini.',
    safelyAutomates: 'Lead-lərin qaydaya əsaslanan bölüşdürülməsini və planlaşdırılmış xatırlatmaları.',
    requiresApproval: 'Hər hansı mesajın müştəriyə göndərilməsi və kommersiya öhdəliyi insan tərəfindən təsdiqlənir.',
    channel: 'WhatsApp / Instagram / veb',
    status: 'DETERMINISTIC'
  },
  {
    key: 'CONCIERGE', name: 'Konsyerj Agenti',
    memberBenefit: 'Premium və Black üzvlər üçün planlaşdırılan davamlı səyahət koordinasiyası.',
    prepares: 'Gələcəkdə: restoran, fəaliyyət və xüsusi tələb koordinasiyasını.',
    safelyAutomates: 'Hazırda tətbiq olunmuş avtomatlaşdırma yoxdur.',
    requiresApproval: 'Bütün konsyerj tələbləri insan komandası tərəfindən icra olunur.',
    channel: 'WhatsApp / Trip Room',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'OPERATIONS', name: 'Əməliyyat Agenti',
    memberBenefit: 'Son tarixlər və dəyişikliklər arxa planda izlənilir ki, heç nə gözdən qaçmasın.',
    prepares: 'Təchizatçı cavabı, bilet son tarixi və sənəd yoxlama siyahısı üçün xatırlatmaları.',
    safelyAutomates: 'Son tarix izlənməsini və daxili eskalasiya qeydlərinin yaradılmasını.',
    requiresApproval: 'Pozuntu, ləğvetmə və ya təcili vəziyyət insan komandası tərəfindən idarə olunur.',
    channel: 'Daxili əməliyyat paneli',
    status: 'DETERMINISTIC'
  },
  {
    key: 'CORPORATE_DESK', name: 'Korporativ Masa Agenti',
    memberBenefit: 'Planlaşdırılan: korporativ tələblərin mərkəzləşdirilmiş qəbulu və təsdiq iş axını.',
    prepares: 'Gələcəkdə: işçi tələbi qəbulunu və menecer təsdiqinə hazırlığı.',
    safelyAutomates: 'Hazırda tətbiq olunmuş avtomatlaşdırma yoxdur.',
    requiresApproval: 'Bütün korporativ təsdiqlər müəyyən edilmiş menecer tərəfindən verilir.',
    channel: 'Korporativ portal',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'SMM_CONTENT', name: 'SMM və Kontent Agenti',
    memberBenefit: 'Marka məzmunu qaydaya uyğun hazırlanır, lakin yalnız insan təsdiqi ilə dərc olunur.',
    prepares: 'Kontent təqvimi qeydlərini və AZ/RU/EN məzmun layihələrini.',
    safelyAutomates: 'Məzmun layihəsi yaradılmasını və planlaşdırma qeydlərini.',
    requiresApproval: 'Faktiki dərc etmə yalnız insan təsdiqindən sonra baş verir (hazırda dərc funksiyası tətbiq olunmayıb).',
    channel: 'Instagram / veb',
    status: 'DETERMINISTIC'
  },
  {
    key: 'MARKETING_STRATEGIST', name: 'Marketinq Strateji Agenti',
    memberBenefit: 'Planlaşdırılan: kampaniya strategiyası və büdcə tövsiyələri.',
    prepares: 'Gələcəkdə: bazar araşdırması və strateji tövsiyələri.',
    safelyAutomates: 'Hazırda tətbiq olunmuş avtomatlaşdırma yoxdur.',
    requiresApproval: 'Bütün strateji qərarlar founder/idarəetmə tərəfindən verilir.',
    channel: 'Daxili idarəetmə paneli',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'COO', name: 'COO Agenti',
    memberBenefit: 'Əməliyyat sağlamlığı davamlı izlənilir ki, problemlər erkən aşkarlansın.',
    prepares: 'Gündəlik əməliyyat xülasəsini və məsləhət xarakterli təklifləri.',
    safelyAutomates: 'Xülasə hesabatının hazırlanmasını.',
    requiresApproval: 'Hər hansı təklif olunan əməliyyat dəyişikliyi insan rəhbərliyi tərəfindən qərarlaşdırılır.',
    channel: 'Daxili idarəetmə paneli',
    status: 'DETERMINISTIC'
  }
];

export const RU_AGENTS: AgentSectionEntry[] = [
  {
    key: 'VOICE_RECEPTION', name: 'Агент голосового приёма',
    memberBenefit: 'Ваши звонки принимаются круглосуточно, собирается основная информация и при необходимости передаётся команде людей.',
    prepares: 'Фиксирует содержание звонка и готовит проект ответа для запросов низкого риска.',
    safelyAutomates: 'Первичную фиксацию обычных вопросов и сбор информации.',
    requiresApproval: 'Любой звонок, требующий бронирования, оплаты или рискованного действия, передаётся команде людей.',
    channel: 'Телефон / голос',
    status: 'SIMULATED'
  },
  {
    key: 'SALES', name: 'Агент продаж',
    memberBenefit: 'Ваш запрос исследуется, и для команды экспертов готовится проект предложения.',
    prepares: 'Исследование направления, тарифа и предложения; проекты писем для последующего контакта.',
    safelyAutomates: 'Распределение лидов на основе правил и запланированные напоминания.',
    requiresApproval: 'Отправка любого сообщения клиенту и коммерческое обязательство подтверждаются человеком.',
    channel: 'WhatsApp / Instagram / веб',
    status: 'DETERMINISTIC'
  },
  {
    key: 'CONCIERGE', name: 'Агент консьержа',
    memberBenefit: 'Запланированная непрерывная координация поездки для участников Premium и Black.',
    prepares: 'В будущем: координацию ресторанов, активностей и особых запросов.',
    safelyAutomates: 'На данный момент реализованной автоматизации нет.',
    requiresApproval: 'Все запросы к консьержу выполняются командой людей.',
    channel: 'WhatsApp / Trip Room',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'OPERATIONS', name: 'Агент операций',
    memberBenefit: 'Сроки и изменения отслеживаются за кулисами, чтобы ничего не упустить.',
    prepares: 'Напоминания об ответе поставщика, сроке выписки билета и чек-листе документов.',
    safelyAutomates: 'Отслеживание сроков и создание внутренних записей эскалации.',
    requiresApproval: 'Сбои, отмены или экстренные ситуации обрабатываются командой людей.',
    channel: 'Внутренняя панель операций',
    status: 'DETERMINISTIC'
  },
  {
    key: 'CORPORATE_DESK', name: 'Агент корпоративного отдела',
    memberBenefit: 'Запланировано: централизованный приём корпоративных заявок и процесс утверждения.',
    prepares: 'В будущем: приём заявок сотрудников и подготовку к утверждению менеджером.',
    safelyAutomates: 'На данный момент реализованной автоматизации нет.',
    requiresApproval: 'Все корпоративные утверждения выдаёт назначенный менеджер.',
    channel: 'Корпоративный портал',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'SMM_CONTENT', name: 'Агент SMM и контента',
    memberBenefit: 'Контент бренда готовится по правилам, но публикуется только после подтверждения человеком.',
    prepares: 'Записи контент-календаря и проекты контента на AZ/RU/EN.',
    safelyAutomates: 'Создание черновиков контента и записей планирования.',
    requiresApproval: 'Фактическая публикация происходит только после подтверждения человеком (функция публикации пока не реализована).',
    channel: 'Instagram / веб',
    status: 'DETERMINISTIC'
  },
  {
    key: 'MARKETING_STRATEGIST', name: 'Агент маркетинговой стратегии',
    memberBenefit: 'Запланировано: стратегия кампаний и рекомендации по бюджету.',
    prepares: 'В будущем: исследование рынка и стратегические рекомендации.',
    safelyAutomates: 'На данный момент реализованной автоматизации нет.',
    requiresApproval: 'Все стратегические решения принимает учредитель/руководство.',
    channel: 'Внутренняя панель управления',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'COO', name: 'Агент COO',
    memberBenefit: 'Операционное состояние отслеживается непрерывно, чтобы проблемы выявлялись рано.',
    prepares: 'Ежедневную операционную сводку и рекомендательные предложения.',
    safelyAutomates: 'Подготовку сводного отчёта.',
    requiresApproval: 'Любое предложенное операционное изменение решает руководство.',
    channel: 'Внутренняя панель управления',
    status: 'DETERMINISTIC'
  }
];

export const EN_AGENTS: AgentSectionEntry[] = [
  {
    key: 'VOICE_RECEPTION', name: 'Voice Reception Agent',
    memberBenefit: 'Your calls are received around the clock, key information is captured, and the call is routed to a human team when needed.',
    prepares: 'Call-content capture and a draft response for low-risk requests.',
    safelyAutomates: 'Initial logging of routine questions and information gathering.',
    requiresApproval: 'Any call requiring booking, payment, or a risk-sensitive action is handed to the human team.',
    channel: 'Phone / voice',
    status: 'SIMULATED'
  },
  {
    key: 'SALES', name: 'Sales Agent',
    memberBenefit: 'Your request is researched and a draft proposal is prepared for the expert team.',
    prepares: 'Destination, rate and offer research; follow-up message drafts.',
    safelyAutomates: 'Rule-based lead ownership assignment and scheduled reminders.',
    requiresApproval: 'Sending any message to a customer and any commercial commitment is confirmed by a human.',
    channel: 'WhatsApp / Instagram / web',
    status: 'DETERMINISTIC'
  },
  {
    key: 'CONCIERGE', name: 'Concierge Agent',
    memberBenefit: 'Planned: ongoing trip coordination for Premium and Black members.',
    prepares: 'Future: restaurant, activity and special-request coordination.',
    safelyAutomates: 'No automation is implemented at this time.',
    requiresApproval: 'All concierge requests are carried out by the human team.',
    channel: 'WhatsApp / Trip Room',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'OPERATIONS', name: 'Operations Agent',
    memberBenefit: 'Deadlines and changes are tracked behind the scenes so nothing gets missed.',
    prepares: 'Supplier-response, ticketing-deadline and document-checklist reminders.',
    safelyAutomates: 'Deadline tracking and creation of internal escalation records.',
    requiresApproval: 'Disruptions, cancellations, or emergencies are handled by the human team.',
    channel: 'Internal operations console',
    status: 'DETERMINISTIC'
  },
  {
    key: 'CORPORATE_DESK', name: 'Corporate Desk Agent',
    memberBenefit: 'Planned: centralized intake of corporate requests and an approval workflow.',
    prepares: 'Future: employee travel-request intake and preparation for manager approval.',
    safelyAutomates: 'No automation is implemented at this time.',
    requiresApproval: 'All corporate approvals are issued by the designated manager.',
    channel: 'Corporate portal',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'SMM_CONTENT', name: 'SMM & Content Agent',
    memberBenefit: 'Brand content is prepared to a consistent standard but only ever published after human approval.',
    prepares: 'Content-calendar entries and AZ/RU/EN content drafts.',
    safelyAutomates: 'Content-draft creation and scheduling records.',
    requiresApproval: 'Actual publication only happens after human approval (a publish function is not implemented yet).',
    channel: 'Instagram / web',
    status: 'DETERMINISTIC'
  },
  {
    key: 'MARKETING_STRATEGIST', name: 'Marketing Strategist Agent',
    memberBenefit: 'Planned: campaign strategy and budget recommendations.',
    prepares: 'Future: market research and strategic recommendations.',
    safelyAutomates: 'No automation is implemented at this time.',
    requiresApproval: 'All strategic decisions are made by the founder/leadership.',
    channel: 'Internal admin console',
    status: 'ACTIVATION_PENDING'
  },
  {
    key: 'COO', name: 'COO Agent',
    memberBenefit: 'Operational health is monitored continuously so issues surface early.',
    prepares: 'A daily operations digest and advisory proposals.',
    safelyAutomates: 'Preparation of the digest report.',
    requiresApproval: 'Any proposed operational change is decided by human leadership.',
    channel: 'Internal admin console',
    status: 'DETERMINISTIC'
  }
];

export const AGENTS_BY_LOCALE: Record<Locale, AgentSectionEntry[]> = { az: AZ_AGENTS, ru: RU_AGENTS, en: EN_AGENTS };

export const FIELD_LABELS: Record<Locale, { benefit: string; prepares: string; automates: string; approval: string; channel: string; status: string }> = {
  az: { benefit: 'Üzvlük faydası', prepares: 'Hazırladığı', automates: 'Təhlükəsiz avtomatlaşdırdığı', approval: 'İnsan təsdiqi tələb olunan', channel: 'Kanal', status: 'Status' },
  ru: { benefit: 'Выгода для участника', prepares: 'Что готовит', automates: 'Что безопасно автоматизирует', approval: 'Требует подтверждения человеком', channel: 'Канал', status: 'Статус' },
  en: { benefit: 'Member benefit', prepares: 'What it prepares', automates: 'What it safely automates', approval: 'What requires human approval', channel: 'Channel', status: 'Status' }
};

