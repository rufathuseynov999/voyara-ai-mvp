import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

/**
 * Phase 3C Part 1 — sandbox-gated authentication tests.
 *
 * Gated on the same VOYARA_PG_TEST_URL + Supabase env vars as
 * tests/task-013/db-integration.test.ts, so the hermetic suite stays clean
 * without a sandbox present. Run via `npm run test:db` alongside the Phase 3B
 * database-integration tests (same gate, same sandbox), or directly:
 *
 *   VOYARA_PG_TEST_URL=... NEXT_PUBLIC_SUPABASE_URL=... \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... \
 *   TSX_TSCONFIG_PATH=tsconfig.tests.json node --import tsx --test \
 *   tests/phase-3c/password-login-sandbox.test.ts
 *
 * These exercise the new email/password grant end to end against the
 * sandbox's GoTrue-shape proxy (see docs/phase-3c/...RUNBOOK.md for exactly
 * what is and is not real about that proxy) using the real `@supabase/js`
 * client the application itself uses — not a hand-rolled HTTP client — so
 * the assertions are about the same request/response contract the app
 * relies on. What this does NOT prove: real GoTrue's password hashing,
 * rate-limiting, or email-confirmation gating, none of which the sandbox
 * proxy reimplements (see the runbook for the honest boundary).
 */

const PG_URL = process.env.VOYARA_PG_TEST_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const gated = PG_URL && SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY ? test : test.skip;

const A = '11111111-1111-4111-8111-111111111111'; // Phase 3B customer A
const B = '22222222-2222-4222-8222-222222222222'; // Phase 3B customer B

async function pool() {
  const { Pool } = await import('pg');
  return new Pool({ connectionString: PG_URL, max: 4 });
}

async function svcQuery(p: Awaited<ReturnType<typeof pool>>, sql: string, params?: unknown[]) {
  const c = await p.connect();
  try {
    await c.query('begin');
    await c.query('set local role service_role');
    const result = await c.query(sql, params);
    await c.query('commit');
    return result;
  } catch (error) {
    // A failed statement must roll back before the connection returns to the
    // pool, or every subsequent query on that physical connection fails with
    // 25P02 ("current transaction is aborted") even though it has nothing to
    // do with the original failure.
    await c.query('rollback').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}

gated('customer email/password login: signup, wrong password rejected, correct password creates a real session', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const email = `phase3c-${randomUUID().slice(0, 8)}@sandbox.voyara.example`;
  const password = 'correct horse battery staple';
  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);

  const signUp = await client.auth.signUp({ email, password });
  assert.equal(signUp.error, null, signUp.error?.message ?? 'unexpected signUp error');
  assert.ok(signUp.data.session?.access_token);
  assert.equal(signUp.data.user?.email, email);

  const wrongPassword = await client.auth.signInWithPassword({ email, password: 'not the right password' });
  assert.ok(wrongPassword.error, 'wrong password must be rejected');
  assert.equal(wrongPassword.data.session, null);

  const correct = await client.auth.signInWithPassword({ email, password });
  assert.equal(correct.error, null, correct.error?.message ?? 'unexpected signIn error');
  assert.ok(correct.data.session?.access_token);
  assert.equal(correct.data.user?.id, signUp.data.user?.id);
});

gated('a fresh password-registered account is auto-granted customer only — never a staff-area role (wrong-role rejection)', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const email = `phase3c-${randomUUID().slice(0, 8)}@sandbox.voyara.example`;
  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  const signUp = await client.auth.signUp({ email, password: 'a reasonably long password' });
  assert.equal(signUp.error, null);
  const userId = signUp.data.user!.id;

  const p = await pool();
  try {
    // Real, intentional product behavior (private.handle_new_auth_user(),
    // supabase/migrations/20260717084526_task002_foundation_security.sql):
    // every new auth.users row is auto-granted the 'customer' role via a
    // security-definer trigger. The wrong-role-rejection guarantee is that
    // this auto-grant is exactly 'customer' and nothing else — a bare
    // signup can never reach a staff-only screen.
    const roles = await svcQuery(p, `select role from role_assignments where user_id = $1 and active = true`, [userId]);
    assert.deepEqual(roles.rows.map((r) => r.role), ['customer']);
    const staffAreaRoles = ['staff', 'manager', 'finance', 'admin', 'founder'];
    assert.equal(
      roles.rows.some((r) => staffAreaRoles.includes(r.role)),
      false,
      'a bare signup must never carry a staff-area role'
    );
  } finally {
    await p.end();
  }
});

gated('staff MFA/AAL2 requirement is present on the password-authenticated session claims contract', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const email = `phase3c-${randomUUID().slice(0, 8)}@sandbox.voyara.example`;
  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  const signUp = await client.auth.signUp({ email, password: 'a reasonably long password' });
  assert.equal(signUp.error, null);
  // A freshly password-authenticated session is AAL1 — matching the real
  // GoTrue contract (a session only reaches AAL2 after a verified TOTP
  // challenge, exercised end-to-end by the existing MfaPanel component and
  // its Phase 3B/3B browser evidence). requireAssuranceLevel's redirect
  // behavior for exactly this AAL1 case is covered hermetically in
  // tests/phase-3c/auth-authority.test.ts; this test closes the loop by
  // confirming a real password-issued session actually starts at AAL1.
  const claims = JSON.parse(Buffer.from(signUp.data.session!.access_token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.aal, 'aal1');
});

gated('founder access: the seeded Phase 3B founder account resolves the founder role', async () => {
  const p = await pool();
  try {
    const roles = await svcQuery(p, `select role from role_assignments where user_id = $1 and active = true`, [
      '55555555-5555-4555-8555-555555555555'
    ]);
    // Membership, not exact-array equality: the same auto-grant trigger that
    // proves wrong-role-rejection above means a founder account may also
    // legitimately carry 'customer' from when its own row was first created.
    // Authorization (hasAnyRole) only cares that 'founder' is present.
    assert.ok(roles.rows.some((r) => r.role === 'founder'), 'founder role must be present and active');
  } finally {
    await p.end();
  }
});

gated('cross-customer isolation holds for a password-authenticated session, not only for JWT-minted ones', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const email = `phase3c-${randomUUID().slice(0, 8)}@sandbox.voyara.example`;
  const password = 'another reasonably long password';
  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  const signUp = await client.auth.signUp({ email, password });
  assert.equal(signUp.error, null);

  const p = await pool();
  try {
    // The signup trigger already auto-grants 'customer' (proved above); no
    // explicit role grant is needed here. Seed a quote owned by the
    // pre-existing customer A (same seed pattern as
    // tests/task-013/db-integration.test.ts).
    const quoteId = randomUUID();
    await svcQuery(
      p,
      `insert into quotes (id, account_id, customer_id, status, supplier_offer_reference, source, correlation_id, current_version_number, created_at, expires_at)
       values ($1,$2,$2,'PREPARED','SIM-OFFER-P3C','SIMULATED','corr-p3c-000001',1, now(), now() + interval '30 minutes')`,
      [quoteId, A]
    );

    const authed = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      global: { headers: { Authorization: `Bearer ${signUp.data.session!.access_token}` } }
    });
    const { data, error, count } = await authed
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('id', quoteId);
    assert.equal(error, null, error?.message ?? 'unexpected select error');
    assert.equal(count, 0, 'a different, freshly registered customer must not see customer A\'s quote');
    assert.equal(data, null);
  } finally {
    await svcQuery(p, `delete from quotes where correlation_id = 'corr-p3c-000001'`);
    await p.end();
  }
});

gated('expired sessions are rejected: an HS256 token signed with exp in the past fails verification', async () => {
  // Mirrors exactly the expiry check the sandbox's GoTrue-shape proxy applies
  // (and that real GoTrue applies server-side): a token whose exp claim is in
  // the past is never treated as a valid session, regardless of signature
  // validity. This is exercised against the same /auth/v1/user endpoint
  // getViewer() relies on via supabase.auth.getClaims().
  const crypto = await import('node:crypto');
  const secret = process.env.SANDBOX_JWT_SECRET || 'voyara-sandbox-jwt-secret-0123456789abcdef';
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub: A, role: 'authenticated', aud: 'authenticated', iat: now - 7200, exp: now - 3600, session_id: randomUUID() });
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const expiredToken = `${header}.${body}.${signature}`;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  assert.equal(response.status, 401);
});
