import assert from 'node:assert/strict';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import test from 'node:test';
import { requireAssuranceLevel } from '@/server/auth/viewer';
import { appRoles, customerAreaRoles, hasAnyRole, staffAreaRoles, type AppRole } from '@/server/auth/roles';
import type { Viewer } from '@/server/auth/viewer';

/**
 * Phase 3C Part 1 — hermetic auth authority tests.
 *
 * These exercise the real, unmodified functions the application uses for
 * every protected route (`hasAnyRole`, `requireAssuranceLevel`) directly —
 * no mocking, no database, no server. `requireViewerRole` is not exercised
 * here because it calls `getViewer()` internally (which needs a live request
 * context); its redirect behavior for an unauthenticated/wrong-role viewer is
 * already proven end-to-end by `npm run test:runtime` against real protected
 * routes, so it is not duplicated here.
 *
 * Cross-customer isolation and session revocation at the data layer are
 * already covered by tests/task-003/database-auth-roles.test.ts (RLS on
 * user_session_security, staff_invitations, command_receipts,
 * authority_audit_events) and by tests/task-013/db-integration.test.ts's RLS
 * matrix against real PostgreSQL; this file does not repeat those proofs.
 */

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    roles: ['customer'],
    source: 'supabase',
    assuranceLevel: 'aal1',
    sessionId: '00000000-0000-4000-8000-000000000098',
    issuedAt: Math.floor(Date.now() / 1000),
    ...overrides
  };
}

function redirectTarget(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (isRedirectError(error)) {
      // digest shape: "NEXT_REDIRECT;<type>;<url>;<status>"
      return error.digest.split(';')[2];
    }
    throw error;
  }
  throw new Error('expected a redirect');
}

/* ------------------------------ wrong-role rejection ------------------------------ */

test('wrong-role rejection: a customer-only role set does not satisfy a staff-area requirement', () => {
  assert.equal(hasAnyRole(['customer'], staffAreaRoles), false);
});

test('wrong-role rejection: an empty role set (no active role_assignments row) satisfies nothing', () => {
  for (const required of [customerAreaRoles, staffAreaRoles, ['founder'] as AppRole[]]) {
    assert.equal(hasAnyRole([], required), false);
  }
});

/* -------------------------------- founder access -------------------------------- */

test('founder access: the founder role satisfies every staff-area requirement', () => {
  assert.equal(hasAnyRole(['founder'], staffAreaRoles), true);
  assert.equal(hasAnyRole(['founder'], ['founder']), true);
});

test('founder access: founder is included in the full customer-area role superset', () => {
  assert.ok(customerAreaRoles.includes('founder'));
  assert.deepEqual([...customerAreaRoles].sort(), [...appRoles].sort());
});

/* ------------------------------- staff area membership ------------------------------- */

test('staff area membership matches the declared role set exactly (staff, manager, finance, admin, founder)', () => {
  assert.deepEqual([...staffAreaRoles].sort(), ['admin', 'finance', 'founder', 'manager', 'staff'].sort());
  assert.equal(staffAreaRoles.includes('customer'), false);
});

/* ------------------------------- staff MFA / AAL2 requirement ------------------------------- */

test('staff MFA/AAL2 requirement: an AAL1 session is redirected to /mfa with the requested path preserved', () => {
  const target = redirectTarget(() =>
    requireAssuranceLevel('en', viewer({ roles: ['founder'], assuranceLevel: 'aal1' }), 'aal2', '/en/staff/founder')
  );
  assert.match(target, /^\/en\/mfa\?next=/);
  assert.equal(decodeURIComponent(target.split('next=')[1]), '/en/staff/founder');
});

test('staff MFA/AAL2 requirement: an AAL2 session passes through unchanged (no redirect)', () => {
  const input = viewer({ roles: ['founder'], assuranceLevel: 'aal2' });
  const result = requireAssuranceLevel('en', input, 'aal2', '/en/staff/founder');
  assert.deepEqual(result, input);
});

test('staff MFA/AAL2 requirement: an AAL1 requirement never redirects, regardless of the session level', () => {
  const aal1Input = viewer({ assuranceLevel: 'aal1' });
  const aal2Input = viewer({ assuranceLevel: 'aal2' });
  assert.deepEqual(requireAssuranceLevel('az', aal1Input, 'aal1', '/az/trip-wizard'), aal1Input);
  assert.deepEqual(requireAssuranceLevel('az', aal2Input, 'aal1', '/az/trip-wizard'), aal2Input);
});

test('staff MFA/AAL2 requirement: the /mfa redirect is locale-correct for each supported locale', () => {
  for (const locale of ['az', 'ru', 'en'] as const) {
    const target = redirectTarget(() =>
      requireAssuranceLevel(locale, viewer({ assuranceLevel: 'aal1' }), 'aal2', `/${locale}/staff/crm`)
    );
    assert.match(target, new RegExp(`^/${locale}/mfa\\?next=`));
  }
});
