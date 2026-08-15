import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIntent } from '@/lib/ask-voyara-parser';

/**
 * UX2 — Ask VOYARA deterministic parser tests.
 *
 * This exercises the exact pure function the client component imports
 * (src/lib/ask-voyara-parser.ts), so these results are what the customer
 * actually sees — not a reimplementation that could drift from production
 * behaviour. It intentionally proves the parser's real, honestly-scoped
 * coverage rather than assuming full multilingual support: month/date and
 * destination extraction are English-only by design; nights, traveller
 * count and budget recognise some Azerbaijani and Russian keyword forms
 * too. See the module docstring for the exact breakdown.
 */

const REFERENCE_DATE = new Date('2026-01-15T00:00:00Z');

test('parses destination, month, nights and budget from a full English sentence', () => {
  const result = parseIntent(
    '5 nights in Lake Como with my wife in September around €4500',
    REFERENCE_DATE
  );
  assert.equal(result.destination, 'Lake Como');
  assert.equal(result.nights, 5);
  assert.equal(result.adults, 2); // "wife" implies 2 travellers
  assert.equal(result.budgetAzn, 4500);
  assert.equal(result.departureDate, '2026-09-15');
  assert.equal(result.returnDate, '2026-09-20');
});

test('does not recognise spelled-out numbers, only digit forms (honest limitation)', () => {
  // "Five nights" (spelled out) is not matched by the nights regex, which
  // requires digits. This is real parser behaviour, not a test artifact —
  // the UI shows "not detected" for nights here rather than guessing.
  const result = parseIntent('Five nights in Lakeland', REFERENCE_DATE);
  assert.equal(result.nights, null);
  assert.equal(result.destination, 'Lakeland');
});

test('rolls the year forward when the named month has already passed this year', () => {
  // Reference date is January 2026; "March" is still ahead this year.
  const aheadThisYear = parseIntent('A trip in March', REFERENCE_DATE);
  assert.equal(aheadThisYear.departureDate, '2026-03-15');

  // Reference date is deliberately set after the named month to prove the
  // rollover, rather than relying on the real system clock at test time.
  const afterReference = new Date('2026-11-01T00:00:00Z');
  const rolledOver = parseIntent('A trip in March', afterReference);
  assert.equal(rolledOver.departureDate, '2027-03-15');
});

test('recognises Azerbaijani nights and traveller keywords (honest partial coverage)', () => {
  const result = parseIntent('Sentyabrda 5 gecə, 2 nəfər, ailəvi səyahət', REFERENCE_DATE);
  assert.equal(result.nights, 5);
  assert.equal(result.adults, 2);
  // Month/date and destination are English-only by design — an
  // Azerbaijani month name is correctly NOT detected, not silently
  // guessed. This is the documented, honest limitation, verified here
  // rather than asserted away.
  assert.equal(result.departureDate, null);
  assert.equal(result.destination, null);
});

test('recognises Russian nights and traveller keywords (honest partial coverage)', () => {
  const result = parseIntent('5 ночей, 2 человека, семейная поездка', REFERENCE_DATE);
  assert.equal(result.nights, 5);
  // "человека" (2 people) is matched before the "семь…" (family -> 4)
  // fallback ever runs, exactly matching the parser's real precedence.
  assert.equal(result.adults, 2);
  assert.equal(result.departureDate, null);
  assert.equal(result.destination, null);
});

test('family/partner keyword fallbacks only apply when no explicit count is present', () => {
  const partner = parseIntent('A trip with my husband', REFERENCE_DATE);
  assert.equal(partner.adults, 2);

  const family = parseIntent('A family trip somewhere warm', REFERENCE_DATE);
  assert.equal(family.adults, 4);

  const explicitCountWins = parseIntent('A family trip for 6 people', REFERENCE_DATE);
  assert.equal(explicitCountWins.adults, 6);
});

test('parses budget in multiple currency symbol/code positions', () => {
  assert.equal(parseIntent('around €5,000', REFERENCE_DATE).budgetAzn, 5000);
  assert.equal(parseIntent('budget is 3200 AZN', REFERENCE_DATE).budgetAzn, 3200);
  assert.equal(parseIntent('$1500 total', REFERENCE_DATE).budgetAzn, 1500);
});

test('returns all-null fields for input with no recognisable signal, never guesses', () => {
  const result = parseIntent('hello there', REFERENCE_DATE);
  assert.deepEqual(result, {
    destination: null,
    departureDate: null,
    returnDate: null,
    nights: null,
    adults: null,
    budgetAzn: null
  });
});

test('is a pure function: same input always produces the same output', () => {
  const input = 'Five nights in Baku with my wife in June around 2000';
  const first = parseIntent(input, REFERENCE_DATE);
  const second = parseIntent(input, REFERENCE_DATE);
  assert.deepEqual(first, second);
});
