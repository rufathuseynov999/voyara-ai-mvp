import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

test('production AskVoyara does not import E.2B fixtures or the deterministic preview engine', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(!source.includes('e2b-experience-preview-fixtures'));
  assert.ok(!source.includes('e2b-conversation-engine'));
});

test('production JourneyCanvas does not import E.2B fixtures', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(!source.includes('e2b-experience-preview-fixtures'));
  assert.ok(!source.includes('e2b-conversation-engine'));
});

test('the shared TravelConversationPresentation component imports no Supabase client, no admin client, and calls no fetch', async () => {
  const source = await readSource('src/components/travel-workspace/travel-conversation-presentation.tsx');
  assert.ok(!source.includes('supabase'));
  assert.ok(!source.includes('createAdminSupabaseClient'));
  assert.ok(!source.includes('createServerSupabaseClient'));
  assert.ok(!source.includes('fetch('));
});

test('the shared travel-workspace-types module has zero domain/Supabase imports — pure presentation types only', async () => {
  const source = await readSource('src/components/travel-workspace/travel-workspace-types.ts');
  assert.ok(!/^import/m.test(source), 'the types module must have no imports at all — fully self-contained neutral types');
});

test('the shared presentation component receives all behavior via typed callbacks, never owning a Travel Request API call itself', async () => {
  const source = await readSource('src/components/travel-workspace/travel-conversation-presentation.tsx');
  assert.ok(source.includes('callbacks.onSend'));
  assert.ok(!source.includes('/api/v1/travel-requests'), 'the shared component must never call the real API directly — only via the onSend callback the caller supplies');
});

test('the E.2B preview mapper is the only place E2B fixtures feed into ConversationViewModel — the shared component itself has no fixture import', async () => {
  const previewSource = await readSource('src/components/experience-preview-workspace.tsx');
  const sharedSource = await readSource('src/components/travel-workspace/travel-conversation-presentation.tsx');
  assert.ok(previewSource.includes('e2b-experience-preview-fixtures') || previewSource.includes('e2b-conversation-engine'), 'preview mapper legitimately imports the fixture engine');
  assert.ok(!sharedSource.includes('e2b-conversation-engine'), 'the shared component itself must never import the fixture/preview engine directly');
  assert.ok(!sharedSource.includes('e2b-experience-preview-fixtures'));
});

test('preview cannot submit a real Travel Request — onSend/onCorrect/onBuild in the preview mapper only ever mutate local React state, never call fetch', async () => {
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(!source.includes("fetch('/api/v1/travel-requests"));
});

test('production AskVoyara still submits through the real /api/v1/travel-requests endpoint (unchanged by this refactor)', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes('/api/v1/travel-requests'), 'production AskVoyara must still call the real Travel Request API');
});

test('production proposal acceptance path (PublishedProposals) is unchanged — journey-canvas.tsx still reuses it verbatim rather than reimplementing accept()', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('PublishedProposals'));
  assert.ok(source.includes('deriveJourneyNextAction'), 'journey-continuity projection logic remains in place, unreplaced by preview logic');
});

/* ---------------------------- E.2B.2B: JourneyCanvasPresentation boundaries ---------------------------- */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function hasRealImportOf(source: string, name: string): boolean {
  const code = stripComments(source);
  const importRe = new RegExp(`(^|\\n)\\s*import[^\\n]*\\b${name}\\b[^\\n]*from`, 'm');
  const requireRe = new RegExp(`require\\(['"][^'"]*${name}[^'"]*['"]\\)`);
  const dynamicImportRe = new RegExp(`import\\(['"][^'"]*${name}[^'"]*['"]\\)`);
  return importRe.test(code) || requireRe.test(code) || dynamicImportRe.test(code);
}

test('JourneyCanvasPresentation imports no PublishedProposalView, payment, or booking store (real import/require statements only, never comment prose)', async () => {
  const source = await readSource('src/components/travel-workspace/journey-canvas-presentation.tsx');
  assert.equal(hasRealImportOf(source, 'PublishedProposalView'), false);
  assert.equal(hasRealImportOf(source, 'payment-store'), false);
  assert.equal(hasRealImportOf(source, 'booking-store'), false);
});

test('JourneyCanvasPresentation imports no Supabase/admin client and calls no fetch', async () => {
  const source = await readSource('src/components/travel-workspace/journey-canvas-presentation.tsx');
  assert.ok(!source.includes('createAdminSupabaseClient'));
  assert.ok(!source.includes('supabase'));
  assert.ok(!source.includes('fetch('));
});

test('JourneyCanvasPresentation never derives operational status itself — it only renders the evidenceMode/whatChanged fields it is given', async () => {
  const source = await readSource('src/components/travel-workspace/journey-canvas-presentation.tsx');
  assert.ok(!source.includes('deriveJourneyNextAction'), 'authority derivation must live outside the shared presentation component');
  assert.ok(!source.includes('deriveBookingStage'));
});

test('the evidenceMode field is always rendered, so illustrative content can never visually pass as live evidence', async () => {
  const source = await readSource('src/components/travel-workspace/journey-canvas-presentation.tsx');
  assert.ok(source.includes('e2b-evidence-badge'));
  assert.ok(source.includes("model.evidenceMode === 'LIVE'"));
});

test('production journey-canvas.tsx now imports and renders through JourneyCanvasPresentation — full convergence complete, honestly reflected', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  const usesShared = source.includes('journey-canvas-presentation') && source.includes('<JourneyCanvasPresentation');
  assert.equal(usesShared, true, 'production JourneyCanvas has been converged onto the shared component');
});

test('the preview workspace now consumes JourneyCanvasPresentation, with duplicated markup removed', async () => {
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(source.includes('JourneyCanvasPresentation'));
  const richCardOccurrences = (source.match(/className="e2b-rich-card"/g) ?? []).length;
  assert.equal(richCardOccurrences, 0, 'the preview no longer duplicates the rich-card JSX directly — it lives only inside the shared component now');
});
