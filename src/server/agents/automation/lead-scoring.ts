/**
 * Phase 4G — explainable lead scoring.
 *
 * `scoreLeadExplainably` is the ONLY lead-scoring function in this
 * codebase, and it structurally cannot return a conversion probability,
 * customer lifetime value, expected revenue, booking probability, or any
 * other financial value — the return type has no field for any of these,
 * and the function computes nothing of the kind internally. It returns an
 * ordinal SCORE (0-100) built from named, weighted factors, each with its
 * own point contribution and a one-line explanation — so "why did this
 * lead score 62" always has a real, inspectable answer, never a black-box
 * number.
 */

export type LeadScoringFactor = {
  factorCode: string;
  present: boolean;
  weight: number;
  explanation: string;
};

export type LeadScoreResult = {
  score: number;
  factors: LeadScoringFactor[];
  explanation: string;
};

export type LeadScoringInput = {
  hasCompleteContactInfo: boolean;
  hasStatedBudgetRange: boolean;
  hasStatedTravelDates: boolean;
  hasRespondedToOutreach: boolean;
  isReturningCustomer: boolean;
  hasActiveSubscription: boolean;
  isCorporateAccount: boolean;
  engagedWithinLast48Hours: boolean;
};

const LEAD_SCORING_FACTORS: Array<{ code: string; weight: number; explanation: string; check: (i: LeadScoringInput) => boolean }> = [
  { code: 'COMPLETE_CONTACT_INFO', weight: 15, explanation: 'Customer provided complete, verifiable contact information.', check: (i) => i.hasCompleteContactInfo },
  { code: 'STATED_BUDGET_RANGE', weight: 15, explanation: 'Customer stated a budget range for the trip.', check: (i) => i.hasStatedBudgetRange },
  { code: 'STATED_TRAVEL_DATES', weight: 15, explanation: 'Customer stated specific or approximate travel dates.', check: (i) => i.hasStatedTravelDates },
  { code: 'RESPONDED_TO_OUTREACH', weight: 15, explanation: 'Customer responded to a prior outreach message.', check: (i) => i.hasRespondedToOutreach },
  { code: 'RETURNING_CUSTOMER', weight: 15, explanation: 'Customer has booked with VOYARA before.', check: (i) => i.isReturningCustomer },
  { code: 'ACTIVE_SUBSCRIPTION', weight: 10, explanation: 'Customer holds an active VOYARA membership.', check: (i) => i.hasActiveSubscription },
  { code: 'CORPORATE_ACCOUNT', weight: 10, explanation: 'Lead originates from a corporate account.', check: (i) => i.isCorporateAccount },
  { code: 'RECENT_ENGAGEMENT', weight: 5, explanation: 'Customer engaged within the last 48 hours.', check: (i) => i.engagedWithinLast48Hours }
];

export function scoreLeadExplainably(input: LeadScoringInput): LeadScoreResult {
  const factors: LeadScoringFactor[] = LEAD_SCORING_FACTORS.map((f) => ({
    factorCode: f.code, present: f.check(input), weight: f.weight, explanation: f.explanation
  }));
  const score = factors.filter((f) => f.present).reduce((sum, f) => sum + f.weight, 0);

  const presentFactors = factors.filter((f) => f.present).map((f) => f.explanation);
  const absentCount = factors.length - presentFactors.length;
  const explanation = presentFactors.length > 0
    ? `Score ${score}/100 based on: ${presentFactors.join(' ')} (${absentCount} of ${factors.length} factors not yet present.)`
    : `Score ${score}/100 — no scoring factors are present yet.`;

  return { score, factors, explanation };
}

export const LEAD_SCORING_MAX_POSSIBLE_SCORE = LEAD_SCORING_FACTORS.reduce((sum, f) => sum + f.weight, 0);
