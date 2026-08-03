import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readDemoRole, readPublicSupabaseConfig, validateServerEnvironment } from '@/config/env-core';
import { syntheticPersonas } from '@/fixtures/synthetic';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_01234567890123456789',
  SUPABASE_SECRET_KEY: 'sb_secret_012345678901234567890123',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  VOYARA_DEMO_MODE: 'false',
  VOYARA_DEMO_ROLE: 'founder',
  VOYARA_LOG_LEVEL: 'info'
};

test('environment validation accepts publishable/secret separation', () => {
  const environment = validateServerEnvironment(validEnvironment);
  assert.equal(environment.demoMode, false);
  assert.match(environment.supabasePublishableKey, /^sb_publishable_/);
  assert.match(environment.supabaseSecretKey, /^sb_secret_/);
});

test('partial browser configuration and publicly prefixed secrets fail closed', () => {
  assert.throws(() =>
    readPublicSupabaseConfig({ NODE_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })
  );
  assert.throws(() =>
    validateServerEnvironment({
      ...validEnvironment,
      NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'sb_secret_exposed'
    })
  );
});

test('Production rejects synthetic demo authority', () => {
  assert.throws(() => readDemoRole({ NODE_ENV: 'production', VOYARA_DEMO_MODE: 'true', VOYARA_DEMO_ROLE: 'founder' }));
});

test('browser client source contains no server credential name', async () => {
  const browserClient = await readFile('src/lib/supabase/client.ts', 'utf8');
  assert.doesNotMatch(browserClient, /SUPABASE_SECRET_KEY|SERVICE_ROLE|DATABASE_URL/);
  assert.match(browserClient, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
});

test('the PWA worker caches only static brand assets', async () => {
  const worker = await readFile('public/sw.js', 'utf8');
  assert.match(worker, /STATIC_ASSETS = \['\/brand\/voyara-mark\.png', '\/manifest\.webmanifest'\]/);
  assert.doesNotMatch(worker, /caches\.put/);
  assert.match(worker, /if \(!STATIC_ASSETS\.includes\(requestUrl\.pathname\)\) return/);
});

test('all synthetic personas are explicit and use reserved example addresses', () => {
  assert.ok(syntheticPersonas.length >= 2);
  for (const persona of syntheticPersonas) {
    assert.equal(persona.synthetic, true);
    assert.match(persona.email, /@voyara\.example$/);
    assert.match(persona.id, /^[0-9a-f-]{36}$/);
  }
});

test('the migration enables and forces RLS on every created table', async () => {
  const migration = await readFile('supabase/migrations/20260717084526_task002_foundation_security.sql', 'utf8');
  const tables = [...migration.matchAll(/create table ([a-z_]+\.[a-z_]+)/g)].map((match) => match[1]);
  assert.deepEqual(tables.sort(), [
    'private.audit_events',
    'private.command_idempotency',
    'public.profiles',
    'public.role_assignments'
  ]);
  for (const table of tables) {
    assert.match(migration, new RegExp(`alter table ${table.replace('.', '\\.')} enable row level security;`));
    assert.match(migration, new RegExp(`alter table ${table.replace('.', '\\.')} force row level security;`));
  }
  assert.doesNotMatch(migration, /grant\s+(?:all|insert|update|delete)[^;]*role_assignments[^;]*authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:update|delete)[^;]*audit_events/i);
});
