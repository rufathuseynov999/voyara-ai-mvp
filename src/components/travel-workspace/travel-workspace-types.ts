/**
 * E.2B.2A — neutral presentation view-model types. This module has ZERO
 * imports from Supabase, any admin client, or any domain/operational
 * code. Both production mappers (deriving these from real
 * Proposal/payment/booking objects) and the preview mapper (deriving
 * these from explicitly-labelled deterministic fixtures) produce the
 * exact same shapes — the shared presentation components below only ever
 * see these types, never a raw domain object.
 */

export type EvidenceClassification = 'live' | 'illustrative';

/* ---------------------------- Conversation ---------------------------- */

export type ConversationChatTurn = { speaker: 'customer' | 'assistant'; text: string };

export type ConversationInteractionMode = 'COMPOSE_CONFIRM' | 'MULTI_TURN';
export type QuickPromptBehavior = 'FILL_DRAFT' | 'SUBMIT_MESSAGE';

export type ConversationViewModel = {
  turns: ConversationChatTurn[];
  quickPrompts: string[];
  briefFields: Array<{ key: string; label: string; value: string | null }>;
  missingFieldLabel: string | null;
  correctionSummary: string | null;
  ready: boolean;
  evidence: EvidenceClassification;
  interactionMode: ConversationInteractionMode;
  quickPromptBehavior: QuickPromptBehavior;
};

export type ConversationCallbacks = {
  onSend: (text: string) => void;
  onCorrect?: (text: string) => void;
  onBuild?: () => void;
  /** Used only when quickPromptBehavior is FILL_DRAFT — fills the
   *  composer without submitting. Production AskVoyara's chips have
   *  always worked this way; this callback preserves that exact
   *  behavior rather than forcing chips through onSend. */
  onQuickPromptFill?: (text: string) => void;
};

/* ---------------------------- Journey Canvas ---------------------------- */

export type ItineraryActivityView = { time: 'morning' | 'afternoon' | 'evening'; title: string; neighborhood?: string };
export type ItineraryDayView = { day: number; theme: string; activities: ItineraryActivityView[] };

export type CardView = {
  title: string;
  subtitle?: string;
  neighborhood?: string;
  reason?: string;
  evidence: EvidenceClassification;
} | null;

/* ---------------------------- Authority ---------------------------- */

export type JourneyAuthorityViewModel = {
  preparedByLabel: string;
  voyaraResponsibilityLabel: string;
  customerResponsibilityLabel: string;
  currentStatusLabel: string;
  nextActionLabel: string;
  nextActionHref?: string;
  evidence: EvidenceClassification;
};

/* ---------------------------- Journey Canvas (E.2B.2B extension) ---------------------------- */

export type JourneyEvidenceMode = 'LIVE' | 'ILLUSTRATIVE';

export type JourneyOptionViewModel = {
  id: string;
  label: string;
  pace?: string;
  hotelLevel?: string;
  includedExperiences?: string;
  budgetRangeLabel?: string;
  flexibility?: string;
  serviceLevel?: string;
  selected: boolean;
};

export type JourneyDayViewModel = ItineraryDayView;
export type JourneyItemViewModel = CardView;

export type JourneyCanvasViewModel = {
  heading: string;
  summary: string;
  destinationSequence: string[];
  routeLabel: string | null;
  selectedDirectionLabel: string | null;
  selectedOptionLabel: string | null;
  days?: JourneyDayViewModel[];
  hotelCandidate?: JourneyItemViewModel;
  diningCandidate?: JourneyItemViewModel;
  experienceCards?: JourneyItemViewModel[];
  compareOptions?: JourneyOptionViewModel[];
  versionLabel: string | null;
  whatChanged: string | null;
  evidenceMode: JourneyEvidenceMode;
};

export type JourneyCanvasCallbacks = {
  onSelectDirection?: (id: string) => void;
  onSelectOption?: (id: string) => void;
  onApplyEdit?: () => void;
  onToggleVersion?: () => void;
};
