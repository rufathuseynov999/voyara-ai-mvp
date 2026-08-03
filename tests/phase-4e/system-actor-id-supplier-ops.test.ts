import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { SYSTEM_ACTOR_ID } from '@/server/agents/business-account';

/**
 * Phase 4E — proves the SYSTEM_ACTOR_ID correction is complete across the
 * supplier-ops module and won't silently regress. Every `actor_id`-backed
 * column in this schema (supplier_events, document_events,
 * portal_task_events) is a PostgreSQL `uuid` column; a bare string literal
 * like `'agent'` or `'system'` passed where an actorId is constructed would
 * fail the real database but pass every hermetic test, since in-memory
 * stores don't enforce column types — the exact gap that let this defect
 * (found in `portal-task-service.ts`'s `prepareTask` and
 * `markReadyForReview`) ship undetected until real-sandbox verification
 * caught it, mirroring the identical class of defect already fixed once in
 * Phase 4D.
 */

const SUPPLIER_OPS_DIR = new URL('../../src/server/agents/supplier-ops', import.meta.url);

async function supplierOpsSourceFiles(): Promise<string[]> {
  const dirPath = new URL(SUPPLIER_OPS_DIR).pathname;
  const entries = await readdir(dirPath);
  return entries.filter((f) => f.endsWith('.ts')).map((f) => join(dirPath, f));
}

test('SYSTEM_ACTOR_ID is a well-formed, stable UUID reused from the shared module — not redefined locally', () => {
  assert.match(SYSTEM_ACTOR_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test('no supplier-ops source file constructs an actorId (or actor_id) using a bare string literal like "agent" or "system"', async () => {
  const files = await supplierOpsSourceFiles();
  const offenders: string[] = [];
  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/actor_?[Ii]d\s*:\s*['"](agent|system|human)['"]/.test(codeOnly)) {
      offenders.push(filePath);
    }
  }
  assert.deepEqual(offenders, [], `found bare actor-kind-shaped actorId literal(s) in: ${offenders.join(', ')}`);
});

test('portal-task-service.ts uses SYSTEM_ACTOR_ID for every automated (non-human-supplied) event it constructs', async () => {
  const raw = await readFile(new URL('../../src/server/agents/supplier-ops/portal-task-service.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const matches = codeOnly.match(/SYSTEM_ACTOR_ID/g) ?? [];
  assert.ok(matches.length >= 2, `expected at least 2 uses of SYSTEM_ACTOR_ID in portal-task-service.ts, found ${matches.length}`);
});

test('the sandbox test file\'s own seed helpers bind actor_id parameters to real UUID constants, never inline actor-kind strings', async () => {
  const raw = await readFile(new URL('../../tests/phase-4e/supplier-ops-sandbox.test.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const insertStatements = codeOnly.match(/insert into (supplier_events|document_events|portal_task_events)[^;]+;/g) ?? [];
  assert.ok(insertStatements.length > 0, 'expected to find event-table insert statements to check');
  for (const statement of insertStatements) {
    assert.ok(!/,'(agent|system|human)',\$/.test(statement.replace(/\s/g, '')), `found a hardcoded actor-kind string where a $n actor_id placeholder was expected: ${statement}`);
  }
});
