import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { SYSTEM_ACTOR_ID } from '@/server/agents/business-account';

/**
 * Phase 4D — proves the SYSTEM_ACTOR_ID defect correction is complete and
 * won't silently regress. `actor_id` is a `uuid` column
 * (`call_events.actor_id`, and every other `*_events.actor_id` in this
 * schema); a bare string literal like `'system'` passed where an actorId is
 * constructed would fail the real database but pass every hermetic test,
 * since in-memory stores don't enforce column types — this is exactly the
 * gap that let the original defect ship undetected until real-sandbox
 * verification caught it.
 */

const VOICE_DIR = new URL('../../src/server/agents/voice', import.meta.url);

async function voiceSourceFiles(): Promise<string[]> {
  const dirPath = new URL(VOICE_DIR).pathname;
  const entries = await readdir(dirPath);
  return entries.filter((f) => f.endsWith('.ts')).map((f) => join(dirPath, f));
}

test('SYSTEM_ACTOR_ID is a well-formed, stable UUID — not a per-call random value', () => {
  assert.match(SYSTEM_ACTOR_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(SYSTEM_ACTOR_ID, SYSTEM_ACTOR_ID);
});

test('no voice-layer source file constructs an actorId (or actor_id) using the bare string literal "system"', async () => {
  const files = await voiceSourceFiles();
  const offenders: string[] = [];
  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/actor_?[Ii]d\s*:\s*['"]system['"]/.test(codeOnly)) {
      offenders.push(filePath);
    }
  }
  assert.deepEqual(offenders, [], `found bare 'system' actorId literal(s) in: ${offenders.join(', ')}`);
});

test('every voice-layer call-event construction that sets actorKind: \'system\' also sets actorId to the shared SYSTEM_ACTOR_ID constant, not an inline literal', async () => {
  const files = await voiceSourceFiles();
  let systemEventConstructionCount = 0;
  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const matches = codeOnly.match(/actorId:\s*SYSTEM_ACTOR_ID,\s*actorKind:\s*'system'/g) ?? [];
    systemEventConstructionCount += matches.length;
  }
  assert.equal(systemEventConstructionCount, 3, 'expected exactly 3 system-actor event construction sites, all using SYSTEM_ACTOR_ID');
});

test('SYSTEM_ACTOR_ID is not the same value as any customer, founder, or staff test fixture UUID used elsewhere in this project', () => {
  const knownHumanFixtureIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555'
  ];
  assert.ok(!knownHumanFixtureIds.includes(SYSTEM_ACTOR_ID));
});
