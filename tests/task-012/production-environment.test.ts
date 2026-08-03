import assert from 'node:assert/strict';
import test from 'node:test';
import { readHealthToken, validateProductionEnvironment } from '@/config/env-core';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_APP_URL: 'https://app.voyara.az',
  NEXT_PUBLIC_SUPABASE_URL: 'https://voyaralaunch.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(40)}`,
  SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(48)}`,
  DATABASE_URL: 'postgresql://voyara:strong-password@db.voyaralaunch.supabase.co:5432/postgres?sslmode=require',
  VOYARA_DEMO_MODE: 'false',
  VOYARA_DEMO_ROLE: 'founder',
  VOYARA_LOG_LEVEL: 'info',
  VOYARA_HEALTH_TOKEN: `health_${'h'.repeat(48)}`,
  VOYARA_RELEASE_ID: 'release-0.12.0-abc1234'
};

test('Production environment accepts only HTTPS, TLS database and dedicated release controls', () => {
  const parsed = validateProductionEnvironment(validEnvironment);
  assert.equal(parsed.appUrl, validEnvironment.NEXT_PUBLIC_APP_URL);
  assert.equal(parsed.demoMode, false);
  assert.equal(parsed.releaseId, 'release-0.12.0-abc1234');
  assert.equal(readHealthToken(validEnvironment), validEnvironment.VOYARA_HEALTH_TOKEN);
});

test('Production validation rejects local, insecure, placeholder and demo configurations', () => {
  const variants: Array<[Partial<NodeJS.ProcessEnv>, RegExp]> = [
    [{ NEXT_PUBLIC_APP_URL: 'http://voyara.az' }, /HTTPS origin/],
    [{ NEXT_PUBLIC_APP_URL: 'https://example.com' }, /HTTPS origin/],
    [{ NEXT_PUBLIC_SUPABASE_URL: 'http://voyaralaunch.supabase.co' }, /Supabase URL/],
    [{ DATABASE_URL: 'postgresql://voyara:password@db.voyara.az/postgres' }, /enforce TLS/],
    [{ VOYARA_DEMO_MODE: 'true' }, /VOYARA_DEMO_MODE cannot/i],
    [{ VOYARA_LOG_LEVEL: 'debug' }, /Debug logging/],
    [{ VOYARA_HEALTH_TOKEN: 'replace_me_with_a_long_placeholder_token' }, /placeholders/],
    [{ VOYARA_HEALTH_TOKEN: validEnvironment.SUPABASE_SECRET_KEY }, /dedicated secret/],
    [{ NODE_ENV: 'development' }, /NODE_ENV/]
  ];
  for (const [change, expected] of variants) {
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment, ...change }), expected);
  }
});

test('Production validation rejects any public-prefixed server authority', () => {
  assert.throws(
    () => validateProductionEnvironment({
      ...validEnvironment,
      NEXT_PUBLIC_SERVICE_ROLE_KEY: `sb_secret_${'x'.repeat(40)}`
    }),
    /Server-only variables use a public prefix/
  );
});
