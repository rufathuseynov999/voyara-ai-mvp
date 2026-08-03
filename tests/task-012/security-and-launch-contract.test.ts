import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(path, 'utf8');

test('Task 012 database migration closes default browser privilege gaps only', async () => {
  const migration = await read('supabase/migrations/20260718191113_task012_production_hardening.sql');
  assert.match(migration, /revoke create on schema public from public, anon, authenticated/i);
  assert.match(migration, /revoke execute on all functions in schema public from public, anon, authenticated/i);
  assert.match(migration, /alter default privileges in schema public revoke execute on functions from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /refund|approval limit|membership benefit|supplier booking/i);
});

test('Health surface separates public liveness from token-protected deep readiness', async () => {
  const [health, liveness, readiness] = await Promise.all([
    read('src/server/bos/health.ts'),
    read('src/app/api/v1/health/route.ts'),
    read('src/app/api/v1/health/readiness/route.ts')
  ]);
  assert.match(liveness, /livenessHealth/);
  assert.doesNotMatch(liveness, /database|secret|supabaseConfigured/i);
  assert.match(readiness, /timingSafeEqual/);
  assert.match(readiness, /HEALTH_AUTHENTICATION_REQUIRED/);
  assert.match(readiness, /health\.status === 'ready' \? 200 : 503/);
  assert.match(health, /membership_plan_catalogue/);
  // Raw console.* calls are never permitted. error.message is permitted only
  // inside a well-formed logger.*(...) call (Phase 3C structured logging,
  // which redacts secret-shaped keys and writes server-side only, never into
  // a returned response body) — never elsewhere, e.g. interpolated directly
  // into a returned health payload. Strip each complete logger call
  // statement before checking for a stray leak outside that discipline.
  assert.doesNotMatch(health, /console\./);
  const loggerCallPattern = /logger\.\w+\([^;]*?\);/gs;
  assert.match(health, loggerCallPattern, 'expected at least one structured logger call');
  const withoutLoggerCalls = health.replace(loggerCallPattern, '');
  assert.doesNotMatch(withoutLoggerCalls, /error\.message|console\./);
});

test('Unused local Supabase surfaces stay disabled and Production-only inputs stay server-only', async () => {
  const [config, example, proxy] = await Promise.all([
    read('supabase/config.toml'),
    read('.env.example'),
    read('src/proxy.ts')
  ]);
  assert.match(config, /schemas = \["public"\]/);
  assert.match(config, /\[realtime\]\nenabled = false/);
  assert.match(config, /\[storage\]\nenabled = false/);
  assert.match(config, /\[edge_runtime\]\nenabled = false/);
  assert.match(config, /\[analytics\]\nenabled = false/);
  assert.match(example, /VOYARA_HEALTH_TOKEN=/);
  assert.match(example, /VOYARA_RELEASE_ID=/);
  assert.doesNotMatch(example, /NEXT_PUBLIC_(?:HEALTH|SECRET|DATABASE)/);
  assert.match(proxy, /Strict-Transport-Security/);
  assert.match(proxy, /Cross-Origin-Resource-Policy/);
});

test('Backup and restore tooling is explicitly gated away from accidental Production restore', async () => {
  const [backup, restore] = await Promise.all([
    read('scripts/database-backup.mjs'),
    read('scripts/database-restore-rehearsal.mjs')
  ]);
  assert.match(backup, /--execute/);
  assert.match(backup, /BACKUP_CONTAINS_SENSITIVE_DATA/);
  assert.match(backup, /mode: 0o700/);
  assert.match(backup, /chmodSync\(output, 0o600\)/);
  assert.match(restore, /NON_PRODUCTION_ONLY/);
  assert.match(restore, /VOYARA_RESTORE_TARGET !== 'staging'/);
  assert.match(restore, /Restore target matches the Production database host/);
});

test('Release gates include secret, migration, full application and browser checks', async () => {
  const [packageJson, workflow, browser] = await Promise.all([
    read('package.json'),
    read('.github/workflows/verify.yml'),
    read('scripts/browser-launch-readiness.mjs')
  ]);
  const packageData = JSON.parse(packageJson) as { version: string; scripts: Record<string, string> };
  assert.equal(packageData.version, '0.12.0');
  assert.match(packageData.scripts.verify, /security:scan/);
  assert.match(packageData.scripts.verify, /db:migrations:verify/);
  assert.match(packageData.scripts['verify:full'], /test:browser/);
  assert.match(workflow, /npm run security:scan/);
  assert.match(workflow, /npm run db:migrations:verify/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /supabase db reset --local --no-seed/);
  assert.match(browser, /screenPaths/);
  assert.match(browser, /unlabelledControls/);
  assert.match(browser, /horizontal overflow/);
});

test('Task 012 preserves unresolved Founder authority boundaries', async () => {
  const [authority, administration, apiFiles] = await Promise.all([
    read('src/server/bos/authority.ts'),
    read('src/server/administration/contract.ts'),
    read('package.json')
  ]);
  assert.match(authority, /'refund\.approve': \{ humanOnly: true/);
  assert.match(authority, /'refund\.execute': \{ humanOnly: true/);
  assert.match(authority, /'approval_limit\.change': \{ humanOnly: true, roles: \['founder'\]/);
  assert.doesNotMatch(administration, /action: z\.literal\('(?:refund|approval_limit)/i);
  assert.match(administration, /refunds: 'BLOCKED_PENDING_FOUNDER_POLICY'/);
  assert.match(administration, /approvalLimits: 'NOT_CONFIGURED'/);
  assert.doesNotMatch(apiFiles, /api\/v1\/(?:refund|approval-limit)/i);
});
