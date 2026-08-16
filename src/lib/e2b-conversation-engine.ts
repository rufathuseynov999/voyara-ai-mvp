/**
 * E.2B.2 — pure deterministic extraction/correction engine for the
 * customer Experience Proof preview. No network calls, no LLM. Every
 * function here is pure and independently testable.
 */

export type Locale = 'az' | 'ru' | 'en';

export type TravelBriefState = {
  origin: string | null;
  destination: string | null;
  month: string | null;
  nights: number | null;
  travelers: number | null;
  budgetAzn: number | null;
  interests: string[];
  pace: 'relaxed' | 'balanced' | 'fast' | null;
};

export const EMPTY_BRIEF: TravelBriefState = {
  origin: null, destination: null, month: null, nights: null, travelers: null, budgetAzn: null, interests: [], pace: null
};

const MONTHS: Record<string, string[]> = {
  September: ['september', 'sentyabr', 'сентябр', 'sen'],
  October: ['october', 'oktyabr', 'октябр'],
  November: ['november', 'noyabr', 'ноябр'],
  December: ['december', 'dekabr', 'декабр'],
  January: ['january', 'yanvar', 'январ'],
  August: ['august', 'avqust', 'август']
};

const DESTINATIONS = ['istanbul', 'i̇stanbul', 'stanbul', 'stambul', 'стамбул'];
const ORIGINS = ['baku', 'baki', 'bakı', 'баку'];

const INTEREST_KEYWORDS: Record<string, string[]> = {
  culture: ['culture', 'mədəniyyət', 'medeniyyet', 'культура', 'history', 'tarix', 'история'],
  food: ['food', 'yemək', 'yemek', 'еда', 'gastronomy', 'qastronomiya', 'гастрономия', 'cuisine'],
  bosphorus: ['bosphorus', 'bosfor', 'босфор'],
  relaxation: ['relax', 'istirahət', 'istirahet', 'отдых', 'spa', 'wellness']
};

/** Extracts (or merges) travel-brief fields from one free-text message. */
export function extractFromMessage(text: string, previous: TravelBriefState): TravelBriefState {
  const lower = text.toLowerCase();
  const next: TravelBriefState = { ...previous, interests: [...previous.interests] };

  if (ORIGINS.some((o) => lower.includes(o))) next.origin = 'Baku';
  if (DESTINATIONS.some((d) => lower.includes(d))) next.destination = 'Istanbul';

  for (const [canonical, keywords] of Object.entries(MONTHS)) {
    // Word-boundary match only — a short keyword like 'sen' (September,
    // AZ abbreviation) must not false-match inside an unrelated word like
    // "sense" or "sending". Plain \b is ASCII-only in JavaScript and
    // silently fails to bound Cyrillic text correctly, so this uses
    // explicit \p{L}/\p{N} lookarounds (with the /u flag) instead, which
    // work correctly across Latin and Cyrillic scripts alike.
    if (keywords.some((k) => {
      const suffixSlack = k.length >= 6 ? '[\\p{L}]{0,4}' : '';
      return new RegExp(`(?<![\\p{L}\\p{N}])${k}${suffixSlack}(?![\\p{L}\\p{N}])`, 'iu').test(lower);
    })) { next.month = canonical; break; }
  }

  const nightsMatch = lower.match(/(-?\d+)\s*(night|gecə|gece|ноч)/);
  if (nightsMatch) {
    const value = Number(nightsMatch[1]);
    // Reject zero/negative/implausible values rather than accepting them
    // at face value — a "0 nights" or "400 nights" trip is not a real
    // extracted fact, it's malformed input, and must not silently pass
    // through into a field that later reads as "understood."
    if (Number.isFinite(value) && value > 0 && value <= 60) next.nights = value;
  }

  const travelersMatch = lower.match(/(\d+)\s*(adult|nəfər|nefer|взросл|traveler|человек)/);
  if (travelersMatch) {
    const value = Number(travelersMatch[1]);
    if (Number.isFinite(value) && value > 0 && value <= 20) next.travelers = value;
  }

  const budgetMatch = lower.match(/(\d[\d,\s]{2,})\s*(azn|₼|манат)/) ?? lower.match(/budget[^\d]{0,10}(\d[\d,\s]{2,})/);
  if (budgetMatch) {
    const cleaned = budgetMatch[1].replace(/[,\s]/g, '');
    const value = Number(cleaned);
    // Malformed strings like "3,,00" or a stray decimal produce NaN or an
    // implausible figure — never accepted as a real budget.
    if (Number.isFinite(value) && value >= 100 && value <= 1_000_000) next.budgetAzn = value;
  }

  for (const [interest, keywords] of Object.entries(INTEREST_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k)) && !next.interests.includes(interest)) next.interests.push(interest);
  }

  if (/relax|sakit|спокой/.test(lower)) next.pace = 'relaxed';
  else if (/fast|sürətli|surətli|быстр/.test(lower)) next.pace = 'fast';

  return next;
}

/** Which required field is still missing, in priority order — drives VOYARA's next question. Null once all required fields exist. */
export type RequiredField = 'destination' | 'nights' | 'travelers' | 'budgetAzn';
const REQUIRED_ORDER: RequiredField[] = ['destination', 'nights', 'travelers', 'budgetAzn'];

export function nextMissingField(brief: TravelBriefState): RequiredField | null {
  for (const field of REQUIRED_ORDER) {
    if (brief[field] === null) return field;
  }
  return null;
}

export function isReadyToBuild(brief: TravelBriefState): boolean {
  return nextMissingField(brief) === null;
}

/** A correction re-parses the message the same way a new message would —
 *  extraction is idempotent and merge-based, so "actually make it 6
 *  nights" naturally overwrites only the nights field. This function also
 *  returns a human-readable list of which fields actually changed, for
 *  the "what changed" UI. */
export function applyCorrection(text: string, previous: TravelBriefState): { brief: TravelBriefState; changedFields: (keyof TravelBriefState)[] } {
  const brief = extractFromMessage(text, previous);
  const changedFields = (Object.keys(brief) as (keyof TravelBriefState)[]).filter((key) => {
    if (key === 'interests') return JSON.stringify(brief.interests) !== JSON.stringify(previous.interests);
    return brief[key] !== previous[key];
  });
  return { brief, changedFields };
}
