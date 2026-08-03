import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { defaultLocale, locales } from '@/i18n/config';
import { corporateMemberships, personalMemberships } from '@/lib/memberships';
import { screenRegistry } from '@/lib/screen-registry';

type JsonRecord = Record<string, unknown>;

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => flattenKeys(item, `${prefix}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as JsonRecord).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

async function load(locale: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(`src/i18n/messages/${locale}.json`, 'utf8')) as JsonRecord;
}

test('Azerbaijani is the default and all three locale catalogues have exact key parity', async () => {
  assert.equal(defaultLocale, 'az');
  assert.deepEqual(locales, ['az', 'ru', 'en']);
  const [az, ru, en] = await Promise.all(locales.map(load));
  const expected = flattenKeys(az).sort();
  assert.deepEqual(flattenKeys(ru).sort(), expected);
  assert.deepEqual(flattenKeys(en).sort(), expected);
});

test('customer catalogues do not mix Cyrillic into Azerbaijani or English states', async () => {
  const [az, ru, en] = await Promise.all(locales.map(load));
  const azText = JSON.stringify(az);
  const ruText = JSON.stringify(ru);
  const enText = JSON.stringify(en);

  assert.doesNotMatch(azText, /[\u0400-\u04ff]/u);
  assert.doesNotMatch(enText, /[\u0400-\u04ff]/u);
  assert.match(azText, /[ƏəĞğİıÖöŞşÜüÇç]/u);
  assert.match(ruText, /[\u0400-\u04ff]/u);
});

test('the approved membership catalogue is unchanged', () => {
  assert.deepEqual(
    personalMemberships.map(({ name, monthlyAzn, annualAzn }) => [name, monthlyAzn, annualAzn]),
    [
      ['Smart', 19, 190],
      ['Plus', 39, 390],
      ['Premium', 69, 690],
      ['Black', 299, 2990]
    ]
  );
  assert.deepEqual(
    corporateMemberships.map(({ name, monthlyAzn }) => [name, monthlyAzn]),
    [
      ['Starter', 149],
      ['Standard', 299],
      ['Professional', 599],
      ['Enterprise', null]
    ]
  );
});

test('all eight retained screens have unique addressable locale routes', () => {
  assert.equal(screenRegistry.length, 8);
  assert.deepEqual(screenRegistry.map(({ legacyId }) => legacyId), ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
  for (const locale of locales) {
    const routes = screenRegistry.map((screen) => screen.route(locale));
    assert.equal(new Set(routes).size, 8);
    assert.ok(routes.every((route) => route === `/${locale}` || route.startsWith(`/${locale}/`)));
  }
});
