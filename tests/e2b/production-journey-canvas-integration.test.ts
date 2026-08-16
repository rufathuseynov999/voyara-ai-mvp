import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function hasRealImportOf(source: string, name: string): boolean {
  const code = stripComments(source);
  return new RegExp(`(^|\\n)\\s*import[^\\n]*\\b${name}\\b[^\\n]*from`, 'm').test(code)
    || new RegExp(`require\\(['"][^'"]*${name}[^'"]*['"]\\)`).test(code)
    || new RegExp(`import\\(['"][^'"]*${name}[^'"]*['"]\\)`).test(code);
}

test('1: journey-canvas.tsx imports JourneyCanvasPresentation', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'JourneyCanvasPresentation'));
  assert.ok(source.includes('<JourneyCanvasPresentation'));
});

test('2: journey-canvas.tsx imports and calls mapPublishedProposalToJourneyCanvasViewModel', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'mapPublishedProposalToJourneyCanvasViewModel'));
  assert.ok(source.includes('mapPublishedProposalToJourneyCanvasViewModel('));
});

test('3: PublishedProposals remains rendered, passed through the proposalContent slot, receiving the FULL unmodified proposals array', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'PublishedProposals'));
  assert.ok(source.includes('<PublishedProposals locale={locale} messages={messages} proposals={proposals} />'));
});

test('4: journey-canvas.tsx never reimplements accept() directly — that stays inside PublishedProposals', async () => {
  const source = stripComments(await readSource('src/components/journey-canvas.tsx'));
  assert.ok(!source.includes('accept('));
});

test('5: NextActionCard remains rendered, gated on the same real acceptedProposal + continuityMessages condition as before', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'NextActionCard'));
  assert.ok(source.includes('nextAction && continuityMessages ?'));
});

test('6: deriveJourneyNextAction remains the real authority source', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(hasRealImportOf(source, 'deriveJourneyNextAction'));
  assert.ok((source.match(/deriveJourneyNextAction\(/g) ?? []).length >= 1);
});

test('7: journey-canvas.tsx does not reimplement quotationId matching itself', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(!source.includes('.find((p) => p.quotationId'));
});

test('8: production journey-canvas.tsx imports zero E.2B preview fixtures or the deterministic preview engine', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(!hasRealImportOf(source, 'e2b-experience-preview-fixtures'));
  assert.ok(!hasRealImportOf(source, 'e2b-conversation-engine'));
});

test('9: the shared JourneyCanvasPresentation imports no domain components', async () => {
  const source = await readSource('src/components/travel-workspace/journey-canvas-presentation.tsx');
  assert.ok(!hasRealImportOf(source, 'PublishedProposals'));
  assert.ok(!hasRealImportOf(source, 'NextActionCard'));
});

test('10: the shared JourneyCanvasPresentation performs no fetch and no write', async () => {
  const source = await readSource('src/components/travel-workspace/journey-canvas-presentation.tsx');
  assert.ok(!source.includes('fetch('));
  assert.ok(!hasRealImportOf(source, 'supabase'));
});

test('11: LIVE mode omits every illustrative field — no fabricated route/hotel/dining/itinerary object is ever constructed', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('routeLabel: null'));
  assert.ok(!/hotelCandidate:\s*\{/.test(source), 'no fabricated hotelCandidate object literal may be constructed');
  assert.ok(!/diningCandidate:\s*\{/.test(source), 'no fabricated diningCandidate object literal may be constructed');
  assert.ok(!source.includes('DIRECTION_ITINERARIES'));
});

test('12: production model always uses evidenceMode LIVE', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes("evidenceMode: 'LIVE'"));
  assert.ok(!source.includes("evidenceMode: 'ILLUSTRATIVE'"));
});

test('13: existing customer navigation (askHref link) remains present', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('href={askHref}'));
});

test('14: multiple proposals are never silently collapsed — a representative proposal derives only the hero, while PublishedProposals still receives the entire array', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('proposals[0]'));
  assert.ok(source.includes('proposals={proposals}'));
});

test('15: production slots are supplied via one explicit slots object', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('slots={{ stageContent, proposalContent, secondaryActionsContent }}'));
});

test('16: the empty-proposals (sample data) state remains honest', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('canvasMessages.sampleDataNotice'));
  assert.ok(source.includes('isSampleData'));
});

test('17: JourneyCanvasPresentation accepts optional slots that render nothing when omitted', async () => {
  const source = await readSource('src/components/travel-workspace/journey-canvas-presentation.tsx');
  assert.ok(source.includes('slots?:'));
  assert.ok(source.includes('slots?.stageContent'));
});

test('18: preview continues to supply zero production slots', async () => {
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(!source.includes('slots={{'));
});
