/**
 * E.2B.1 — deterministic, illustrative preview fixtures for the customer
 * Experience Proof. Nothing here is live: no supplier pricing, no
 * confirmed hotel, no booking, no payment. Every state shown in the
 * preview traces back to one of these fixture objects, never to a real
 * database row — the preview route performs zero Supabase queries.
 */

export type ConversationTurn = { speaker: 'customer' | 'voyara'; text: Record<'az' | 'ru' | 'en', string> };

export const CONVERSATION_SCRIPT: ConversationTurn[] = [
  { speaker: 'customer', text: { az: 'Salam, Bakıdan İstanbula səyahət planlaşdırıram.', ru: 'Привет, я планирую поездку из Баку в Стамбул.', en: "Hi, I'm planning a trip from Baku to Istanbul." } },
  { speaker: 'voyara', text: { az: 'Əla seçimdir! Neçə gecə düşünürsünüz və neçə nəfərsiniz?', ru: 'Отличный выбор! На сколько ночей и сколько человек?', en: 'Great choice! How many nights, and how many travelers?' } },
  { speaker: 'customer', text: { az: '5 gecə, 2 böyük, sentyabr ayında.', ru: '5 ночей, 2 взрослых, в сентябре.', en: '5 nights, 2 adults, sometime in September.' } },
  { speaker: 'voyara', text: { az: 'Başa düşdüm. Təxmini büdcəniz və maraqlarınız (mədəniyyət, yemək, istirahət) nədir?', ru: 'Понял. Какой у вас примерный бюджет и интересы (культура, еда, отдых)?', en: 'Got it. What is your approximate budget, and what interests you — culture, food, relaxation?' } },
  { speaker: 'customer', text: { az: 'Təxminən 3000 AZN. Mədəniyyət, yemək və Bosfor sevirəm, amma sakit templə.', ru: 'Около 3000 AZN. Люблю культуру, еду и Босфор, но в спокойном темпе.', en: 'Around 3,000 AZN. I love culture, food, and the Bosphorus — but a relaxed pace.' } }
];

export type TravelBrief = {
  destination: Record<'az' | 'ru' | 'en', string>;
  origin: Record<'az' | 'ru' | 'en', string>;
  nights: number;
  travelers: number;
  month: Record<'az' | 'ru' | 'en', string>;
  budgetAzn: number;
  interests: Record<'az' | 'ru' | 'en', string>;
  pace: Record<'az' | 'ru' | 'en', string>;
};

export const TRAVEL_BRIEF: TravelBrief = {
  destination: { az: 'İstanbul', ru: 'Стамбул', en: 'Istanbul' },
  origin: { az: 'Bakı', ru: 'Баку', en: 'Baku' },
  nights: 5,
  travelers: 2,
  month: { az: 'Sentyabr', ru: 'Сентябрь', en: 'September' },
  budgetAzn: 3000,
  interests: { az: 'Mədəniyyət, yemək, Bosfor', ru: 'Культура, еда, Босфор', en: 'Culture, food, Bosphorus' },
  pace: { az: 'Sakit', ru: 'Спокойный', en: 'Relaxed' }
};

export type InspirationCard = {
  id: string;
  title: Record<'az' | 'ru' | 'en', string>;
  description: Record<'az' | 'ru' | 'en', string>;
  style: Record<'az' | 'ru' | 'en', string>;
  duration: Record<'az' | 'ru' | 'en', string>;
  imageQuery: string;
};

export const INSPIRATION_CARDS: InspirationCard[] = [
  {
    id: 'classic-istanbul',
    title: { az: 'Klassik İstanbul', ru: 'Классический Стамбул', en: 'Classic Istanbul' },
    description: { az: 'Sultanahmet, Ayasofya və Böyük Bazar ilə tarixi mərkəz.', ru: 'Исторический центр: Султанахмет, Айя-София и Гранд базар.', en: 'The historic core: Sultanahmet, Hagia Sophia, and the Grand Bazaar.' },
    style: { az: 'Mədəniyyət', ru: 'Культура', en: 'Culture' },
    duration: { az: '4–5 gün', ru: '4–5 дней', en: '4–5 days' },
    imageQuery: 'Istanbul Hagia Sophia'
  },
  {
    id: 'istanbul-through-food',
    title: { az: 'Yemək vasitəsilə İstanbul', ru: 'Стамбул через еду', en: 'Istanbul Through Food' },
    description: { az: 'Yerli bazarlar, meyxanalar və Bosfor kənarı restoranlar.', ru: 'Местные рынки, мейхане и рестораны на берегу Босфора.', en: 'Local markets, meyhane taverns, and Bosphorus-side dining.' },
    style: { az: 'Qastronomiya', ru: 'Гастрономия', en: 'Gastronomy' },
    duration: { az: '5 gün', ru: '5 дней', en: '5 days' },
    imageQuery: 'Istanbul food market'
  },
  {
    id: 'bosphorus-slow-luxury',
    title: { az: 'Bosfor və Sakit Lüks', ru: 'Босфор и медленная роскошь', en: 'Bosphorus & Slow Luxury' },
    description: { az: 'Bosfor kənarında otel, gəmi gəzintisi və spa günləri.', ru: 'Отель у Босфора, прогулка на лодке и дни спа.', en: 'Bosphorus-front stays, a boat cruise, and unhurried spa days.' },
    style: { az: 'İstirahət', ru: 'Отдых', en: 'Relaxation' },
    duration: { az: '5–6 gün', ru: '5–6 дней', en: '5–6 days' },
    imageQuery: 'Bosphorus sunset cruise'
  }
];

export type ItineraryActivity = { time: 'morning' | 'afternoon' | 'evening'; title: Record<'az' | 'ru' | 'en', string> };
export type ItineraryDay = { day: number; theme: Record<'az' | 'ru' | 'en', string>; activities: ItineraryActivity[] };



export const ORIGINAL_ITINERARY: ItineraryDay[] = [
  { day: 1, theme: { az: 'Gəliş və Sultanahmet', ru: 'Прибытие и Султанахмет', en: 'Arrival & Sultanahmet' }, activities: [
    { time: 'morning', title: { az: 'Uçuş və otelə giriş', ru: 'Перелёт и заселение', en: 'Flight and hotel check-in' } },
    { time: 'afternoon', title: { az: 'Ayasofya ziyarəti', ru: 'Посещение Айя-Софии', en: 'Hagia Sophia visit' } },
    { time: 'evening', title: { az: 'Yerli restoranda şam yeməyi', ru: 'Ужин в местном ресторане', en: 'Dinner at a local restaurant' } }
  ] },
  { day: 2, theme: { az: 'Böyük Bazar və Topkapı', ru: 'Гранд базар и Топкапы', en: 'Grand Bazaar & Topkapi' }, activities: [
    { time: 'morning', title: { az: 'Topkapı Sarayı', ru: 'Дворец Топкапы', en: 'Topkapi Palace' } },
    { time: 'afternoon', title: { az: 'Böyük Bazarda gəzinti', ru: 'Прогулка по Гранд базару', en: 'Grand Bazaar stroll' } },
    { time: 'evening', title: { az: 'Sərbəst axşam', ru: 'Свободный вечер', en: 'Free evening' } }
  ] },
  { day: 3, theme: { az: 'Bosfor günü', ru: 'День на Босфоре', en: 'Bosphorus day' }, activities: [
    { time: 'morning', title: { az: 'Bosfor gəmi gəzintisi', ru: 'Прогулка на лодке по Босфору', en: 'Bosphorus boat cruise' } },
    { time: 'afternoon', title: { az: 'Ortaköy kəndi', ru: 'Деревня Ортакёй', en: 'Ortaköy village' } },
    { time: 'evening', title: { az: 'Sahil kafesində istirahət', ru: 'Отдых в кафе у моря', en: 'Relax at a waterside café' } }
  ] },
  { day: 4, theme: { az: 'Yemək və yerli həyat', ru: 'Еда и местная жизнь', en: 'Food & local life' }, activities: [
    { time: 'morning', title: { az: 'Kadıköy bazar turu', ru: 'Тур по рынку Кадыкёй', en: 'Kadıköy market tour' } },
    { time: 'afternoon', title: { az: 'Yemək dərsi', ru: 'Кулинарный мастер-класс', en: 'Cooking class' } },
    { time: 'evening', title: { az: 'Meyxanada axşam yeməyi', ru: 'Ужин в мейхане', en: 'Meyhane dinner' } }
  ] },
  { day: 5, theme: { az: 'Sərbəst gün və yola düşmə', ru: 'Свободный день и отъезд', en: 'Free day & departure' }, activities: [
    { time: 'morning', title: { az: 'Sərbəst vaxt / alış-veriş', ru: 'Свободное время / шопинг', en: 'Free time / shopping' } },
    { time: 'afternoon', title: { az: 'Otel çıxışı və hava limanı transferi', ru: 'Выезд из отеля и трансфер в аэропорт', en: 'Check-out & airport transfer' } },
    { time: 'evening', title: { az: 'Uçuş', ru: 'Вылет', en: 'Departure flight' } }
  ] }
];

/** Deterministic edit: "make day three more relaxed and move the Bosphorus cruise to the evening." */
export const REVISED_ITINERARY: ItineraryDay[] = ORIGINAL_ITINERARY.map((day) => {
  if (day.day !== 3) return day;
  return {
    ...day,
    theme: { az: 'Sakit Bosfor günü', ru: 'Спокойный день на Босфоре', en: 'Relaxed Bosphorus day' },
    activities: [
      { time: 'morning', title: { az: 'Gec oyanış və otel spa', ru: 'Поздний подъём и спа отеля', en: 'Slow morning & hotel spa' } },
      { time: 'afternoon', title: { az: 'Ortaköy kəndi (sakit tempdə)', ru: 'Деревня Ортакёй (в спокойном темпе)', en: 'Ortaköy village, unhurried' } },
      { time: 'evening', title: { az: 'Bosfor gəmi gəzintisi (axşam)', ru: 'Прогулка на лодке по Босфору (вечером)', en: 'Bosphorus boat cruise (evening)' } }
    ]
  };
});

export type InspirationDirectionId = 'classic-istanbul' | 'istanbul-through-food' | 'bosphorus-slow-luxury';

/** Deterministic per-direction itinerary overlays. Only the days/fields a
 *  real direction would plausibly change are overridden; everything else
 *  falls back to ORIGINAL_ITINERARY. This makes each Inspiration
 *  selection produce a genuinely different, testable itinerary rather
 *  than only changing a card's border. */
export const DIRECTION_ITINERARIES: Record<InspirationDirectionId, ItineraryDay[]> = {
  'classic-istanbul': [
    { day: 1, theme: { az: 'Sultanahmet və tarixi mərkəz', ru: 'Султанахмет и исторический центр', en: 'Sultanahmet & the historic core' }, activities: [
      { time: 'morning', title: { az: 'Uçuş və otelə giriş', ru: 'Перелёт и заселение', en: 'Flight and hotel check-in' } },
      { time: 'afternoon', title: { az: 'Ayasofya və Sultanəhməd Camisi', ru: 'Айя-София и Голубая мечеть', en: 'Hagia Sophia & the Blue Mosque' } },
      { time: 'evening', title: { az: 'Tarixi meydanda gəzinti', ru: 'Прогулка по исторической площади', en: 'Stroll through the historic square' } }
    ] },
    { day: 2, theme: { az: 'Topkapı və Böyük Bazar', ru: 'Топкапы и Гранд базар', en: 'Topkapi & the Grand Bazaar' }, activities: [
      { time: 'morning', title: { az: 'Topkapı Sarayı turu', ru: 'Тур по дворцу Топкапы', en: 'Topkapi Palace guided tour' } },
      { time: 'afternoon', title: { az: 'Böyük Bazar tarixi alış-veriş', ru: 'Исторический шопинг на Гранд базаре', en: 'Historic shopping at the Grand Bazaar' } },
      { time: 'evening', title: { az: 'Sərbəst axşam', ru: 'Свободный вечер', en: 'Free evening' } }
    ] },
    ...ORIGINAL_ITINERARY.slice(2)
  ],
  'istanbul-through-food': [
    ORIGINAL_ITINERARY[0],
    { day: 2, theme: { az: 'Yerli bazarlar', ru: 'Местные рынки', en: 'Local markets' }, activities: [
      { time: 'morning', title: { az: 'Qadıköy bazar turu', ru: 'Тур по рынку Кадыкёй', en: 'Kadıköy market tour' } },
      { time: 'afternoon', title: { az: 'Yemək dərsi', ru: 'Кулинарный мастер-класс', en: 'Cooking class' } },
      { time: 'evening', title: { az: 'Meyxanada axşam yeməyi', ru: 'Ужин в мейхане', en: 'Meyhane dinner' } }
    ] },
    { day: 3, theme: { az: 'Dad turu', ru: 'Дегустационный тур', en: 'Tasting tour' }, activities: [
      { time: 'morning', title: { az: 'Küçə yeməyi turu', ru: 'Тур уличной еды', en: 'Street food tour' } },
      { time: 'afternoon', title: { az: 'Bosfor kənarında balıq restoranı', ru: 'Рыбный ресторан у Босфора', en: 'Fish restaurant by the Bosphorus' } },
      { time: 'evening', title: { az: 'Ənənəvi çay evi', ru: 'Традиционная чайхана', en: 'Traditional tea house' } }
    ] },
    ...ORIGINAL_ITINERARY.slice(3)
  ],
  'bosphorus-slow-luxury': [
    ORIGINAL_ITINERARY[0],
    ORIGINAL_ITINERARY[1],
    { day: 3, theme: { az: 'Bosfor lüks günü', ru: 'Роскошный день на Босфоре', en: 'Bosphorus luxury day' }, activities: [
      { time: 'morning', title: { az: 'Otel spa proqramı', ru: 'Спа-программа отеля', en: 'Hotel spa program' } },
      { time: 'afternoon', title: { az: 'Sakit Ortaköy gəzintisi', ru: 'Неспешная прогулка по Ортакёй', en: 'Unhurried Ortaköy walk' } },
      { time: 'evening', title: { az: 'Premium Bosfor gəmi gəzintisi', ru: 'Премиальная прогулка на лодке по Босфору', en: 'Premium Bosphorus evening cruise' } }
    ] },
    { day: 4, theme: { az: 'İstirahət günü', ru: 'День отдыха', en: 'Wellness day' }, activities: [
      { time: 'morning', title: { az: 'Gec oyanış', ru: 'Поздний подъём', en: 'Slow morning' } },
      { time: 'afternoon', title: { az: 'Wellness mərkəzi', ru: 'Велнес-центр', en: 'Wellness center' } },
      { time: 'evening', title: { az: 'Otel terasında şam yeməyi', ru: 'Ужин на террасе отеля', en: 'Dinner on the hotel terrace' } }
    ] },
    ORIGINAL_ITINERARY[4]
  ]
};

export const DIRECTION_SUMMARY: Record<InspirationDirectionId, Record<'az' | 'ru' | 'en', string>> = {
  'classic-istanbul': {
    az: 'Marşrut tarixi mərkəzə (Sultanahmet, Ayasofya, Topkapı) fokuslandı.',
    ru: 'Маршрут сфокусирован на историческом центре (Султанахмет, Айя-София, Топкапы).',
    en: 'The itinerary now focuses on the historic core — Sultanahmet, Hagia Sophia, Topkapi.'
  },
  'istanbul-through-food': {
    az: 'Marşrut bazarlara, yemək dərsinə və dad turuna fokuslandı.',
    ru: 'Маршрут сфокусирован на рынках, мастер-классе и дегустационном туре.',
    en: 'The itinerary now focuses on markets, a cooking class, and a tasting tour.'
  },
  'bosphorus-slow-luxury': {
    az: 'Marşrut Bosfor kənarında sakit, lüks günlərə fokuslandı.',
    ru: 'Маршрут сфокусирован на спокойных роскошных днях у Босфора.',
    en: 'The itinerary now focuses on slower, premium Bosphorus-side days.'
  }
};


export const WHAT_CHANGED: Record<'az' | 'ru' | 'en', string> = {
  az: 'Gün 3 daha sakit templə yenidən planlaşdırıldı və Bosfor gəmi gəzintisi axşama köçürüldü.',
  ru: 'День 3 переработан в более спокойном темпе, а прогулка на лодке по Босфору перенесена на вечер.',
  en: 'Day 3 was replanned at a more relaxed pace, and the Bosphorus cruise was moved to the evening.'
};

export type CompareOption = {
  id: 'smart-value' | 'balanced' | 'premium-comfort';
  label: Record<'az' | 'ru' | 'en', string>;
  pace: Record<'az' | 'ru' | 'en', string>;
  hotelLevel: Record<'az' | 'ru' | 'en', string>;
  includedExperiences: Record<'az' | 'ru' | 'en', string>;
  illustrativeBudgetRangeAzn: string;
  flexibility: Record<'az' | 'ru' | 'en', string>;
  serviceLevel: Record<'az' | 'ru' | 'en', string>;
};

export const COMPARE_OPTIONS: CompareOption[] = [
  {
    id: 'smart-value', label: { az: 'Ağıllı Dəyər', ru: 'Умная выгода', en: 'Smart Value' },
    pace: { az: 'Sürətli', ru: 'Быстрый', en: 'Fast-paced' },
    hotelLevel: { az: '3–4 ulduz', ru: '3–4 звезды', en: '3–4 star' },
    includedExperiences: { az: 'Əsas turlar', ru: 'Основные туры', en: 'Core tours' },
    illustrativeBudgetRangeAzn: '2,200–2,600',
    flexibility: { az: 'Məhdud', ru: 'Ограниченная', en: 'Limited' },
    serviceLevel: { az: 'Standart', ru: 'Стандартный', en: 'Standard' }
  },
  {
    id: 'balanced', label: { az: 'Balanslı', ru: 'Сбалансированный', en: 'Balanced' },
    pace: { az: 'Sakit', ru: 'Спокойный', en: 'Relaxed' },
    hotelLevel: { az: '4 ulduz', ru: '4 звезды', en: '4 star' },
    includedExperiences: { az: 'Turlar + yemək təcrübəsi', ru: 'Туры + гастрономия', en: 'Tours + food experience' },
    illustrativeBudgetRangeAzn: '2,800–3,200',
    flexibility: { az: 'Orta', ru: 'Средняя', en: 'Moderate' },
    serviceLevel: { az: 'Premium dəstək', ru: 'Премиум-поддержка', en: 'Premium support' }
  },
  {
    id: 'premium-comfort', label: { az: 'Premium Rahatlıq', ru: 'Премиум комфорт', en: 'Premium Comfort' },
    pace: { az: 'Çox sakit', ru: 'Очень спокойный', en: 'Very relaxed' },
    hotelLevel: { az: '5 ulduz', ru: '5 звёзд', en: '5 star' },
    includedExperiences: { az: 'Şəxsi bələdçi + spa', ru: 'Личный гид + спа', en: 'Private guide + spa' },
    illustrativeBudgetRangeAzn: '3,800–4,500',
    flexibility: { az: 'Yüksək', ru: 'Высокая', en: 'High' },
    serviceLevel: { az: 'Xüsusi konsyerj', ru: 'Выделенный консьерж', en: 'Dedicated concierge' }
  }
];
