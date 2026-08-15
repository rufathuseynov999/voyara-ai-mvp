import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

test('the /[locale]/ask route exists, is customer-gated, and mounts AskVoyara', async () => {
  const source = await readSource('src/app/[locale]/(customer)/ask/page.tsx');
  assert.ok(source.includes('<AskVoyara'), 'mounts the AskVoyara component');
  assert.ok(source.includes("requireViewerRole(locale, ['customer']"), 'gated to the customer role, consistent with the rest of the (customer) group');
});

test('AskVoyara imports the pure parser rather than defining a second implementation', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(
    source.includes("import { parseIntent") && source.includes("from '@/lib/ask-voyara-parser'"),
    'imports parseIntent from the shared pure module'
  );
  assert.ok(!/function\s+parseIntent/.test(source), 'does not redefine parseIntent locally (single implementation, no drift)');
});

test('AskVoyara writes through the real, existing Travel Request command — not a new/parallel authority path', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes("fetch('/api/v1/travel-requests'"), 'calls the real existing Travel Request API route');
  assert.ok(source.includes("action: 'travel_request.save_draft'"), 'uses the existing save_draft action, not a new one');
  assert.ok(source.includes('Idempotency-Key'), 'uses the same idempotency-key discipline as the existing TravelRequestForm');
  // Must not invent a submitted/accepted state directly from Ask VOYARA —
  // it only ever saves a draft; the customer still finishes in the Wizard
  // where the accuracy/data-processing acknowledgements are captured.
  assert.ok(!source.includes("'travel_request.submit'"), 'never self-submits — only ever saves a draft, preserving the Human Approval Gate path');
  assert.ok(source.includes('accuracyConfirmed: false'), 'never fabricates the accuracy acknowledgement on the customer\'s behalf');
  assert.ok(source.includes('dataProcessingAcknowledged: false'), 'never fabricates the data-processing acknowledgement on the customer\'s behalf');
});

test('AskVoyara never references booking, payment, or supplier authority', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  const forbidden = ['/api/v1/staff/payments', '/api/v1/staff/bookings', 'quotation.accept', 'booking.confirm', 'payment.capture'];
  for (const term of forbidden) {
    assert.ok(!source.includes(term), `must not reference ${term}`);
  }
});

test('after saving a draft, AskVoyara routes the customer into the structured Wizard rather than completing the flow itself', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes("router.push(`/${locale}/trip-wizard`)"), 'redirects into the Wizard after a successful draft save');
});

test('the Wizard route is unchanged and still reachable independently of Ask VOYARA', async () => {
  const source = await readSource('src/app/[locale]/trip-wizard/page.tsx');
  assert.ok(source.includes('<TravelRequestForm'), 'the existing structured form is still mounted');
});

test('Ask VOYARA localized strings exist with exact key parity across AZ/RU/EN', async () => {
  const az = JSON.parse(await readSource('src/i18n/messages/az.json'));
  const ru = JSON.parse(await readSource('src/i18n/messages/ru.json'));
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  const azKeys = Object.keys(az.askVoyara).sort();
  const ruKeys = Object.keys(ru.askVoyara).sort();
  const enKeys = Object.keys(en.askVoyara).sort();
  assert.deepEqual(azKeys, enKeys, 'az/en askVoyara key sets match exactly');
  assert.deepEqual(ruKeys, enKeys, 'ru/en askVoyara key sets match exactly');
  // No empty-string leakage (a common silent localization gap).
  for (const [locale, dict] of [['az', az], ['ru', ru], ['en', en]] as const) {
    for (const [key, value] of Object.entries(dict.askVoyara)) {
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${locale}.askVoyara.${key} is a non-empty string`);
    }
  }
});

test('Ask VOYARA does not mix locales within a single dictionary (spot check for stray Latin/Cyrillic bleed)', async () => {
  const ru = JSON.parse(await readSource('src/i18n/messages/ru.json'));
  const az = JSON.parse(await readSource('src/i18n/messages/az.json'));
  // Russian strings should be entirely Cyrillic/punctuation/digits — no
  // stray English words accidentally left in from copy-paste.
  const englishWordPattern = /\b(the|and|your|trip|budget)\b/i;
  for (const [key, value] of Object.entries(ru.askVoyara)) {
    assert.ok(!englishWordPattern.test(String(value)), `ru.askVoyara.${key} should not contain leftover English words: "${value}"`);
  }
  for (const [key, value] of Object.entries(az.askVoyara)) {
    assert.ok(!englishWordPattern.test(String(value)), `az.askVoyara.${key} should not contain leftover English words: "${value}"`);
  }
});
