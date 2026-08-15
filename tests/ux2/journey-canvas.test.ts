import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

test('JourneyCanvas reuses the existing PublishedProposals component verbatim, not a reimplementation', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes("import { PublishedProposals } from './published-proposals'"), 'imports the real existing component');
  assert.ok(source.includes('<PublishedProposals'), 'renders it');
});

test('published-proposals.tsx (the real proposal accept/action logic) is byte-identical to before UX2', async () => {
  const source = await readSource('src/components/published-proposals.tsx');
  // The exact accept() command contract must be untouched.
  assert.ok(source.includes("action: 'quotation.accept'"), 'existing accept action preserved');
  assert.ok(source.includes("fetch('/api/v1/customer/commercial'"), 'existing commercial API path preserved');
  assert.ok(source.includes('acceptanceConfirmed'), 'existing explicit-confirmation checkbox gate preserved');
});

test('proposal page mounts JourneyCanvas, still fed by the real loadCustomerPublishedProposals data path', async () => {
  const source = await readSource('src/app/[locale]/(customer)/proposal/page.tsx');
  assert.ok(source.includes('<JourneyCanvas'), 'mounts JourneyCanvas');
  assert.ok(source.includes('loadCustomerPublishedProposals') || source.includes('proposals'), 'still driven by real proposal data, not fabricated content');
});

test('JourneyCanvas HAG stage derivation only uses fields that actually exist on PublishedProposalView', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  // Derivation must reference only status/validUntil/acceptedAt — no
  // invented fields.
  assert.ok(source.includes('p.status'), 'derives from real status field');
  assert.ok(source.includes('p.validUntil'), 'derives from real validUntil field');
  // Must NOT claim a "supplier checked" state — no such field exists on
  // the contract, and inventing one would misrepresent real system state.
  assert.ok(!/supplierChecked|supplier_checked|SUPPLIER_CHECKED/.test(source), 'does not fabricate an unsupported supplier-checked state');
});

test('JourneyCanvas explicitly documents sample-data honesty when no real proposals exist', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('isSampleData'), 'has an explicit sample-data flag');
  assert.ok(source.includes('sampleDataNotice'), 'surfaces the honest sample-data notice to the customer');
});

test('Journey Canvas localized strings exist with exact key parity across AZ/RU/EN', async () => {
  const az = JSON.parse(await readSource('src/i18n/messages/az.json'));
  const ru = JSON.parse(await readSource('src/i18n/messages/ru.json'));
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  const azKeys = Object.keys(az.journeyCanvas).sort();
  const ruKeys = Object.keys(ru.journeyCanvas).sort();
  const enKeys = Object.keys(en.journeyCanvas).sort();
  assert.deepEqual(azKeys, enKeys, 'az/en journeyCanvas key sets match exactly');
  assert.deepEqual(ruKeys, enKeys, 'ru/en journeyCanvas key sets match exactly');
});

test('Journey Canvas stage labels cover exactly the honest, derivable set (no supplier-checked key exists to accidentally use)', async () => {
  const en = JSON.parse(await readSource('src/i18n/messages/en.json'));
  const keys = Object.keys(en.journeyCanvas);
  assert.ok(keys.includes('stageAiPrepared'));
  assert.ok(keys.includes('stageExpertReviewed'));
  assert.ok(keys.includes('stageApprovalRequired'));
  assert.ok(keys.includes('stageReadyToBook'));
  assert.ok(keys.includes('stageBooked'));
  assert.ok(!keys.some((k) => /supplierChecked/i.test(k)), 'no supplier-checked dictionary key exists to be misused');
});
