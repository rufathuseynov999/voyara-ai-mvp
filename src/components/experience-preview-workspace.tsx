'use client';

import { useState } from 'react';
import {
  TRAVEL_BRIEF, INSPIRATION_CARDS, ORIGINAL_ITINERARY, REVISED_ITINERARY, DIRECTION_ITINERARIES, DIRECTION_SUMMARY,
  WHAT_CHANGED, COMPARE_OPTIONS, type CompareOption, type InspirationDirectionId, type ItineraryDay
} from '@/lib/e2b-experience-preview-fixtures';
import { extractFromMessage, applyCorrection, nextMissingField, isReadyToBuild, EMPTY_BRIEF, type TravelBriefState, type RequiredField } from '@/lib/e2b-conversation-engine';
import { DestinationIllustration, RouteVisualization, HotelIllustration, DiningIllustration, ExperienceIllustration } from './e2b-illustrations/e2b-illustrations';
import { TravelConversationPresentation } from './travel-workspace/travel-conversation-presentation';
import { JourneyCanvasPresentation } from './travel-workspace/journey-canvas-presentation';
import type { ConversationViewModel } from './travel-workspace/travel-workspace-types';

type Locale = 'az' | 'ru' | 'en';
type ChatTurn = { speaker: 'customer' | 'voyara'; text: string };

const QUESTION_FOR_FIELD: Record<RequiredField, Record<Locale, string>> = {
  destination: { en: 'Where would you like to go?', az: 'Hara getmək istəyirsiniz?', ru: 'Куда бы вы хотели поехать?' },
  nights: { en: 'How many nights are you thinking?', az: 'Neçə gecə düşünürsünüz?', ru: 'На сколько ночей вы рассчитываете?' },
  travelers: { en: 'How many travelers?', az: 'Neçə nəfərsiniz?', ru: 'Сколько человек поедет?' },
  budgetAzn: { en: 'What is your approximate budget (in AZN)?', az: 'Təxmini büdcəniz nə qədərdir (AZN)?', ru: 'Какой у вас примерный бюджет (в AZN)?' }
};

const NOT_PROVIDED: Record<Locale, string> = { en: 'Not provided yet', az: 'Hələ göstərilməyib', ru: 'Пока не указано' };

const LABELS: Record<Locale, Record<string, string>> = {
  en: {
    bannerNotice: 'Experience preview — illustrative trip content',
    heading: 'Ask VOYARA', send: 'Send', quickPromptsLabel: 'Try:',
    quick1: "I'm planning a trip from Baku to Istanbul.", quick2: '5 nights, 2 adults, in September, budget 3000 AZN, culture and food.',
    buildJourney: 'Build my journey', understandingTitle: 'Your trip so far',
    destination: 'Destination', nights: 'Nights', travelers: 'Travelers', month: 'Month', budget: 'Budget (illustrative)',
    interests: 'Interests', pace: 'Pace', correctionLabel: 'Want to change something? Just say so:',
    correctionPlaceholder: 'e.g. Actually, make it 6 nights and increase the budget to 3,500 AZN.',
    correctionApply: 'Apply correction', changed: 'Updated', inspirationTitle: 'Inspire me', useDirection: 'Use this direction',
    directionActive: 'Currently shaping your journey', howChanged: 'How this direction changed your journey',
    returnToPrevious: 'Return to previous direction', journeyTitle: 'Your journey', journeySubtitle: 'AI-prepared, illustrative itinerary',
    editPrompt: 'Make day three more relaxed and move the Bosphorus cruise to the evening.',
    applyEdit: 'Apply this change', whatChanged: 'What changed', showOriginal: 'Show original', showRevised: 'Show revised version',
    routeLabel: 'Illustrative route — not a live map', hotelCandidate: 'Hotel candidate', dining: 'Local dining recommendation', notLiveLabel: 'Illustrative — not a confirmed or live availability listing.',
    compareTitle: 'Compare directions', selectDirection: 'Select this direction', selectedPlan: 'Selected plan',
    pace_field: 'Pace', hotelLevel: 'Hotel level', included: 'Included experiences', budgetRange: 'Illustrative budget range (AZN)',
    flexibility: 'Flexibility', serviceLevel: 'VOYARA service level',
    accountabilityTitle: 'What happens next', aiPrepared: 'AI prepared this journey from your conversation.',
    reviewAvailable: 'VOYARA human review is available before anything is finalized.',
    approvalNeeded: 'Your approval will be required before any payment or booking step.',
    noAuthority: 'No payment, booking, or supplier confirmation has been made — this is a preview.',
    continuity: 'After your approval, VOYARA continues the real process through payment, booking, and your Trip Room.'
  },
  az: {
    bannerNotice: 'Təcrübə önizləməsi — illüstrativ səfər məzmunu',
    heading: 'VOYARA-dan soruş', send: 'Göndər', quickPromptsLabel: 'Sınayın:',
    quick1: 'Bakıdan İstanbula səyahət planlaşdırıram.', quick2: '5 gecə, 2 böyük, sentyabr, büdcə 3000 AZN, mədəniyyət və yemək.',
    buildJourney: 'Səyahətimi qur', understandingTitle: 'İndiyədək səyahətiniz',
    destination: 'İstiqamət', nights: 'Gecə', travelers: 'Səyahətçi', month: 'Ay', budget: 'Büdcə (illüstrativ)',
    interests: 'Maraqlar', pace: 'Templ', correctionLabel: 'Nəyisə dəyişmək istəyirsiniz? Deyin:',
    correctionPlaceholder: 'məs. Əslində 6 gecə edin və büdcəni 3500 AZN-ə qaldırın.',
    correctionApply: 'Düzəlişi tətbiq et', changed: 'Yeniləndi', inspirationTitle: 'Məni ruhlandır', useDirection: 'Bu istiqaməti seç',
    directionActive: 'Hazırda səyahətinizi formalaşdırır', howChanged: 'Bu istiqamət səyahətinizi necə dəyişdi',
    returnToPrevious: 'Əvvəlki istiqamətə qayıt', journeyTitle: 'Səyahətiniz', journeySubtitle: 'AI tərəfindən hazırlanmış illüstrativ marşrut',
    editPrompt: 'Üçüncü günü daha sakit et və Bosfor gəmi gəzintisini axşama köçür.',
    applyEdit: 'Bu dəyişikliyi tətbiq et', whatChanged: 'Nə dəyişdi', showOriginal: 'Əvvəlkini göstər', showRevised: 'Yenilənmiş versiyanı göstər',
    routeLabel: 'İllüstrativ marşrut — canlı xəritə deyil', hotelCandidate: 'Otel namizədi', dining: 'Yerli yemək tövsiyəsi', notLiveLabel: 'İllüstrativdir — təsdiqlənmiş və ya canlı mövcudluq siyahısı deyil.',
    compareTitle: 'İstiqamətləri müqayisə et', selectDirection: 'Bu istiqaməti seç', selectedPlan: 'Seçilmiş plan',
    pace_field: 'Templ', hotelLevel: 'Otel səviyyəsi', included: 'Daxil olan təcrübələr', budgetRange: 'İllüstrativ büdcə aralığı (AZN)',
    flexibility: 'Çeviklik', serviceLevel: 'VOYARA xidmət səviyyəsi',
    accountabilityTitle: 'Sonra nə baş verir', aiPrepared: 'Bu səyahət söhbətinizə əsasən AI tərəfindən hazırlanıb.',
    reviewAvailable: 'Hər şey təsdiqlənməzdən əvvəl VOYARA insan nəzarəti mövcuddur.',
    approvalNeeded: 'Ödəniş və ya rezervasiya addımından əvvəl sizin təsdiqiniz tələb olunacaq.',
    noAuthority: 'Heç bir ödəniş, rezervasiya və ya təchizatçı təsdiqi edilməyib — bu, önizləmədir.',
    continuity: 'Təsdiqinizdən sonra VOYARA real prosesi ödəniş, rezervasiya və Trip Room vasitəsilə davam etdirir.'
  },
  ru: {
    bannerNotice: 'Демонстрация опыта — иллюстративный контент поездки',
    heading: 'Спросите VOYARA', send: 'Отправить', quickPromptsLabel: 'Попробуйте:',
    quick1: 'Я планирую поездку из Баку в Стамбул.', quick2: '5 ночей, 2 взрослых, в сентябре, бюджет 3000 AZN, культура и еда.',
    buildJourney: 'Создать мой маршрут', understandingTitle: 'Ваша поездка на данный момент',
    destination: 'Направление', nights: 'Ночей', travelers: 'Путешественников', month: 'Месяц', budget: 'Бюджет (иллюстративный)',
    interests: 'Интересы', pace: 'Темп', correctionLabel: 'Хотите что-то изменить? Просто скажите:',
    correctionPlaceholder: 'напр. Сделай 6 ночей и увеличь бюджет до 3500 AZN.',
    correctionApply: 'Применить изменение', changed: 'Обновлено', inspirationTitle: 'Вдохнови меня', useDirection: 'Использовать это направление',
    directionActive: 'Сейчас формирует ваш маршрут', howChanged: 'Как это направление изменило ваш маршрут',
    returnToPrevious: 'Вернуться к предыдущему направлению', journeyTitle: 'Ваш маршрут', journeySubtitle: 'Иллюстративный маршрут, подготовленный ИИ',
    editPrompt: 'Сделай день три более спокойным и перенеси прогулку по Босфору на вечер.',
    applyEdit: 'Применить это изменение', whatChanged: 'Что изменилось', showOriginal: 'Показать оригинал', showRevised: 'Показать обновлённую версию',
    routeLabel: 'Иллюстративный маршрут — не карта в реальном времени', hotelCandidate: 'Вариант отеля', dining: 'Рекомендация местного ресторана', notLiveLabel: 'Иллюстративно — не подтверждённый и не актуальный список наличия.',
    compareTitle: 'Сравнить направления', selectDirection: 'Выбрать это направление', selectedPlan: 'Выбранный план',
    pace_field: 'Темп', hotelLevel: 'Уровень отеля', included: 'Включённые впечатления', budgetRange: 'Иллюстративный диапазон бюджета (AZN)',
    flexibility: 'Гибкость', serviceLevel: 'Уровень сервиса VOYARA',
    accountabilityTitle: 'Что дальше', aiPrepared: 'Этот маршрут подготовлен ИИ на основе вашего разговора.',
    reviewAvailable: 'Перед окончательным утверждением доступна проверка командой VOYARA.',
    approvalNeeded: 'Перед любой оплатой или бронированием потребуется ваше одобрение.',
    noAuthority: 'Оплата, бронирование или подтверждение поставщика не производились — это демонстрация.',
    continuity: 'После вашего одобрения VOYARA продолжает реальный процесс через оплату, бронирование и ваш Trip Room.'
  }
};

const TIME_LABEL: Record<Locale, Record<'morning' | 'afternoon' | 'evening', string>> = {
  en: { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' },
  az: { morning: 'Səhər', afternoon: 'Günorta', evening: 'Axşam' },
  ru: { morning: 'Утро', afternoon: 'День', evening: 'Вечер' }
};

const DAY_LABEL_TEMPLATE: Record<Locale, string> = { en: 'Day {n}', az: 'Gün {n}', ru: 'День {n}' };

function briefField(value: string | number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined || value === '') return NOT_PROVIDED[locale];
  return String(value);
}

export function ExperiencePreviewWorkspace({ locale }: { locale: Locale }) {
  const t = LABELS[locale];
  const [turns, setTurns] = useState<ChatTurn[]>([{ speaker: 'voyara', text: locale === 'en' ? "Hi! Tell me about the trip you're dreaming of." : locale === 'az' ? 'Salam! Arzuladığınız səfər haqqında danışın.' : 'Привет! Расскажите о поездке, о которой вы мечтаете.' }]);
  const [brief, setBrief] = useState<TravelBriefState>(EMPTY_BRIEF);
  const [lastChangedFields, setLastChangedFields] = useState<string[]>([]);
  const [journeyBuilt, setJourneyBuilt] = useState(false);
  const [editApplied, setEditApplied] = useState(false);
  const [showingRevised, setShowingRevised] = useState(true);
  const [activeDirection, setActiveDirection] = useState<InspirationDirectionId | null>(null);
  const [previousDirection, setPreviousDirection] = useState<InspirationDirectionId | null>(null);
  const [selectedCompareId, setSelectedCompareId] = useState<CompareOption['id']>('balanced');

  const missing = nextMissingField(brief);
  const ready = isReadyToBuild(brief);
  const selectedCompare = COMPARE_OPTIONS.find((c) => c.id === selectedCompareId)!;

  const baseItinerary: ItineraryDay[] = activeDirection ? DIRECTION_ITINERARIES[activeDirection] : (editApplied && showingRevised ? REVISED_ITINERARY : ORIGINAL_ITINERARY);

  function sendMessage(text: string) {
    if (!text.trim()) return;
    const updated = extractFromMessage(text, brief);
    setBrief(updated);
    setTurns((prev) => [...prev, { speaker: 'customer', text }]);
    const nextField = nextMissingField(updated);
    const voyaraReply = nextField
      ? QUESTION_FOR_FIELD[nextField][locale]
      : (locale === 'en' ? 'Perfect — I have everything I need.' : locale === 'az' ? 'Əla — lazım olan hər şeyi əldə etdim.' : 'Отлично — у меня есть всё необходимое.');
    setTurns((prev) => [...prev, { speaker: 'voyara', text: voyaraReply }]);
  }

  function applyCorrectionText(text: string) {
    if (!text.trim()) return;
    const { brief: updated, changedFields } = applyCorrection(text, brief);
    setBrief(updated);
    setLastChangedFields(changedFields.map(String));
    setTurns((prev) => [...prev, { speaker: 'customer', text }]);
  }

  function selectDirection(id: InspirationDirectionId) {
    setPreviousDirection(activeDirection);
    setActiveDirection(id);
  }

  // E.2B.2A — preview mapper: converts local deterministic state into the
  // same neutral ConversationViewModel production AskVoyara will supply
  // from its own real parser/state. TravelConversationPresentation has no
  // idea this data came from a fixture engine rather than a real Travel
  // Request API — it only ever sees this typed view model and callbacks.
  const conversationModel: ConversationViewModel = {
    turns: turns.map((turn) => ({ speaker: turn.speaker === 'voyara' ? 'assistant' : 'customer', text: turn.text })),
    quickPrompts: [t.quick1, t.quick2],
    briefFields: [
      { key: 'destination', label: t.destination, value: brief.destination },
      { key: 'nights', label: t.nights, value: brief.nights ? String(brief.nights) : null },
      { key: 'travelers', label: t.travelers, value: brief.travelers ? String(brief.travelers) : null },
      { key: 'month', label: t.month, value: brief.month },
      { key: 'budget', label: t.budget, value: brief.budgetAzn ? `${brief.budgetAzn.toLocaleString()} AZN` : null },
      { key: 'interests', label: t.interests, value: brief.interests.length ? brief.interests.join(', ') : null },
      { key: 'pace', label: t.pace, value: brief.pace }
    ],
    missingFieldLabel: null,
    correctionSummary: lastChangedFields.length > 0 ? lastChangedFields.join(', ') : null,
    ready,
    evidence: 'illustrative',
    interactionMode: 'MULTI_TURN',
    quickPromptBehavior: 'SUBMIT_MESSAGE'
  };

  return (
    <div className="e2b-preview-workspace">
      <TravelConversationPresentation
        model={conversationModel}
        callbacks={{
          onSend: sendMessage,
          onCorrect: brief.destination ? applyCorrectionText : undefined,
          onBuild: ready && !journeyBuilt ? () => setJourneyBuilt(true) : undefined
        }}
        labels={{
          heading: t.heading, send: t.send, quickPromptsLabel: t.quickPromptsLabel, understandingTitle: t.understandingTitle,
          correctionLabel: t.correctionLabel, correctionPlaceholder: t.correctionPlaceholder, correctionApply: t.correctionApply,
          changed: t.changed, buildJourney: t.buildJourney, notProvidedLabel: NOT_PROVIDED[locale]
        }}
      />

      {journeyBuilt && (
        <>
          <section className="e2b-section">
            <h2>{t.inspirationTitle}</h2>
            <div className="e2b-inspiration-grid">
              {INSPIRATION_CARDS.map((card) => (
                <article key={card.id} className={`e2b-inspiration-card ${activeDirection === card.id ? 'is-active' : ''}`}>
                  <DestinationIllustration variant={card.id === 'classic-istanbul' ? 'skyline' : card.id === 'istanbul-through-food' ? 'bazaar' : 'bosphorus'} />
                  <h3>{card.title[locale]}</h3>
                  <p>{card.description[locale]}</p>
                  <p className="e2b-inspiration-meta">{card.style[locale]} · {card.duration[locale]}</p>
                  {activeDirection === card.id ? (
                    <p className="e2b-direction-active">{t.directionActive}</p>
                  ) : (
                    <button className="button button-tertiary" type="button" onClick={() => selectDirection(card.id as InspirationDirectionId)}>{t.useDirection}</button>
                  )}
                </article>
              ))}
            </div>
            {activeDirection && (
              <div className="e2b-direction-summary">
                <p><strong>{t.howChanged}:</strong> {DIRECTION_SUMMARY[activeDirection][locale]}</p>
                {previousDirection !== null && (
                  <button className="button button-tertiary" onClick={() => { setActiveDirection(previousDirection); setPreviousDirection(null); }}>{t.returnToPrevious}</button>
                )}
              </div>
            )}
          </section>

          <JourneyCanvasPresentation
            model={{
              heading: t.journeyTitle,
              summary: '',
              destinationSequence: [TRAVEL_BRIEF.origin[locale], TRAVEL_BRIEF.destination[locale]],
              routeLabel: t.routeLabel,
              selectedDirectionLabel: activeDirection ? INSPIRATION_CARDS.find((c) => c.id === activeDirection)?.title[locale] ?? null : null,
              selectedOptionLabel: selectedCompare.label[locale],
              days: baseItinerary.map((day) => ({
                day: day.day, theme: day.theme[locale],
                activities: day.activities.map((a) => ({ time: a.time, title: a.title[locale] }))
              })),
              hotelCandidate: {
                title: `${selectedCompare.hotelLevel[locale]} · ${locale === 'en' ? 'Bosphorus-area boutique property' : locale === 'az' ? 'Bosfor ərazisində butik mülkiyyət' : 'Бутик-отель в районе Босфора'}`,
                neighborhood: locale === 'en' ? 'Neighborhood: Beşiktaş' : locale === 'az' ? 'Məhəllə: Beşiktaş' : 'Район: Бешикташ',
                reason: locale === 'en' ? `Fits your ${selectedCompare.pace[locale].toLowerCase()} pace and ${selectedCompare.serviceLevel[locale].toLowerCase()} service level.` : locale === 'az' ? `${selectedCompare.pace[locale]} templinizə və ${selectedCompare.serviceLevel[locale]} xidmət səviyyənizə uyğundur.` : `Соответствует вашему темпу «${selectedCompare.pace[locale]}» и уровню сервиса «${selectedCompare.serviceLevel[locale]}».`,
                evidence: 'illustrative'
              },
              diningCandidate: {
                title: locale === 'en' ? 'Meyhane-style tavern' : locale === 'az' ? 'Meyxana üslublu restoran' : 'Ресторан в стиле мейхане',
                neighborhood: locale === 'en' ? 'Neighborhood: Kadıköy' : locale === 'az' ? 'Məhəllə: Kadıköy' : 'Район: Кадыкёй',
                reason: locale === 'en' ? 'A local favorite for an authentic evening, matching your interest in food.' : locale === 'az' ? 'Yemək marağınıza uyğun, orijinal axşam üçün yerli sevimli.' : 'Местный фаворит для аутентичного вечера, соответствует вашему интересу к еде.',
                evidence: 'illustrative'
              },
              experienceCards: (['morning', 'afternoon', 'evening'] as const).map((slot) => ({
                title: TIME_LABEL[locale][slot],
                neighborhood: locale === 'en' ? '~2–3 hrs · Sultanahmet' : locale === 'az' ? '~2–3 saat · Sultanahmet' : '~2–3 ч · Султанахмет',
                evidence: 'illustrative' as const
              })),
              compareOptions: COMPARE_OPTIONS.map((option) => ({
                id: option.id, label: option.label[locale], pace: option.pace[locale], hotelLevel: option.hotelLevel[locale],
                includedExperiences: option.includedExperiences[locale], budgetRangeLabel: option.illustrativeBudgetRangeAzn,
                flexibility: option.flexibility[locale], serviceLevel: option.serviceLevel[locale], selected: option.id === selectedCompareId
              })),
              versionLabel: null,
              whatChanged: editApplied ? WHAT_CHANGED[locale] : null,
              evidenceMode: 'ILLUSTRATIVE'
            }}
            callbacks={{
              onSelectOption: (id: string) => setSelectedCompareId(id as CompareOption['id']),
              onApplyEdit: !editApplied ? () => setEditApplied(true) : undefined,
              onToggleVersion: editApplied ? () => setShowingRevised((v) => !v) : undefined
            }}
            labels={{
              journeySubtitle: t.journeySubtitle, hotelCandidate: t.hotelCandidate, dining: t.dining, notLiveLabel: t.notLiveLabel,
              whatChanged: t.whatChanged, applyEdit: t.applyEdit, showOriginal: t.showOriginal, showRevised: t.showRevised, showingRevised,
              compareTitle: t.compareTitle, selectDirection: t.selectDirection, selectedPlan: t.selectedPlan,
              pace: t.pace_field, hotelLevel: t.hotelLevel, included: t.included, budgetRange: t.budgetRange,
              flexibility: t.flexibility, serviceLevel: t.serviceLevel, timeLabels: TIME_LABEL[locale], dayLabelTemplate: DAY_LABEL_TEMPLATE[locale],
              liveLabel: locale === 'en' ? 'Live evidence' : locale === 'az' ? 'Canlı sübut' : 'Актуальные данные',
              illustrativeLabel: locale === 'en' ? 'Illustrative preview' : locale === 'az' ? 'İllüstrativ önizləmə' : 'Иллюстративный просмотр',
              editPromptText: t.editPrompt
            }}
          />

          <section className="e2b-section e2b-accountability">
            <h2>{t.accountabilityTitle}</h2>
            <ul>
              <li>{t.aiPrepared}</li>
              <li>{t.reviewAvailable}</li>
              <li>{t.approvalNeeded}</li>
              <li>{t.noAuthority}</li>
              <li>{t.continuity}</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
