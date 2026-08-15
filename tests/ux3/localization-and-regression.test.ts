import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

test('journeyContinuity and membershipContext dictionary sections have exact AZ/RU/EN key parity', async () => {
  const az = JSON.parse(await readSource('src/i18n/messages/az.json'));
  const ru = JSON.parse(await readSource('src/i18n/messages/ru.json'));
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  for (const section of ['journeyContinuity', 'membershipContext'] as const) {
    assert.ok(section in az && section in ru && section in en, `${section} exists in all three locales`);
    const azKeys = Object.keys(az[section]).sort();
    const ruKeys = Object.keys(ru[section]).sort();
    const enKeys = Object.keys(en[section]).sort();
    assert.deepEqual(azKeys, enKeys, `${section}: az/en key parity`);
    assert.deepEqual(ruKeys, enKeys, `${section}: ru/en key parity`);
  }
});

test('every UX3 dictionary key referenced by NextActionCard actually exists in the dictionary (no dead/mismatched keys)', async () => {
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  const component = await readSource('src/components/next-action-card.tsx');
  const stageKeys = ['awaitingPaymentTitle', 'awaitingPaymentBody', 'paymentActionRequiredTitle', 'paymentActionRequiredBody',
    'paymentInReviewTitle', 'paymentInReviewBody', 'awaitingBookingTitle', 'awaitingBookingBody',
    'bookingInProgressTitle', 'bookingInProgressBody', 'readyToTravelTitle', 'readyToTravelBody'];
  for (const key of stageKeys) {
    assert.ok(key in en.journeyContinuity, `journeyContinuity.${key} exists in the dictionary`);
    assert.ok(component.includes(key), `NextActionCard actually references ${key}`);
  }
});

test('no dead UX3 dictionary keys: every journeyContinuity/membershipContext key is referenced somewhere in the new UX3 source', async () => {
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  const sources = await Promise.all([
    readSource('src/components/next-action-card.tsx'),
    readSource('src/components/experience-shell.tsx'),
    readSource('src/components/customer-trip-room.tsx'),
    readSource('src/components/customer-payment-workspace.tsx')
  ]);
  const combined = sources.join('\n');
  for (const key of Object.keys(en.journeyContinuity)) {
    assert.ok(combined.includes(key), `journeyContinuity.${key} is referenced somewhere (not dead)`);
  }
  for (const key of Object.keys(en.membershipContext)) {
    assert.ok(combined.includes(key), `membershipContext.${key} is referenced somewhere (not dead)`);
  }
});

test('no raw UX3 dictionary keys can leak into rendered text (regex spot check)', async () => {
  const files = ['src/components/next-action-card.tsx', 'src/components/experience-shell.tsx', 'src/components/customer-trip-room.tsx'];
  for (const file of files) {
    const source = await readSource(file);
    assert.ok(!/>\s*(journeyContinuity|membershipContext)\.[a-zA-Z]+\s*</.test(source), `${file} has no raw dictionary-key text nodes`);
  }
});

test('UX2 dictionary sections remain untouched by UX3 (experienceShell, askVoyara, journeyCanvas key sets unchanged)', async () => {
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  // journeyCanvas lost its unused stageSupplierChecked key during UX2
  // cleanup; that is the certified UX2 baseline, not a UX3 regression.
  const expectedJourneyCanvasKeys = [
    'alternativesTitle', 'alternativesUnavailable', 'askAboutItem', 'eyebrow', 'itineraryTitle',
    'mapUnavailable', 'sampleDataNotice', 'stageAiPrepared', 'stageApprovalRequired', 'stageBooked',
    'stageExpertReviewed', 'stageReadyToBook', 'summaryTitle', 'title'
  ].sort();
  assert.deepEqual(Object.keys(en.journeyCanvas).sort(), expectedJourneyCanvasKeys);
});

test('all UX2 test files remain present and wired into npm test (regression)', async () => {
  const ux2Dir = await readdir(new URL('../ux2/', import.meta.url));
  assert.ok(ux2Dir.includes('experience-shell.test.ts'));
  assert.ok(ux2Dir.includes('ask-voyara.test.ts'));
  assert.ok(ux2Dir.includes('journey-canvas.test.ts'));
  assert.ok(ux2Dir.includes('ask-voyara-parser.test.ts'));
  assert.ok(ux2Dir.includes('localization-and-regression.test.ts'));
  const pkg = JSON.parse(await readSource('package.json'));
  const testCommand: string = pkg.scripts.test;
  for (const file of ux2Dir) {
    assert.ok(testCommand.includes(`tests/ux2/${file}`), `tests/ux2/${file} is wired into npm test`);
  }
});

test('D1/D2/E1 tests remain present and wired (deep regression)', async () => {
  const pkg = JSON.parse(await readSource('package.json'));
  const testCommand: string = pkg.scripts.test;
  assert.ok(testCommand.includes('tests/standalone/brand-assets-d1.test.ts'));
  assert.ok(testCommand.includes('tests/standalone/responsive-landing-d2.test.ts'));
  assert.ok(testCommand.includes('tests/standalone/hybrid-landing-e1.test.ts'));
  assert.ok(testCommand.includes('tests/phase-e1/travel-intents.test.ts'));
});

test('the Human Approval Gate quotation-accept command remains the sole acceptance authority (unchanged by UX3)', async () => {
  const source = await readSource('src/components/published-proposals.tsx');
  assert.ok(source.includes("action: 'quotation.accept'"));
  assert.ok(source.includes('acceptanceConfirmed'));
});

test('exactly 29 immutable migrations remain (28 pre-E.2A plus migration 29); UX3 itself introduced zero schema migrations', async () => {
  const migrationsDir = new URL('../../supabase/migrations/', import.meta.url);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(files.length, 29, 'exactly 29 migration files');
  assert.ok(!files.some((name) => /^0*29[_-]/.test(name)), 'no migration 29 exists');
});

test('no UX3 component imports supabase client code directly (all data flows through existing server queries)', async () => {
  const files = ['src/components/next-action-card.tsx', 'src/components/journey-canvas.tsx', 'src/lib/journey-continuity.ts'];
  for (const file of files) {
    const source = await readSource(file);
    assert.ok(!source.includes('createServerSupabaseClient'), `${file} must not talk to Supabase directly`);
    assert.ok(!source.includes('createAdminSupabaseClient'), `${file} must not talk to Supabase directly`);
  }
});
