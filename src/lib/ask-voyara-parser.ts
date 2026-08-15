/**
 * UX2 — Ask VOYARA deterministic intent parser.
 *
 * A pure function, deliberately dependency-free (no DOM, no React, no
 * server-only imports) so it can be:
 *   1. unit-tested directly via node:test without a browser or hydration
 *      (see tests/ux2/ask-voyara-parser.test.ts), and
 *   2. imported unchanged by the client component (src/components/ask-voyara.tsx),
 *      so there is exactly one parsing implementation, not a duplicate.
 *
 * HONEST SCOPE — this is NOT a multilingual NLP parser. Coverage is uneven
 * by design, and that unevenness is intentional rather than hidden:
 *   - nights / travellers count / currency symbols: recognise some
 *     Azerbaijani and Russian keyword forms alongside English
 *     (e.g. "gecə"/"ноч" for nights, "nəfər"/"человек" for people,
 *     "həyat yoldaşım"/"жена" for a partner implying 2 travellers,
 *     "ailə"/"семья" for a family implying 4).
 *   - month names and destination extraction: English-only. The month
 *     dictionary only has English month names, and the destination regex
 *     only matches English prepositions ("in", "to", "near", "around").
 *     An Azerbaijani or Russian sentence will still get whatever
 *     nights/travellers/budget signal it contains, but will not have its
 *     month or destination detected. The UI does not claim otherwise: the
 *     parsed-fields panel always shows "not detected" for anything the
 *     parser did not find, in the customer's own locale, rather than
 *     silently guessing.
 *
 * This never bypasses the Human Approval Gate or the authoritative Travel
 * Request pipeline: the parsed result only ever becomes a
 * `travel_request.save_draft` command through the same
 * `/api/v1/travel-requests` endpoint and contract the 60-second Wizard
 * uses, and the customer still finishes in that structured Wizard where
 * the existing accuracy/data-processing acknowledgements are captured
 * before anything is submitted.
 */

export type ParsedIntent = {
  destination: string | null;
  departureDate: string | null;
  returnDate: string | null;
  nights: number | null;
  adults: number | null;
  budgetAzn: number | null;
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

export function parseIntent(text: string, referenceDate: Date = new Date()): ParsedIntent {
  const lower = text.toLowerCase();

  const nightsMatch = lower.match(/(\d{1,2})\s*(?:night|nights|gec[əe]|ноч)/);
  const nights = nightsMatch ? Number(nightsMatch[1]) : null;

  const adultsMatch = lower.match(/(\d{1,2})\s*(?:adults?|people|travellers?|travelers?|nəfər|человек)/);
  let adults: number | null = adultsMatch ? Number(adultsMatch[1]) : null;
  if (!adults && /\bwife\b|\bhusband\b|\bpartner\b|\bhəyat yoldaşım\b|\bжен[а-я]*\b/.test(lower)) adults = 2;
  if (!adults && /\bfamily\b|\bailə\b|\bсемь/.test(lower)) adults = 4;

  const budgetMatch = lower.match(/(?:[€$₼£]|azn|usd|eur)\s?([\d.,]{3,7})|([\d.,]{3,7})\s?(?:[€$₼£]|azn|usd|eur|manat)/);
  let budgetAzn: number | null = null;
  if (budgetMatch) {
    const raw = (budgetMatch[1] ?? budgetMatch[2] ?? '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
    const value = Number(raw);
    if (!Number.isNaN(value) && value > 0) budgetAzn = Math.round(value);
  }

  let monthIndex: number | null = null;
  for (const [name, index] of Object.entries(MONTHS)) {
    if (lower.includes(name)) {
      monthIndex = index;
      break;
    }
  }

  let departureDate: string | null = null;
  let returnDate: string | null = null;
  if (monthIndex !== null) {
    let year = referenceDate.getFullYear();
    if (monthIndex < referenceDate.getMonth()) year += 1;
    const start = new Date(Date.UTC(year, monthIndex, 15));
    departureDate = start.toISOString().slice(0, 10);
    if (nights) {
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + nights);
      returnDate = end.toISOString().slice(0, 10);
    }
  }

  const destinationMatch = text.match(/\b(?:in|to|near|around)\s+([A-ZƏÖÜİĞÇŞ][\p{L}\s]{2,28}?)(?:\s+(?:with|for|in|on|around|next|this)\b|[.,!?]|$)/u);
  const destination = destinationMatch ? destinationMatch[1].trim() : null;

  return { destination, departureDate, returnDate, nights, adults, budgetAzn };
}
