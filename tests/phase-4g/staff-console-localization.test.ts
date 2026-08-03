import assert from 'node:assert/strict';
import test from 'node:test';

test('staffAutomation dictionary section exists for all three locales with identical key sets', async () => {
  const az = (await import('@/i18n/messages/az.json')).default as Record<string, unknown>;
  const ru = (await import('@/i18n/messages/ru.json')).default as Record<string, unknown>;
  const en = (await import('@/i18n/messages/en.json')).default as Record<string, unknown>;

  const azKeys = Object.keys(az.staffAutomation as Record<string, unknown>).sort();
  const ruKeys = Object.keys(ru.staffAutomation as Record<string, unknown>).sort();
  const enKeys = Object.keys(en.staffAutomation as Record<string, unknown>).sort();

  assert.deepEqual(azKeys, enKeys);
  assert.deepEqual(ruKeys, enKeys);
});

test('no staffAutomation string is empty in any locale', async () => {
  const locales = ['az', 'ru', 'en'];
  for (const locale of locales) {
    const dict = (await import(`@/i18n/messages/${locale}.json`)).default as { staffAutomation: Record<string, string> };
    for (const [key, value] of Object.entries(dict.staffAutomation)) {
      assert.ok(value.length > 0, `${locale}.staffAutomation.${key} is empty`);
    }
  }
});

test('staff-console-actions.tsx reads strings only from the dictionary — no hardcoded English button label literal remains', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/components/staff-console-actions.tsx', import.meta.url), 'utf8');
  assert.ok(!/>Take over</.test(raw));
  assert.ok(!/>Approve</.test(raw));
  assert.ok(!/>Retry</.test(raw));
  assert.ok(/getDictionary\(locale as Locale\)\.staffAutomation/.test(raw));
});

test('the staff automation page reads its title and section headers only from the dictionary', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/app/[locale]/staff/automation/page.tsx', import.meta.url), 'utf8');
  assert.ok(!/>Staff automation console</.test(raw));
  assert.ok(/getDictionary\(locale\)\.staffAutomation/.test(raw));
});
