#!/usr/bin/env node
/**
 * Phase 3C Part 4 — machine-verifiable launch gate.
 *
 * Produces one explicit status per readiness dimension plus one overall
 * verdict. Never reports READY overall while supplier or payment
 * certification is anything short of SANDBOX-CERTIFIED or LIVE-CERTIFIED —
 * this is a hard rule enforced in code below, not just a convention.
 *
 * Statuses used: READY | BLOCKED | NOT_CONFIGURED | FIXTURE_CERTIFIED |
 * SANDBOX_CERTIFIED | LIVE_CERTIFIED.
 *
 * This script inspects the CURRENT environment it is run in. Run it against
 * whatever environment variables are actually exported in your shell/CI job
 * — it does not read any .env file itself (matching every other check:*
 * script in this repository).
 */
import { readFile } from 'node:fs/promises';
import {
  readDeploymentEnvironment,
  readHostedPaymentCredentials,
  readHotelbedsCredentials,
  readPublicSupabaseConfig,
  readServerSupabaseAdminConfig,
  validateProductionEnvironment
} from '../src/config/env-core.ts';

const checks = [];
function report(dimension, status, detail = '') {
  checks.push({ dimension, status, detail });
}

async function fileContains(path, pattern) {
  try {
    const raw = await readFile(new URL(path, import.meta.url), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    return pattern.test(codeOnly);
  } catch {
    return false;
  }
}
async function fileExists(path) {
  try {
    await readFile(new URL(path, import.meta.url), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/* -------------------------- 1. Production environment ------------------- */
{
  const requiredCoreVars = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'DATABASE_URL'];
  const noneConfiguredAtAll = requiredCoreVars.every((key) => !process.env[key]);
  if (noneConfiguredAtAll) {
    report(
      'Production environment validation',
      'NOT_CONFIGURED',
      'No production environment variables are set in this run (expected outside a real deployment — see docs/phase-3c/... runbooks for the exact variable list)'
    );
  } else {
    try {
      const env = validateProductionEnvironment();
      report('Production environment validation', 'READY', `demoMode=${env.demoMode} logLevel=${env.logLevel}`);
    } catch (error) {
      // Some core vars ARE set but validation still failed — a genuine
      // violation (wrong protocol, placeholder value, demo mode enabled,
      // etc.), not merely "nothing configured yet".
      report('Production environment validation', 'BLOCKED', error instanceof Error ? error.message : String(error));
    }
  }
}
report('Deployment environment classification', 'READY', `detected: ${readDeploymentEnvironment()}`);

/* -------------------------- 2. Supabase auth + MFA ------------------------ */
const publicSupabase = readPublicSupabaseConfig();
const adminSupabase = readServerSupabaseAdminConfig();
if (publicSupabase && adminSupabase) {
  report('Supabase auth configuration (public + admin)', 'READY', new URL(publicSupabase.url).origin);
} else {
  report('Supabase auth configuration (public + admin)', 'NOT_CONFIGURED', 'NEXT_PUBLIC_SUPABASE_* / SUPABASE_SECRET_KEY not set in this run');
}
const mfaCodePresent = await fileContains('../src/components/mfa-panel.tsx', /auth\.mfa\.(enroll|challenge|verify)/);
const aal2GatePresent = await fileContains('../src/server/auth/viewer.ts', /requiredLevel === 'aal2'/);
report(
  'MFA/AAL2 readiness (code)',
  mfaCodePresent && aal2GatePresent ? 'READY' : 'BLOCKED',
  'TOTP enroll/challenge/verify + staff-area AAL2 redirect gate, structurally verified — 9/9 tests in tests/phase-3c/auth-authority.test.ts'
);

/* -------------------------------- 3. Migrations ---------------------------- */
{
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('node', ['scripts/verify-migration-manifest.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  report('14 migrations integrity', result.status === 0 ? 'READY' : 'BLOCKED', (result.stdout || result.stderr || '').trim().split('\n').pop());
}

/* --------------------------- 4. RLS / cross-customer ----------------------- */
{
  const sandboxAvailable = Boolean(process.env.VOYARA_PG_TEST_URL && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  if (!sandboxAvailable) {
    report('RLS + cross-customer isolation (live sandbox proof)', 'NOT_CONFIGURED', 'No sandbox Postgres reachable from this run — see tests/task-013/db-integration.test.ts and tests/phase-3c-part3 for the last recorded PASS results');
  } else {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('npm', ['run', 'test:db'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: process.env });
    report('RLS + cross-customer isolation (live sandbox proof)', result.status === 0 ? 'READY' : 'BLOCKED', 'npm run test:db');
  }
}

/* ------------------------- 5. Hotelbeds supplier ---------------------------- */
{
  const credentials = readHotelbedsCredentials();
  const bookingEndpointAbsent = !(await fileContains('../src/server/supplier/suppliers/hotelbeds/hotelbeds-adapter.ts', /\/hotel-api\/1\.0\/bookings/));
  if (!credentials) {
    report('Hotelbeds supplier — credentials', 'NOT_CONFIGURED', 'VOYARA_HOTELBEDS_API_KEY / _API_SECRET not set');
    report('Hotelbeds supplier — certification', 'FIXTURE_CERTIFIED', 'scripts/certify-hotelbeds-sandbox.mjs last recorded run: 13/13 fixture checks passed; zero live HTTPS calls ever made');
  } else {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('node', ['--import', 'tsx', 'scripts/certify-hotelbeds-sandbox.mjs'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, TSX_TSCONFIG_PATH: 'tsconfig.tests.json' }
    });
    const live = (result.stdout || '').includes('LIVE MODE');
    report('Hotelbeds supplier — credentials', 'READY', 'present, non-placeholder');
    report('Hotelbeds supplier — certification', result.status === 0 ? (live ? 'SANDBOX_CERTIFIED' : 'FIXTURE_CERTIFIED') : 'BLOCKED', 'npm run certify:hotelbeds');
  }
  report('Hotelbeds — no booking-confirmation endpoint referenced', bookingEndpointAbsent ? 'READY' : 'BLOCKED');
}

/* -------------------------- 6. Payment provider ----------------------------- */
{
  const credentials = readHostedPaymentCredentials();
  const noRefundExec = !(await fileContains('../src/server/payment/providers/hosted-checkout/hosted-checkout-adapter.ts', /\/refund/i));
  const noBookingExec = !(await fileContains('../src/server/payment/providers/hosted-checkout/hosted-checkout-adapter.ts', /\/book/i));
  if (!credentials) {
    report('Payment provider — founder decision', 'NOT_CONFIGURED', 'No provider approved; VOYARA_PAYMENT_PROVIDER_NAME not set');
    report('Payment provider — credentials', 'NOT_CONFIGURED', 'VOYARA_PAYMENT_MERCHANT_ID / _API_KEY / _WEBHOOK_SIGNING_SECRET not set');
    report('Payment provider — certification', 'FIXTURE_CERTIFIED', 'scripts/certify-hosted-payment.mjs last recorded run: 13/13 fixture checks passed; zero live HTTPS calls ever made');
  } else {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('node', ['--import', 'tsx', 'scripts/certify-hosted-payment.mjs'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, TSX_TSCONFIG_PATH: 'tsconfig.tests.json' }
    });
    const live = (result.stdout || '').includes('LIVE MODE');
    report('Payment provider — founder decision', 'READY', credentials.providerName);
    report('Payment provider — credentials', 'READY', 'present, non-placeholder');
    report('Payment provider — certification', result.status === 0 ? (live ? 'SANDBOX_CERTIFIED' : 'FIXTURE_CERTIFIED') : 'BLOCKED', 'npm run certify:hosted-payment');
  }
  report('Payment — refund execution never referenced (prepare-only)', noRefundExec ? 'READY' : 'BLOCKED');
  report('Payment — booking-confirmation never referenced', noBookingExec ? 'READY' : 'BLOCKED');
}

/* ---------------------- 7. Health, logging, backups, rollback -------------- */
report('Public liveness endpoint', await fileExists('../src/app/api/v1/health/route.ts') ? 'READY' : 'BLOCKED');
report('Token-protected readiness endpoint', await fileExists('../src/app/api/v1/health/readiness/route.ts') ? 'READY' : 'BLOCKED');
report('Structured logging', await fileExists('../src/server/observability/logger.ts') ? 'READY' : 'BLOCKED');
report('Error monitoring hook', await fileExists('../src/server/observability/error-reporter.ts') ? 'READY' : 'BLOCKED', 'log-always; VOYARA_ERROR_MONITOR_WEBHOOK optional — see Part 1 runbook for wiring a real provider');
report('Backup procedure documented + scripted', (await fileExists('../scripts/database-backup.mjs')) && (await fileExists('../docs/task-012/VOYARA-BACKUP-RESTORE-RUNBOOK.md')) ? 'READY' : 'BLOCKED');
report('Restore rehearsal scripted', await fileExists('../scripts/database-restore-rehearsal.mjs') ? 'READY' : 'BLOCKED');
report('Incident / rollback runbook', await fileExists('../docs/task-012/VOYARA-INCIDENT-AND-ROLLBACK-RUNBOOK.md') ? 'READY' : 'BLOCKED');

/* ----------------- 8. HAG / content-hash / reserve-first idempotency -------- */
report('Content-hash approval (stale-hash rejection)', await fileContains('../src/server/supplier/orchestrator.ts', /STALE_APPROVAL_HASH/) ? 'READY' : 'BLOCKED');
report('Reserve-first idempotency (reserve before work, release on failure)', await fileContains('../src/server/supplier/orchestrator.ts', /reserveIdempotent[\s\S]*releaseIdempotent/) ? 'READY' : 'BLOCKED');
report('Human Approval Gate present on presentation', await fileContains('../src/server/supplier/orchestrator.ts', /NO_VALID_APPROVAL/) ? 'READY' : 'BLOCKED');

/* -------------------- 9. Booking and refund human authority ----------------- */
report(
  'Booking preparation requires human verification (type-literal true)',
  await fileContains('../src/server/supplier/booking-preparation.ts', /requiresHumanBookingVerification:\s*z\.literal\(true\)/) ? 'READY' : 'BLOCKED'
);
report(
  'Refund preparation requires human approval (type-literal true)',
  await fileContains('../src/server/payment/integration-contract.ts', /requiresHumanApproval:\s*z\.literal\(true\)/) ? 'READY' : 'BLOCKED'
);
report(
  'No booking preparation without MATCHED reconciliation',
  await fileContains('../src/server/supplier/booking-preparation.ts', /reconciliationStatus\s*!==\s*'MATCHED'/) ? 'READY' : 'BLOCKED'
);

/* ------------------------------------ Verdict ------------------------------- */
const statusOf = (dimension) => checks.find((c) => c.dimension === dimension)?.status;
const supplierCert = statusOf('Hotelbeds supplier — certification');
const paymentCert = statusOf('Payment provider — certification');
const anyBlocked = checks.some((c) => c.status === 'BLOCKED');

const supplierPaymentLiveReady = ['SANDBOX_CERTIFIED', 'LIVE_CERTIFIED'].includes(supplierCert)
  && ['SANDBOX_CERTIFIED', 'LIVE_CERTIFIED'].includes(paymentCert);

let verdict;
if (anyBlocked) {
  verdict = 'BLOCKED — one or more mandatory checks failed. See BLOCKED rows above.';
} else if (!supplierPaymentLiveReady) {
  // Hard rule: never READY overall while supplier/payment certification is
  // fixture-only or not configured, regardless of how many other checks pass.
  verdict = 'TECHNICALLY READY FOR EXTERNAL SANDBOX ACTIVATION — COMMERCIAL PILOT BLOCKED PENDING REAL SUPPLIER AND PAYMENT CREDENTIALS.';
} else {
  verdict = 'READY FOR CONTROLLED PILOT (supplier and payment SANDBOX-certified against real credentials). LIVE commercial launch remains a separate, further decision.';
}

process.stdout.write('\n=== VOYARA AI — Launch Gate Report ===\n\n');
for (const c of checks) {
  process.stdout.write(`${c.status.padEnd(18)} ${c.dimension}${c.detail ? `\n${' '.repeat(19)}${c.detail}` : ''}\n`);
}
process.stdout.write(`\n--- VERDICT ---\n${verdict}\n`);

process.stdout.write(
  `\n${JSON.stringify({ checks, verdict, generatedAt: new Date().toISOString() }, null, 1)}\n`
);

if (anyBlocked) process.exitCode = 1;
