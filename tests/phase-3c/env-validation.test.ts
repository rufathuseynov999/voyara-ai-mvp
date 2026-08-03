import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readDeploymentEnvironment,
  validateDeploymentEnvironment,
  validatePreviewEnvironment,
  validateProductionEnvironment,
  validateServerEnvironment
} from '@/config/env-core';

/**
 * Phase 3C Part 1 — environment validation tests.
 *
 * Pure-function tests against the env-core validators; no server, no
 * database, no network. Each test builds a minimal valid base environment
 * object and mutates exactly one field to prove the validator rejects it —
 * this proves each field is actually load-bearing, not just present.
 */

const validLocal: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local0000000000000000',
  SUPABASE_SECRET_KEY: 'sb_secret_local00000000000000000000',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  VOYARA_DEMO_MODE: 'true',
  VOYARA_DEMO_ROLE: 'founder',
  VOYARA_LOG_LEVEL: 'debug'
};

const validPreview: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_APP_URL: 'https://feature-branch.vercel.app',
  NEXT_PUBLIC_SUPABASE_URL: 'https://staging-project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_staging0000000000000',
  SUPABASE_SECRET_KEY: 'sb_secret_staging00000000000000000',
  DATABASE_URL: 'postgresql://postgres:pw@db.staging-project.supabase.co:5432/postgres?sslmode=require',
  VOYARA_DEMO_MODE: 'false',
  VOYARA_LOG_LEVEL: 'info'
};

const validProduction: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_APP_URL: 'https://app.voyara.ai',
  NEXT_PUBLIC_SUPABASE_URL: 'https://prod-project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prodKeyAAAAAAAAAAAAA',
  SUPABASE_SECRET_KEY: 'sb_secret_prodKeyAAAAAAAAAAAAAAAAAAA',
  DATABASE_URL: 'postgresql://postgres:pw@db.prod-project.supabase.co:5432/postgres?sslmode=verify-full',
  VOYARA_DEMO_MODE: 'false',
  VOYARA_LOG_LEVEL: 'warn',
  VOYARA_HEALTH_TOKEN: 'health-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  VOYARA_RELEASE_ID: 'a1b2c3d4e5f6'
};

/* --------------------- Missing required environment variables --------------------- */

test('missing required environment variables fail closed, one field at a time', () => {
  const requiredFields: (keyof typeof validLocal)[] = [
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'DATABASE_URL'
  ];
  for (const field of requiredFields) {
    const broken = { ...validLocal };
    delete broken[field];
    assert.throws(() => validateServerEnvironment(broken), Error, `missing ${field} must throw`);
  }
  // The positive case: nothing missing must not throw.
  assert.doesNotThrow(() => validateServerEnvironment(validLocal));
});

test('a server-only value exposed under a NEXT_PUBLIC_ prefix fails closed', () => {
  const broken = { ...validLocal, NEXT_PUBLIC_DATABASE_URL: validLocal.DATABASE_URL };
  assert.throws(() => validateServerEnvironment(broken), /Server-only variables use a public prefix/);
});

test('demo mode is forbidden once NODE_ENV is production, even with an otherwise valid config', () => {
  const broken: NodeJS.ProcessEnv = { ...validLocal, NODE_ENV: 'production' };
  assert.throws(() => validateServerEnvironment(broken), /VOYARA_DEMO_MODE cannot be enabled in Production/);
});

/* ------------------------- Local / Preview / Production dispatch ------------------------- */

test('local / preview / production are classified from VERCEL_ENV, defaulting to local', () => {
  assert.equal(readDeploymentEnvironment(validLocal), 'local');
  assert.equal(readDeploymentEnvironment(validPreview), 'preview');
  assert.equal(readDeploymentEnvironment(validProduction), 'production');
  assert.equal(readDeploymentEnvironment({ NODE_ENV: 'test' }), 'local');
});

test('validateDeploymentEnvironment dispatches to the matching validator for each environment', () => {
  assert.equal(validateDeploymentEnvironment(validLocal).environment, 'local');
  assert.equal(validateDeploymentEnvironment(validPreview).environment, 'preview');
  assert.equal(validateDeploymentEnvironment(validProduction).environment, 'production');
});

test('preview validation accepts a fully valid preview configuration', () => {
  assert.doesNotThrow(() => validatePreviewEnvironment(validPreview));
});

test('preview validation rejects a config not actually marked VERCEL_ENV=preview', () => {
  const broken = { ...validPreview, VERCEL_ENV: undefined };
  assert.throws(() => validatePreviewEnvironment(broken), /VERCEL_ENV must be "preview"/);
});

test('preview validation rejects demo mode', () => {
  const broken = { ...validPreview, VOYARA_DEMO_MODE: 'true' };
  // Demo mode is also rejected by the base server validator once NODE_ENV is
  // production (as Preview's NODE_ENV is), so either message is acceptable —
  // what matters is that the combination is refused.
  assert.throws(() => validatePreviewEnvironment(broken));
});

test('preview validation rejects a non-HTTPS application origin', () => {
  const broken = { ...validPreview, NEXT_PUBLIC_APP_URL: 'http://feature-branch.vercel.app' };
  assert.throws(() => validatePreviewEnvironment(broken), /Preview application URL must be a non-reserved HTTPS origin/);
});

test('preview validation rejects a database URL without enforced TLS', () => {
  const broken = { ...validPreview, DATABASE_URL: 'postgresql://postgres:pw@db.staging-project.supabase.co:5432/postgres' };
  assert.throws(() => validatePreviewEnvironment(broken), /Preview database URL must enforce TLS/);
});

test('preview validation rejects placeholder-shaped credentials', () => {
  const broken = { ...validPreview, SUPABASE_SECRET_KEY: 'sb_secret_replace_me_00000000000000' };
  assert.throws(() => validatePreviewEnvironment(broken), /Preview credentials cannot contain placeholders/);
});

test('production validation accepts a fully valid production configuration', () => {
  assert.doesNotThrow(() => validateProductionEnvironment(validProduction));
});

test('production validation rejects a preview-shaped config (wrong VERCEL_ENV marker alone is not enough — NODE_ENV governs)', () => {
  // Production validation is governed by NODE_ENV, not VERCEL_ENV, and is
  // strictly stricter than preview (requires health token + release id).
  const previewShaped: NodeJS.ProcessEnv = { ...validPreview, NODE_ENV: 'production' };
  assert.throws(() => validateProductionEnvironment(previewShaped), /Zod|required|Invalid|healthToken|releaseId/);
});

test('production validation rejects a health token that collides with a Supabase key', () => {
  const broken = { ...validProduction, VOYARA_HEALTH_TOKEN: validProduction.SUPABASE_SECRET_KEY };
  assert.throws(() => validateProductionEnvironment(broken), /Health monitoring must use a dedicated secret token/);
});

test('production validation rejects a placeholder release id', () => {
  const broken = { ...validProduction, VOYARA_RELEASE_ID: 'replace_with_release_identifier' };
  assert.throws(() => validateProductionEnvironment(broken), /placeholders/);
});

test('production validation rejects debug log level', () => {
  const broken = { ...validProduction, VOYARA_LOG_LEVEL: 'debug' };
  assert.throws(() => validateProductionEnvironment(broken), /Debug logging is forbidden/);
});
