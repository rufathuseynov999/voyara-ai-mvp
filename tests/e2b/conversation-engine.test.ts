import assert from 'node:assert/strict';
import test from 'node:test';
import { extractFromMessage, nextMissingField, isReadyToBuild, applyCorrection, EMPTY_BRIEF } from '@/lib/e2b-conversation-engine';

test('extracts origin and destination from a real message', () => {
  const brief = extractFromMessage("Hi, I'm planning a trip from Baku to Istanbul.", EMPTY_BRIEF);
  assert.equal(brief.origin, 'Baku');
  assert.equal(brief.destination, 'Istanbul');
  assert.equal(brief.nights, null, 'nights not mentioned yet, must remain null');
});

test('extracts nights and travelers from a follow-up message', () => {
  const first = extractFromMessage('trip to Istanbul', EMPTY_BRIEF);
  const second = extractFromMessage('5 nights, 2 adults, sometime in September.', first);
  assert.equal(second.nights, 5);
  assert.equal(second.travelers, 2);
  assert.equal(second.month, 'September');
});

test('extracts budget and interests, and pace keyword', () => {
  const brief = extractFromMessage('Around 3000 AZN. I love culture, food, and the Bosphorus — but a relaxed pace.', EMPTY_BRIEF);
  assert.equal(brief.budgetAzn, 3000);
  assert.ok(brief.interests.includes('culture'));
  assert.ok(brief.interests.includes('food'));
  assert.ok(brief.interests.includes('bosphorus'));
  assert.equal(brief.pace, 'relaxed');
});

test('nextMissingField asks in priority order, and returns null only once all required fields exist', () => {
  assert.equal(nextMissingField(EMPTY_BRIEF), 'destination');
  const withDest = extractFromMessage('Istanbul', EMPTY_BRIEF);
  assert.equal(nextMissingField(withDest), 'nights');
  const withNights = extractFromMessage('5 nights', withDest);
  assert.equal(nextMissingField(withNights), 'travelers');
  const withTravelers = extractFromMessage('2 adults', withNights);
  assert.equal(nextMissingField(withTravelers), 'budgetAzn');
  const withBudget = extractFromMessage('3000 AZN', withTravelers);
  assert.equal(nextMissingField(withBudget), null);
});

test('isReadyToBuild is false until destination/nights/travelers/budget all exist, then true', () => {
  assert.equal(isReadyToBuild(EMPTY_BRIEF), false);
  let brief = extractFromMessage('Istanbul, 5 nights, 2 adults', EMPTY_BRIEF);
  assert.equal(isReadyToBuild(brief), false, 'budget still missing');
  brief = extractFromMessage('budget 3000 AZN', brief);
  assert.equal(isReadyToBuild(brief), true);
});

test('a correction overwrites only the mentioned field, leaving everything else intact', () => {
  const original = extractFromMessage('Istanbul, 5 nights, 2 adults, 3000 AZN', EMPTY_BRIEF);
  const { brief, changedFields } = applyCorrection('Actually, make it 6 nights and increase the budget to 3500 AZN.', original);
  assert.equal(brief.nights, 6);
  assert.equal(brief.budgetAzn, 3500);
  assert.equal(brief.destination, 'Istanbul', 'destination unchanged by this correction');
  assert.equal(brief.travelers, 2, 'travelers unchanged by this correction');
  assert.deepEqual(new Set(changedFields), new Set(['nights', 'budgetAzn']));
});

test('a correction with no new information reports zero changed fields', () => {
  const original = extractFromMessage('Istanbul, 5 nights', EMPTY_BRIEF);
  const { changedFields } = applyCorrection('hello there', original);
  assert.deepEqual(changedFields, []);
});

test('extraction is idempotent — parsing the same message twice never produces different results', () => {
  const once = extractFromMessage('Istanbul, 5 nights, 2 adults, 3000 AZN', EMPTY_BRIEF);
  const twice = extractFromMessage('Istanbul, 5 nights, 2 adults, 3000 AZN', once);
  assert.deepEqual(once, twice);
});

/* -------------------- E.2B.2 correctness hardening -------------------- */

test('zero or negative nights are rejected, not silently accepted', () => {
  const zero = extractFromMessage('0 nights in Istanbul', EMPTY_BRIEF);
  assert.equal(zero.nights, null);
  const negative = extractFromMessage('-3 nights in Istanbul', EMPTY_BRIEF);
  assert.equal(negative.nights, null);
});

test('an implausible nights count (e.g. 400) is rejected', () => {
  const brief = extractFromMessage('400 nights in Istanbul', EMPTY_BRIEF);
  assert.equal(brief.nights, null);
});

test('an unrealistic traveler count is rejected', () => {
  const brief = extractFromMessage('9999 adults', EMPTY_BRIEF);
  assert.equal(brief.travelers, null);
});

test('a malformed budget string does not produce a fabricated number', () => {
  const brief = extractFromMessage('budget azn', EMPTY_BRIEF); // no digits at all
  assert.equal(brief.budgetAzn, null);
});

test('an implausibly tiny budget is rejected as malformed rather than accepted at face value', () => {
  const brief = extractFromMessage('5 AZN budget', EMPTY_BRIEF);
  assert.equal(brief.budgetAzn, null);
});

test('correcting one field never contaminates an unrelated already-set field', () => {
  const original = extractFromMessage('Istanbul, 5 nights, 2 adults, 3000 AZN, culture', EMPTY_BRIEF);
  const { brief } = applyCorrection('Make it 7 nights.', original);
  assert.equal(brief.nights, 7);
  assert.equal(brief.travelers, 2);
  assert.equal(brief.budgetAzn, 3000);
  assert.deepEqual(brief.interests, ['culture']);
});

test('locale-specific AZ month recognition works (sentyabr)', () => {
  const brief = extractFromMessage('Sentyabr ayında İstanbula gedirəm', EMPTY_BRIEF);
  assert.equal(brief.month, 'September');
});

test('locale-specific RU month recognition works (сентябрь)', () => {
  const brief = extractFromMessage('Я еду в сентябре', EMPTY_BRIEF);
  assert.equal(brief.month, 'September');
});

test('a word that merely resembles a month abbreviation does not false-match (word-boundary safety)', () => {
  const brief = extractFromMessage('It makes sense to go somewhere warm.', EMPTY_BRIEF);
  assert.equal(brief.month, null, '"sense" must not false-match the AZ "sen" (September) abbreviation');
});

test('an unsupported destination fails safely — destination stays null rather than guessing', () => {
  const brief = extractFromMessage('I want to visit Tokyo.', EMPTY_BRIEF);
  assert.equal(brief.destination, null);
  assert.equal(nextMissingField(brief), 'destination', 'still correctly asks for destination rather than assuming one');
});

test('readiness never becomes true from malformed input alone', () => {
  const brief = extractFromMessage('Istanbul, 0 nights, 9999 adults, budget azn', EMPTY_BRIEF);
  assert.equal(isReadyToBuild(brief), false, 'nights/travelers/budget were all rejected as malformed, so readiness must remain false');
});
