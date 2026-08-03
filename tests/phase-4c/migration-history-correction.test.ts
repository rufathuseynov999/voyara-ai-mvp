import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * Phase 4C — proves the migration-history correction was done properly:
 * migration 18 (immutable, as originally applied to the sandbox) carries no
 * INBOUND exemption; migration 19 (the pre-release corrective migration)
 * contains exactly that correction, drop+recreate, and nothing else.
 */

test('migration 18 does not contain an INBOUND exemption — it is restored to its originally-applied form', async () => {
  const raw = await readFile(new URL('../../supabase/migrations/20260728090000_task018_phase4c_whatsapp_chat_risk_policy.sql', import.meta.url), 'utf8');
  assert.ok(!/direction\s*=\s*'INBOUND'/.test(raw));
});

test('migration 19 exists and contains exactly the drop+recreate correction for messages_sent_requires_approval_or_policy', async () => {
  const raw = await readFile(new URL('../../supabase/migrations/20260728093000_task019_phase4c_inbound_message_constraint_correction.sql', import.meta.url), 'utf8');
  assert.match(raw, /drop constraint messages_sent_requires_approval_or_policy/);
  assert.match(raw, /add constraint messages_sent_requires_approval_or_policy/);
  assert.match(raw, /direction\s*=\s*'INBOUND'/);
  // Migration 19 must not touch any other table or constraint — this is a
  // narrow, single-purpose corrective migration.
  assert.ok(!/create table|drop table|create type/i.test(raw));
});

test('migration 19 preserves both the human-approval and policy-authorization branches unchanged (widening only, never narrowing)', async () => {
  const raw = await readFile(new URL('../../supabase/migrations/20260728093000_task019_phase4c_inbound_message_constraint_correction.sql', import.meta.url), 'utf8');
  assert.match(raw, /approved_by is not null and approved_at is not null/);
  assert.match(raw, /risk_class = 'LOW_RISK_INFORMATIONAL'/);
  assert.match(raw, /policy_id is not null/);
});
