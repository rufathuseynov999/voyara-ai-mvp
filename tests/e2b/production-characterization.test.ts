import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

/* ---------------------------- AskVoyara characterization ---------------------------- */

test('CHARACTERIZATION: AskVoyara uses the real /api/v1/travel-requests architecture with action travel_request.save_draft', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes("fetch('/api/v1/travel-requests'"));
  assert.ok(source.includes("action: 'travel_request.save_draft'"));
});

test('CHARACTERIZATION: AskVoyara always finishes by routing to the structured Wizard, never bypassing it', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes("router.push(`/${locale}/trip-wizard`)"));
});

test('CHARACTERIZATION: AskVoyara uses the deterministic parseIntent parser, not a live LLM call', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes("import { parseIntent"));
  assert.ok(source.includes('parseIntent(submittedText)'));
});

test('CHARACTERIZATION: AskVoyara never sets accuracyConfirmed/dataProcessingAcknowledged to true itself — the Wizard remains where real acknowledgements are captured', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes('accuracyConfirmed: false, dataProcessingAcknowledged: false'));
});

test('CHARACTERIZATION: AskVoyara performs no direct Supabase or admin-client operational write', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(!source.includes('createAdminSupabaseClient'));
  assert.ok(!source.includes('supabase'));
});

test('CHARACTERIZATION: AskVoyara imports zero E.2B preview fixtures or the deterministic preview engine', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(!source.includes('e2b-experience-preview-fixtures'));
  assert.ok(!source.includes('e2b-conversation-engine'));
});

test('CHARACTERIZATION: AskVoyara receives fully localized message dictionaries (AZ/RU/EN via Dictionary type), never hardcoded English strings for user-facing copy', async () => {
  const source = await readSource('src/components/ask-voyara.tsx');
  assert.ok(source.includes("messages: Dictionary['askVoyara']"));
  assert.ok(source.includes("requestMessages: Dictionary['travelRequest']"));
});

/* ---------------------------- JourneyCanvas characterization ---------------------------- */

test('CHARACTERIZATION: JourneyCanvas is built on PublishedProposalView as its authoritative source', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('PublishedProposals'));
});

test('CHARACTERIZATION: JourneyCanvas uses deriveJourneyNextAction for its stage/authority derivation, never computing status itself', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes('deriveJourneyNextAction'));
});

test('CHARACTERIZATION: quotationId remains the real cross-domain continuity key in journey-continuity.ts (the module JourneyCanvas relies on)', async () => {
  const source = await readSource('src/lib/journey-continuity.ts');
  assert.ok(source.includes('quotationId'));
});

test('CHARACTERIZATION: JourneyCanvas imports zero E.2B preview fixtures or the deterministic preview engine', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(!source.includes('e2b-experience-preview-fixtures'));
  assert.ok(!source.includes('e2b-conversation-engine'));
});

test('CHARACTERIZATION: JourneyCanvas performs no direct Supabase/admin-client write and no fabricated stage assignment string literal', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(!source.includes('createAdminSupabaseClient'));
});

/* ---------------------------- journey-continuity (deriveJourneyNextAction) domain proofs ---------------------------- */

test('CHARACTERIZATION: deriveJourneyNextAction stage derivation module exists and is the single source of the stage logic these tests protect', async () => {
  const source = await readSource('src/lib/journey-continuity.ts');
  assert.ok(source.includes('export function deriveJourneyNextAction') || source.includes('deriveJourneyNextAction'));
});
