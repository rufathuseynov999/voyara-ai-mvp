import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { accessCommandInputSchema } from '@/server/auth/access-contract';
import { parseVerifiedViewerClaims } from '@/server/auth/claims';
import { safeLocalPath, safeLocalePath } from '@/server/auth/redirects';

test('verified claims require a subject, session and issue time and never derive Roles from metadata', () => {
  const claims = parseVerifiedViewerClaims({
    sub: '10000000-0000-4000-8000-000000000001',
    session_id: '20000000-0000-4000-8000-000000000001',
    iat: 1_700_000_000,
    user_metadata: { role: 'founder' }
  });
  assert.deepEqual(claims, {
    subject: '10000000-0000-4000-8000-000000000001',
    sessionId: '20000000-0000-4000-8000-000000000001',
    assuranceLevel: 'aal1',
    issuedAt: 1_700_000_000,
    email: undefined
  });
  assert.equal(parseVerifiedViewerClaims({ sub: claims?.subject, iat: 1_700_000_000 }), null);
});

test('post-authentication redirects reject external, protocol-relative, cross-locale and backslash paths', () => {
  assert.equal(safeLocalPath('/az/proposal?trip=1'), '/az/proposal?trip=1');
  assert.equal(safeLocalPath('//attacker.example/path'), '/az');
  assert.equal(safeLocalPath('/\\attacker.example/path'), '/az');
  assert.equal(safeLocalPath('https://attacker.example'), '/az');
  assert.equal(safeLocalPath('/unknown/path'), '/az');
  assert.equal(safeLocalePath('/ru/proposal', 'az'), '/az');
});

test('staff invitation accepts only non-Founder staff Roles while explicit Role commands remain typed', () => {
  assert.equal(
    accessCommandInputSchema.safeParse({
      action: 'staff.invite',
      email: 'operator@voyara.example',
      role: 'finance',
      locale: 'az'
    }).success,
    true
  );
  assert.equal(
    accessCommandInputSchema.safeParse({
      action: 'staff.invite',
      email: 'operator@voyara.example',
      role: 'founder',
      locale: 'az'
    }).success,
    false
  );
  assert.equal(
    accessCommandInputSchema.safeParse({
      action: 'role.assign',
      userId: '10000000-0000-4000-8000-000000000001',
      role: 'staff',
      reason: 'Approved launch operator'
    }).success,
    true
  );
});

test('Task 003 source contracts enforce AAL2, same-origin commands, strict revocation and no Customer fallback Role', async () => {
  const [viewer, staffLayout, founderPage, accessRoute, logout, config, migration] = await Promise.all([
    readFile('src/server/auth/viewer.ts', 'utf8'),
    readFile('src/app/[locale]/staff/layout.tsx', 'utf8'),
    readFile('src/app/[locale]/staff/founder/page.tsx', 'utf8'),
    readFile('src/app/api/v1/founder/access/route.ts', 'utf8'),
    readFile('src/server/auth/actions.ts', 'utf8'),
    readFile('supabase/config.toml', 'utf8'),
    readFile('supabase/migrations/20260717101137_task003_auth_role_session_security.sql', 'utf8')
  ]);

  assert.match(viewer, /auth\.getClaims\(\)/);
  assert.doesNotMatch(viewer, /getSession\(/);
  assert.doesNotMatch(viewer, /roles\.length > 0 \? roles : \['customer'\]/);
  assert.match(viewer, /session_revocations/);
  assert.match(viewer, /revoked_before/);
  assert.match(staffLayout, /requireAssuranceLevel\(locale, viewer, 'aal2'/);
  assert.match(founderPage, /requireViewerRole\(locale, \['founder'\]/);
  assert.match(accessRoute, /isSameOrigin\(request\)/);
  assert.match(accessRoute, /idempotency-key/);
  assert.match(logout, /session_revocations/);
  assert.match(logout, /user_session_security/);
  assert.match(config, /\[auth\.mfa\.totp\][\s\S]*enroll_enabled = true[\s\S]*verify_enabled = true/);
  assert.match(config, /otp_expiry = 600/);
  assert.match(
    migration,
    /create or replace function public\.execute_access_command\([\s\S]*?language plpgsql[\s\S]*?security invoker/
  );
  assert.match(migration, /authority_audit_events_immutable/);
  assert.match(migration, /revoke all on function public\.execute_access_command[\s\S]*from authenticated/);
});
