import type { Locale } from '@/i18n/config';

/**
 * Phase C4 / C7.2 — Member-Value Journey shared data authority.
 *
 * This module is the SOLE source of the journey's localized content. Both
 * the React component (member-value-journey.tsx) and the standalone HTML
 * export bridge (scripts/export-membership-catalogue.ts) import from here —
 * neither maintains its own copy.
 */

export type JourneyStepKey =
  | 'REQUEST'
  | 'AI_RESEARCH'
  | 'RATE_COMPARISON'
  | 'HUMAN_REVIEW'
  | 'APPROVAL'
  | 'BOOKING_COORDINATION'
  | 'TRIP_ROOM'
  | 'ONGOING_SUPPORT';

export interface JourneyStepContent {
  key: JourneyStepKey;
  title: string;
  customerProvides: string;
  voyaraPrepares: string;
  commercialValue: string;
  approvalPoint: string;
  nextStep: string;
}

export const OPERATING_PRINCIPLE: Record<Locale, string> = {
  az: 'Süni intellekt hazırlayır. İnsan təsdiqləyir. VOYARA icra edir.',
  ru: 'ИИ готовит. Человек подтверждает. VOYARA исполняет.',
  en: 'AI prepares. The human approves. VOYARA executes.'
};

export const JOURNEY_TITLE: Record<Locale, string> = {
  az: 'Üzvlük dəyər səyahəti',
  ru: 'Путь ценности членства',
  en: 'Member-value journey'
};

export const JOURNEY_INTRO: Record<Locale, string> = {
  az: 'Üzvlüyünüz VOYARA-ya sizin adınızdan davamlı işləmək icazəsi verir — mövcud tarifləri axtarır, təklifləri müqayisə edir, səyahət variantlarını hazırlayır, marşrutu əlaqələndirir və vacib qərarları insan mütəxəssisinə yönləndirir.',
  ru: 'Ваше членство даёт VOYARA право непрерывно работать от вашего имени — искать доступные тарифы, сравнивать предложения, готовить варианты поездки, координировать маршрут и передавать важные решения человеку-эксперту.',
  en: 'Your membership gives VOYARA permission to work continuously on your behalf — searching available rates, comparing offers, preparing travel options, coordinating the journey, and escalating important decisions to a human expert.'
};

export const AZ_STEPS: JourneyStepContent[] = [
  {
    key: 'REQUEST',
    title: 'Tələb',
    customerProvides: 'Təyinat, tarixlər, səyahətçi sayı və büdcə çərçivəsi kimi əsas səyahət niyyətini bildirirsiniz — WhatsApp, Trip Wizard və ya sifariş masası vasitəsilə.',
    voyaraPrepares: 'Süni intellekt tələbi qəbul edir, əskik detalları aydınlaşdırır və işi araşdırma üçün hazırlayır.',
    commercialValue: 'Ayrı-ayrı sayt və agentliklərlə əlaqə saxlamaq əvəzinə, tək müraciətlə bütün prosesi başladırsınız.',
    approvalPoint: 'Bu mərhələdə insan təsdiqi tələb olunmur — tələbin qəbulu risksizdir.',
    nextStep: 'Süni intellekt araşdırmaya başlayır.'
  },
  {
    key: 'AI_RESEARCH',
    title: 'AI araşdırması',
    customerProvides: 'Əlavə heç nə tələb olunmur; seçimləriniz və əvvəlki tərcihləriniz nəzərə alınır.',
    voyaraPrepares: 'Süni intellekt təyinat, otel, uçuş və transfer variantlarını araşdırır və üzv üçün mövcud olan tarifləri toplayır.',
    commercialValue: 'Mövcud VOYARA üzv tariflərinə və mövcud olduqda üstünlük verilən təkliflərə çıxış əldə edirsiniz — bunu tək başına tapmaq vaxt aparardı.',
    approvalPoint: 'Yenə də insan təsdiqi tələb olunmur — bu, hazırlıq mərhələsidir, öhdəlik deyil.',
    nextStep: 'Toplanan variantlar müqayisə üçün təqdim olunur.'
  },
  {
    key: 'RATE_COMPARISON',
    title: 'Mövcud tariflərin müqayisəsi',
    customerProvides: 'Prioritetləriniz haqqında rəy verə bilərsiniz (məsələn, qiymət, məkan, çeviklik).',
    voyaraPrepares: 'Süni intellekt mövcud ictimai, üzv və mövcud olduqda özəl tarifləri geniş şəkildə müqayisə edir.',
    commercialValue: 'Hər bir sayta tək-tək baxmaq əvəzinə, geniş təchizatçı müqayisəsindən faydalanırsınız.',
    approvalPoint: 'Hələ öhdəlik yoxdur — bu, sizə göstərilməzdən əvvəl son yoxlamadır.',
    nextStep: 'Ən uyğun variantlar insan yoxlamasına göndərilir.'
  },
  {
    key: 'HUMAN_REVIEW',
    title: 'İnsan yoxlaması',
    customerProvides: 'Heç nə — bu addım tamamilə arxa planda baş verir.',
    voyaraPrepares: 'VOYARA komandasından real insan hazırlanan təklifi yoxlayır, dəqiqliyi təsdiqləyir və lazım olduqda düzəliş edir.',
    commercialValue: 'Yalnız avtomatlaşdırılmış nəticə deyil, insan tərəfindən yoxlanılmış təklif alırsınız — bu, VOYARA-nın "AI hazırlayır, insan təsdiqləyir" prinsipinin əsasıdır.',
    approvalPoint: 'Bu, birinci insan yoxlama nöqtəsidir — sizə göstərilmədən əvvəl.',
    nextStep: 'Yoxlanılmış təklif sizə təqdim olunur.'
  },
  {
    key: 'APPROVAL',
    title: 'Təsdiq',
    customerProvides: 'Yekun qiymət və şərtləri nəzərdən keçirir və rəsmi qərarınızı verirsiniz.',
    voyaraPrepares: 'VOYARA yekun qiyməti, şərtləri və mövcudluq qeydlərini aydın şəkildə təqdim edir.',
    commercialValue: 'Sürprizsiz, tam şəffaf qərar qəbul edirsiniz — yekun qiymət təsdiqdən əvvəl göstərilir.',
    approvalPoint: 'Bu, sizin öz təsdiqinizdir — ödəniş və ya rezervasiya yalnız sizin razılığınızdan sonra baş verir.',
    nextStep: 'Rezervasiya əməliyyatları başlayır.'
  },
  {
    key: 'BOOKING_COORDINATION',
    title: 'Rezervasiya əlaqələndirilməsi',
    customerProvides: 'Tələb olunan sənədləşdirmə və ya ödəniş məlumatını təqdim edirsiniz.',
    voyaraPrepares: 'VOYARA otel, uçuş və əlavə xidmətlərin (viza, sığorta, transfer) rezervasiyasını əlaqələndirir və hər addımı sizinlə paylaşır.',
    commercialValue: 'Ayrı-ayrı təchizatçılarla özünüz danışmaq əvəzinə, tək əlaqə nöqtəsindən tam əlaqələndirmə alırsınız.',
    approvalPoint: 'Riskli və ya dəyişiklik tələb edən əməliyyatlar yenidən insan təsdiqindən keçir.',
    nextStep: 'Səyahətiniz Trip Room-da təşkil olunur.'
  },
  {
    key: 'TRIP_ROOM',
    title: 'Trip Room',
    customerProvides: 'Heç nə əlavə tələb olunmur — Trip Room avtomatik yaradılır.',
    voyaraPrepares: 'Bütün sənədlər, marşrut, rezervasiya təsdiqləri və əlaqə nöqtələri bir yerdə toplanır.',
    commercialValue: 'Səyahətinizin bütün detallarına istənilən vaxt tək yerdən çıxış əldə edirsiniz.',
    approvalPoint: 'Hər hansı dəyişiklik tələbi yenə insan təsdiqindən keçir.',
    nextStep: 'Səyahət boyunca davamlı dəstək başlayır.'
  },
  {
    key: 'ONGOING_SUPPORT',
    title: 'Davamlı dəstək',
    customerProvides: 'Sual, dəyişiklik tələbi və ya təcili vəziyyət barədə məlumat verirsiniz.',
    voyaraPrepares: 'Süni intellekt son tarixləri və dəyişiklikləri izləyir; insan komandası pozuntu, təxirə salma və ya təcili halları idarə edir.',
    commercialValue: 'Səyahət boyu tək başına qalmırsınız — üzvlük səviyyənizə uyğun dəstək davam edir.',
    approvalPoint: 'Ödəniş tələb edən və ya rezervasiyaya təsir edən hər dəyişiklik insan təsdiqindən keçir.',
    nextStep: 'Növbəti səyahətiniz üçün seçimləriniz və tarixçəniz saxlanılır.'
  }
];

export const RU_STEPS: JourneyStepContent[] = [
  {
    key: 'REQUEST',
    title: 'Запрос',
    customerProvides: 'Вы сообщаете основное намерение поездки — направление, даты, число путешественников и бюджетные рамки — через WhatsApp, Trip Wizard или стол заказов.',
    voyaraPrepares: 'ИИ принимает запрос, уточняет недостающие детали и готовит его к исследованию.',
    commercialValue: 'Вместо обращения на отдельные сайты и в агентства вы запускаете весь процесс одним обращением.',
    approvalPoint: 'На этом этапе подтверждение человеком не требуется — приём запроса безрисковый.',
    nextStep: 'ИИ начинает исследование.'
  },
  {
    key: 'AI_RESEARCH',
    title: 'Исследование ИИ',
    customerProvides: 'Ничего дополнительного не требуется; учитываются ваши предпочтения и предыдущий выбор.',
    voyaraPrepares: 'ИИ исследует варианты направления, отеля, рейса и трансфера и собирает доступные для участника тарифы.',
    commercialValue: 'Вы получаете доступ к доступным тарифам VOYARA для участников и, где возможно, к предпочтительным предложениям — самостоятельный поиск этого занял бы много времени.',
    approvalPoint: 'Подтверждение человеком по-прежнему не требуется — это этап подготовки, а не обязательство.',
    nextStep: 'Собранные варианты передаются для сравнения.'
  },
  {
    key: 'RATE_COMPARISON',
    title: 'Сравнение доступных тарифов',
    customerProvides: 'Вы можете указать приоритеты (например, цена, расположение, гибкость).',
    voyaraPrepares: 'ИИ широко сравнивает доступные публичные, для участников и, где возможно, частные тарифы.',
    commercialValue: 'Вместо просмотра каждого сайта по отдельности вы получаете выгоду от широкого сравнения поставщиков.',
    approvalPoint: 'Обязательств пока нет — это финальная проверка перед показом вам.',
    nextStep: 'Наиболее подходящие варианты передаются на проверку человеку.'
  },
  {
    key: 'HUMAN_REVIEW',
    title: 'Проверка человеком',
    customerProvides: 'Ничего — этот шаг полностью происходит за кулисами.',
    voyaraPrepares: 'Реальный человек из команды VOYARA проверяет подготовленное предложение, подтверждает точность и при необходимости вносит правки.',
    commercialValue: 'Вы получаете предложение, проверенное человеком, а не только автоматизированный результат — это основа принципа VOYARA "ИИ готовит, человек подтверждает".',
    approvalPoint: 'Это первая точка проверки человеком — до того, как предложение будет показано вам.',
    nextStep: 'Проверенное предложение представляется вам.'
  },
  {
    key: 'APPROVAL',
    title: 'Подтверждение',
    customerProvides: 'Вы рассматриваете итоговую цену и условия и принимаете официальное решение.',
    voyaraPrepares: 'VOYARA чётко представляет итоговую цену, условия и примечания о наличии.',
    commercialValue: 'Вы принимаете решение без сюрпризов, при полной прозрачности — итоговая цена показывается до подтверждения.',
    approvalPoint: 'Это ваше собственное подтверждение — оплата или бронирование происходит только после вашего согласия.',
    nextStep: 'Начинается координация бронирования.'
  },
  {
    key: 'BOOKING_COORDINATION',
    title: 'Координация бронирования',
    customerProvides: 'Вы предоставляете необходимые документы или платёжные данные.',
    voyaraPrepares: 'VOYARA координирует бронирование отеля, рейса и дополнительных услуг (виза, страхование, трансфер) и сообщает вам о каждом шаге.',
    commercialValue: 'Вместо самостоятельных переговоров с отдельными поставщиками вы получаете полную координацию из одной точки контакта.',
    approvalPoint: 'Рискованные операции или операции, требующие изменений, снова проходят подтверждение человеком.',
    nextStep: 'Ваша поездка организуется в Trip Room.'
  },
  {
    key: 'TRIP_ROOM',
    title: 'Trip Room',
    customerProvides: 'Дополнительно ничего не требуется — Trip Room создаётся автоматически.',
    voyaraPrepares: 'Все документы, маршрут, подтверждения бронирования и контактные точки собираются в одном месте.',
    commercialValue: 'Вы получаете доступ ко всем деталям поездки из одного места в любое время.',
    approvalPoint: 'Любой запрос на изменение снова проходит подтверждение человеком.',
    nextStep: 'Начинается непрерывная поддержка на протяжении поездки.'
  },
  {
    key: 'ONGOING_SUPPORT',
    title: 'Постоянная поддержка',
    customerProvides: 'Вы сообщаете о вопросах, запросах на изменение или срочных ситуациях.',
    voyaraPrepares: 'ИИ отслеживает сроки и изменения; команда людей обрабатывает сбои, задержки или экстренные случаи.',
    commercialValue: 'Вы не остаётесь одни на протяжении поездки — поддержка продолжается в соответствии с уровнем вашего членства.',
    approvalPoint: 'Любое изменение, требующее оплаты или влияющее на бронирование, проходит подтверждение человеком.',
    nextStep: 'Ваши предпочтения и история сохраняются для следующей поездки.'
  }
];

export const EN_STEPS: JourneyStepContent[] = [
  {
    key: 'REQUEST',
    title: 'Request',
    customerProvides: 'You share the basic travel intent — destination, dates, traveller count and budget range — via WhatsApp, the Trip Wizard, or the request desk.',
    voyaraPrepares: 'AI receives the request, clarifies any missing detail, and prepares it for research.',
    commercialValue: 'Instead of contacting separate sites and agencies, you start the whole process with a single request.',
    approvalPoint: 'No human approval is required at this stage — intake carries no risk.',
    nextStep: 'AI begins researching.'
  },
  {
    key: 'AI_RESEARCH',
    title: 'AI research',
    customerProvides: 'Nothing further is required; your saved preferences and prior choices are taken into account.',
    voyaraPrepares: 'AI researches destination, hotel, flight and transfer options and gathers the rates available to members.',
    commercialValue: 'You gain access to available VOYARA member rates and preferred offers where available — finding these on your own would take considerable time.',
    approvalPoint: 'Human approval is still not required — this is a preparation stage, not a commitment.',
    nextStep: 'The gathered options move into comparison.'
  },
  {
    key: 'RATE_COMPARISON',
    title: 'Available-rate comparison',
    customerProvides: 'You can indicate priorities (for example, price, location, flexibility).',
    voyaraPrepares: 'AI broadly compares available public, member and, where available, private rates.',
    commercialValue: 'Instead of checking every site individually, you benefit from broader supplier comparison.',
    approvalPoint: 'Still no commitment — this is the final check before anything is shown to you.',
    nextStep: 'The best-fitting options are sent for human review.'
  },
  {
    key: 'HUMAN_REVIEW',
    title: 'Human review',
    customerProvides: 'Nothing — this step happens entirely behind the scenes.',
    voyaraPrepares: 'A real member of the VOYARA team reviews the prepared proposal, confirms accuracy, and makes corrections where needed.',
    commercialValue: "You receive a human-reviewed recommendation, not just an automated result — this is the foundation of VOYARA's \"AI prepares, human approves\" principle.",
    approvalPoint: 'This is the first human-review checkpoint — before anything reaches you.',
    nextStep: 'The reviewed proposal is presented to you.'
  },
  {
    key: 'APPROVAL',
    title: 'Approval',
    customerProvides: 'You review the final price and conditions and make your formal decision.',
    voyaraPrepares: 'VOYARA presents the final price, conditions, and any availability notes clearly.',
    commercialValue: 'You make a decision with no surprises and full transparency — final price and conditions are shown before approval.',
    approvalPoint: 'This is your own approval — payment or booking only proceeds after your consent.',
    nextStep: 'Booking coordination begins.'
  },
  {
    key: 'BOOKING_COORDINATION',
    title: 'Booking coordination',
    customerProvides: 'You provide any required documentation or payment information.',
    voyaraPrepares: 'VOYARA coordinates hotel, flight and ancillary bookings (visa, insurance, transfer) and keeps you informed at every step.',
    commercialValue: 'Instead of negotiating with each supplier yourself, you get full coordination from a single point of contact.',
    approvalPoint: 'Risk-sensitive or change-requiring actions go through human approval again.',
    nextStep: 'Your trip is organized in the Trip Room.'
  },
  {
    key: 'TRIP_ROOM',
    title: 'Trip Room',
    customerProvides: 'Nothing further is required — the Trip Room is created automatically.',
    voyaraPrepares: 'All documents, the itinerary, booking confirmations and contact points are gathered in one place.',
    commercialValue: 'You get access to every detail of your trip from one place, at any time.',
    approvalPoint: 'Any change request again goes through human approval.',
    nextStep: 'Ongoing support begins for the duration of the trip.'
  },
  {
    key: 'ONGOING_SUPPORT',
    title: 'Ongoing support',
    customerProvides: 'You report questions, change requests, or urgent situations.',
    voyaraPrepares: 'AI tracks deadlines and changes; the human team handles disruptions, delays, or urgent cases.',
    commercialValue: "You're not on your own during the trip — support continues at a level matched to your membership.",
    approvalPoint: 'Any change involving payment or affecting a booking goes through human approval.',
    nextStep: 'Your preferences and history are saved for your next journey.'
  }
];

export const STEPS_BY_LOCALE: Record<Locale, JourneyStepContent[]> = { az: AZ_STEPS, ru: RU_STEPS, en: EN_STEPS };

export const FIELD_LABELS: Record<Locale, { provides: string; prepares: string; value: string; approval: string; next: string }> = {
  az: { provides: 'Sizin verdiyiniz', prepares: 'VOYARA hazırlayır', value: 'Kommersiya dəyəri', approval: 'Təsdiq nöqtəsi', next: 'Növbəti addım' },
  ru: { provides: 'Вы предоставляете', prepares: 'VOYARA готовит', value: 'Коммерческая ценность', approval: 'Точка подтверждения', next: 'Следующий шаг' },
  en: { provides: 'You provide', prepares: 'VOYARA prepares', value: 'Commercial value', approval: 'Approval point', next: 'Next step' }
};

