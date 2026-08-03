import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreLeadExplainably, LEAD_SCORING_MAX_POSSIBLE_SCORE, type LeadScoringInput } from '@/server/agents/automation/lead-scoring';

function noFactors(): LeadScoringInput {
  return {
    hasCompleteContactInfo: false, hasStatedBudgetRange: false, hasStatedTravelDates: false, hasRespondedToOutreach: false,
    isReturningCustomer: false, hasActiveSubscription: false, isCorporateAccount: false, engagedWithinLast48Hours: false
  };
}

test('a lead with no factors present scores 0 with an honest explanation', () => {
  const result = scoreLeadExplainably(noFactors());
  assert.equal(result.score, 0);
  assert.ok(result.explanation.includes('no scoring factors are present'));
});

test('every factor carries its own explicit weight and explanation, never a black-box contribution', () => {
  const result = scoreLeadExplainably(noFactors());
  for (const factor of result.factors) {
    assert.ok(factor.factorCode.length > 0);
    assert.ok(factor.weight > 0);
    assert.ok(factor.explanation.length > 0);
  }
});

test('present factors are reflected in both the score and the written explanation', () => {
  const input = noFactors();
  input.hasCompleteContactInfo = true;
  input.isReturningCustomer = true;
  const result = scoreLeadExplainably(input);
  assert.equal(result.score, 30);
  assert.ok(result.explanation.includes('complete, verifiable contact information'));
  assert.ok(result.explanation.includes('booked with VOYARA before'));
});

test('a lead with every factor present scores exactly the maximum possible score, never more', () => {
  const allTrue: LeadScoringInput = {
    hasCompleteContactInfo: true, hasStatedBudgetRange: true, hasStatedTravelDates: true, hasRespondedToOutreach: true,
    isReturningCustomer: true, hasActiveSubscription: true, isCorporateAccount: true, engagedWithinLast48Hours: true
  };
  const result = scoreLeadExplainably(allTrue);
  assert.equal(result.score, LEAD_SCORING_MAX_POSSIBLE_SCORE);
  assert.equal(result.score, 100);
});

test('the explanation names exactly the present factors and honestly counts the absent ones', () => {
  const input = noFactors();
  input.hasStatedBudgetRange = true;
  const result = scoreLeadExplainably(input);
  assert.ok(result.explanation.includes('7 of 8 factors not yet present'));
});

test('the LeadScoreResult shape has no field for conversion probability, CLV, expected revenue, or any financial value', () => {
  const result = scoreLeadExplainably(noFactors());
  const keys = Object.keys(result);
  assert.deepEqual(keys.sort(), ['explanation', 'factors', 'score']);
  const resultString = JSON.stringify(result).toLowerCase();
  assert.ok(!/probability|lifetime.?value|expected.?revenue|financial.?value|\bclv\b/i.test(resultString));
});

test('no function anywhere in lead-scoring.ts computes or returns a conversion probability, CLV, expected revenue, or booking likelihood', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/lead-scoring.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/function\s+\w*(probability|lifetimeValue|expectedRevenue|bookingLikelihood)/i.test(codeOnly));
  assert.ok(!/:\s*\w*(probability|lifetimeValue|expectedRevenue|bookingLikelihood)/i.test(codeOnly));
});

test('the score is always an ordinal integer between 0 and 100, never a fractional probability-shaped value', () => {
  const result = scoreLeadExplainably(noFactors());
  assert.ok(Number.isInteger(result.score));
  assert.ok(result.score >= 0 && result.score <= 100);
});
