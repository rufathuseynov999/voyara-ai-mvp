# VOYARA AI MVP — Implementation Task 003 Report

## Authentication, Role Activation and Session Security

Date: 17 July 2026  
Repository version: `0.3.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 003 is implemented and locally verified.

The retained Next.js MVP now has a real identity and authority boundary instead of protected visual placeholders:

- Customers can register and sign in through a passwordless email link;
- staff authority can be activated only by a pending Founder-created invitation or an explicit Founder Role command;
- Roles are read from PostgreSQL and are never accepted from user-editable metadata;
- all staff routes require TOTP-backed `aal2` sessions;
- the Founder Command Center and access console require the exact `founder` Role;
- local-device and all-device logout create server-side revocation evidence before clearing the Auth session;
- Founder Role commands are same-origin, idempotent, version-bound by SHA-256, transactionally applied and immutably audited;
- Customer RLS cannot read staff invitations, command receipts or authority history.

The implementation remains a managed Supabase/Next.js monolith suitable for the approved launch budget. No microservices, Kubernetes, paid identity broker or unrelated provider was introduced.

Hosted-provider activation is not claimed. A real Supabase project, email domain/SMTP and verified Production Founder account were not supplied, so real email delivery and real TOTP ceremonies could not be executed against a hosted Auth service.

## B. Implemented scope

### B1. Customer authentication

- `/{locale}/login` now contains a functional passwordless email-link form.
- `signInWithOtp` uses `shouldCreateUser: true` for Customer self-registration.
- The message shown after submission does not disclose whether an account exists.
- `/auth/callback` exchanges the PKCE code for a cookie-backed session.
- `/auth/confirm` supports token-hash confirmation for invite, magic-link, signup and recovery templates.
- Post-authentication destinations are limited to safe local AZ/RU/EN paths.

Principal files:

- `src/components/login-form.tsx`
- `src/app/[locale]/login/page.tsx`
- `src/app/auth/callback/route.ts`
- `src/app/auth/confirm/route.ts`
- `src/server/auth/redirects.ts`

### B2. Database-authoritative Roles

- Verified JWT claims establish identity, session ID, issue time and AAL only.
- Active Roles are loaded from `public.role_assignments` under subject-owned RLS.
- The former implicit fallback to `customer` was removed.
- New ordinary Auth users receive only `customer` from the database trigger.
- A matching, unexpired staff invitation activates only its recorded staff Role.
- Staff invitations cannot request `founder`; Founder assignment requires the separate Founder Role command.

Principal files:

- `src/server/auth/claims.ts`
- `src/server/auth/roles.ts`
- `src/server/auth/viewer.ts`
- `supabase/migrations/20260717101137_task003_auth_role_session_security.sql`

### B3. Staff MFA and step-up

- Supabase TOTP enrollment and verification are enabled.
- Every route below `/{locale}/staff` requires `aal2`.
- A verified staff identity at `aal1` is redirected to `/{locale}/mfa` and then returned to the original local path.
- The MFA UI supports enrollment QR code, manual secret entry, challenge and verification.
- Abandoned unverified TOTP factors are removed before creating a replacement enrollment.
- The Founder screen independently checks the exact `founder` Role.

Principal files:

- `src/components/mfa-panel.tsx`
- `src/app/[locale]/mfa/page.tsx`
- `src/app/[locale]/staff/layout.tsx`
- `src/app/[locale]/staff/founder/page.tsx`

### B4. Invitation-only staff activation

- Founder access control creates a 72-hour database invitation before calling the Auth admin invitation API.
- Matching occurs on normalized email inside the Auth-user creation trigger.
- The resulting Role comes from the locked invitation record, not `user_metadata`.
- Invitation delivery status is server-written and contains a sanitized error code only.
- Default invite redirects are handled at `/{locale}/activate-staff`; token-hash templates can use `/auth/confirm`.

Principal files:

- `src/app/[locale]/activate-staff/page.tsx`
- `src/components/staff-activation.tsx`
- `src/app/[locale]/staff/founder/access/page.tsx`
- `src/components/founder-access-console.tsx`

### B5. Session revocation

- `public.session_revocations` rejects one exact `session_id` after local logout.
- `public.user_session_security.revoked_before` rejects every token issued before a global logout cutoff.
- Both checks run during every protected viewer resolution.
- Revocation evidence is written with the server secret before Supabase sign-out is attempted.
- Customers may read only their own revocation state and cannot write it.

Principal files:

- `src/server/auth/actions.ts`
- `src/components/access-banner.tsx`
- `src/server/auth/viewer.ts`

### B6. Founder Role commands and immutable evidence

The API `POST /api/v1/founder/access` supports:

- `staff.invite`
- `role.assign`
- `role.revoke`

Controls applied:

- verified session required;
- exact `founder` Role required;
- `aal2` required in both application and database boundaries;
- same-origin POST only;
- JSON only and 16 KiB request cap;
- idempotency key required;
- canonical payload SHA-256 stored and returned;
- database transaction applies command, receipt and audit event;
- current or last active Founder cannot be revoked;
- authority events reject update and delete operations.

The public RPC is `SECURITY INVOKER`, not `SECURITY DEFINER`. Execute privilege is revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`.

Principal files:

- `src/app/api/v1/founder/access/route.ts`
- `src/server/auth/access-contract.ts`
- `src/server/auth/access-command.ts`
- `supabase/migrations/20260717101137_task003_auth_role_session_security.sql`

## C. Database changes

Migration generated through Supabase CLI:

`supabase/migrations/20260717101137_task003_auth_role_session_security.sql`

SHA-256:

`a79df3b16db664e8d9c96d9a8685fb17ea9924119412f66f56a94dc386e0c50c`

Created tables:

| Table | Purpose | Client access |
|---|---|---|
| `public.user_session_security` | Per-user global token cutoff | own read only |
| `public.session_revocations` | Exact revoked session IDs | own read only |
| `public.staff_invitations` | Locked staff invitation authority and delivery status | none |
| `public.command_receipts` | Durable idempotency and response receipts | none |
| `public.authority_audit_events` | Immutable access-command and activation evidence | none |

Every new table has enabled and forced RLS. Locked tables have no `anon` or `authenticated` grants or policies. The existing `role_assignments` table remains client read-only and now records revocation actor and reason.

The Task 002 `private` audit/idempotency tables were preserved. Task 003 adds locked `public` counterparts because the managed Data API exposes `public` to the server secret while the `private` schema remains intentionally unexposed.

## D. Routes added or activated

| Route | Status | Authority |
|---|---|---|
| `/{locale}/login` | functional | public Auth entry |
| `/auth/callback` | functional | PKCE exchange; safe local redirect |
| `/auth/confirm` | functional | token-hash verification |
| `/{locale}/activate-staff` | functional | invitation session activation |
| `/{locale}/mfa` | functional | authenticated factor enrollment/challenge |
| `/{locale}/access-denied` | functional | authenticated but unauthorized state |
| `/{locale}/staff` | functional redirect | staff + AAL2 |
| `/{locale}/staff/founder/access` | functional | Founder + AAL2 |
| `/api/v1/founder/access` | functional | same-origin Founder + AAL2 + server secret |

## E. Verification evidence

### E1. Automated results

| Check | Result |
|---|---|
| TypeScript | PASS |
| Task 003 tests | 7/7 PASS |
| Complete Task 002–003 tests | 23/23 PASS |
| PGlite execution of both migrations | PASS |
| Founder AAL2 invitation activation | PASS |
| AAL1 Founder denial | PASS |
| non-Founder denial | PASS |
| revoked-session denial | PASS |
| last/current-Founder revocation denial | PASS |
| Customer RLS isolation | PASS |
| immutable audit trigger | PASS |
| AZ/RU/EN catalogue parity | PASS |
| AZ/EN Cyrillic-mixing guard | PASS |
| Production build | PASS; 49 pages generated, all routes compiled |
| Production standalone static assets | PASS; landing, SVG and CSS returned 200 |
| Protected runtime redirect | PASS; exact original path preserved |
| Founder API missing Origin | PASS; 403 |
| Founder API missing Auth | PASS; 401 |
| npm dependency audit | PASS; 0 vulnerabilities |
| Original Task 001 HTML audit | PASS; source hash unchanged |

### E2. Runtime HTTP evidence

- `/` returned `307` to `/az`.
- `/az` returned `200` and `<html lang="az">`.
- `/az/proposal` returned `307` to `/az/login?next=%2Faz%2Fproposal`.
- `/az/staff/founder` returned `307` to `/az/login?next=%2Faz%2Fstaff%2Ffounder`.
- a protocol-relative callback target was rejected and redirected to the local AZ login error state.
- the nonce CSP, `Permissions-Policy`, `Referrer-Policy`, `nosniff` and frame denial headers remained present.
- the prepared standalone server returned `200` for the landing page, brand SVG and generated CSS.

### E3. Original source preservation

`reference/task-001/voyara-mvp-demo-july7-10.html`

SHA-256 remains:

`dcf076419625a71676fe8029da574dfca0eb86259152c747552cb46a74f62ceb`

## F. Commands executed and exact outcomes

Key successful commands:

```text
sha256sum restored/VOYARA-AI-MVP-TASK-002.zip
  PASS: cb4616b91a4ba399e9291edb7fe95bbffd35c1eab4bbf03120cb46a74f62ceb

env HOME=/tmp/voyara-home npm_config_cache=/tmp/voyara-npm-cache npm ci --ignore-scripts
  PASS: 95 packages installed

env HOME=/tmp/voyara-home npx supabase --version
  PASS: 2.109.1

env HOME=/tmp/voyara-home npx supabase migration new task003_auth_role_session_security
  PASS: migration file created; telemetry shutdown emitted a non-schema timeout warning

npm run env:check
  PASS

npm run typecheck
  PASS

npm run test:task003
  PASS: 7 tests

npm test
  PASS: 23 tests

npm run build
  PASS: compile, TypeScript, 49-page generation, standalone preparation

npm audit --audit-level=low
  PASS: 0 vulnerabilities

npm run test:legacy
  PASS
```

Disclosed failures and corrections:

- the first `npm ci --ignore-scripts` could not create `/root/.npm`; rerunning with writable `/tmp` home/cache passed;
- the first Task 003 typecheck identified a Supabase factor-status type mismatch; the implementation was corrected to inspect `listFactors().data.all`, then passed;
- the first direct `npm start` used Next's non-standalone start path and queried blocked network-interface metadata;
- the first standalone fallback lacked a durable start wrapper/static-copy step;
- `scripts/prepare-standalone.mjs` and `scripts/start-standalone.mjs` were added, after which `npm start`, page, SVG and CSS checks passed;
- Docker CLI was unavailable and `supabase start` was denied access to `/var/run/docker.sock`; local Supabase lint and pgTAP could not run in this environment.

## G. Files created or materially changed

Created:

- `src/server/auth/access-command.ts`
- `src/server/auth/access-contract.ts`
- `src/server/auth/actions.ts`
- `src/server/auth/claims.ts`
- `src/server/auth/redirects.ts`
- `src/server/auth/request-path.ts`
- `src/lib/supabase/admin.ts`
- `src/components/login-form.tsx`
- `src/components/mfa-panel.tsx`
- `src/components/staff-activation.tsx`
- `src/components/founder-access-console.tsx`
- `src/app/auth/callback/route.ts`
- `src/app/auth/confirm/route.ts`
- `src/app/[locale]/mfa/page.tsx`
- `src/app/[locale]/activate-staff/page.tsx`
- `src/app/[locale]/access-denied/page.tsx`
- `src/app/[locale]/staff/page.tsx`
- `src/app/[locale]/staff/founder/access/page.tsx`
- `src/app/api/v1/founder/access/route.ts`
- `supabase/migrations/20260717101137_task003_auth_role_session_security.sql`
- `supabase/tests/database/002_auth_roles_sessions.test.sql`
- `tests/task-003/auth-security-contract.test.ts`
- `tests/task-003/database-auth-roles.test.ts`
- `scripts/prepare-standalone.mjs`
- `scripts/start-standalone.mjs`

Materially changed:

- `src/server/auth/viewer.ts`
- `src/app/[locale]/staff/layout.tsx`
- `src/app/[locale]/staff/founder/page.tsx`
- `src/app/[locale]/(customer)/layout.tsx`
- `src/components/access-banner.tsx`
- `src/components/screen-preview.tsx`
- `src/config/env-core.ts`
- `src/proxy.ts`
- `src/app/globals.css`
- all three locale catalogues
- `supabase/config.toml`
- `.env.example`
- `package.json`
- `package-lock.json`
- `README.md`

## H. Security and authority assessment

The largest Task 002 identity risks have been closed in source:

- no implicit Customer Role fallback;
- no staff Role from user metadata;
- no staff route at AAL1;
- no generic staff access to the Founder screen;
- no Role mutation from the browser database client;
- no long-lived JWT accepted after application-recorded logout;
- no Founder Role command without same-origin, AAL2, Founder Role and idempotency evidence;
- no editable authority audit event.

Remaining integration risks:

- hosted Supabase Auth behavior, email deliverability and real TOTP must be proven with launch credentials;
- Production SMTP/domain setup is required; new free-tier projects cannot customize default Auth email templates without custom SMTP under the June 2026 Supabase change;
- the official Docker-backed Supabase lint/pgTAP suite remains CI-only until Docker is available;
- the first Production Founder Role requires a controlled one-time bootstrap after Rufat Huseynov's Auth account is verified. The actual Production email/UUID was not invented or committed;
- the Founder Role-change console intentionally uses an exact user UUID; a searchable staff directory belongs to the later administration slice.

## I. Current Supabase guidance applied

- verified server claims use `auth.getClaims`, not untrusted `getSession` data;
- browser code receives only the publishable key;
- the secret key remains server-only;
- TOTP AAL is enforced in the server route boundary and privileged database command;
- strict logout checks exact `session_id` and a user-wide issue-time cutoff;
- RLS is enabled and forced on every exposed table;
- the privileged RPC is `SECURITY INVOKER` and service-role-only;
- user-editable metadata is excluded from authorization.

Reference guidance reviewed:

- https://supabase.com/docs/guides/auth/auth-mfa/totp
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/auth/server-side/nextjs
- https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier

## J. Exact next implementation task

**IMPLEMENTATION TASK 004 — Travel Request Vertical Slice**

Recommended boundary:

1. create versioned `travel_requests` and immutable submission records in PostgreSQL;
2. replace the AI Trip Wizard placeholder with complete AZ/RU/EN input and consent states;
3. implement authenticated Customer draft/save/submit with idempotency and validation;
4. enforce Customer ownership RLS and staff AAL2 read/claim authority;
5. preserve distinct `DRAFT`, `SUBMITTED`, `AI_PREPARATION` and `HUMAN_REVIEW` states;
6. create attributable lifecycle events without creating a Quotation, Approval, Payment or Booking prematurely;
7. prove Customer-to-Customer isolation, invalid-transition denial, localisation and responsive behavior.

This is the smallest coherent next vertical slice and remains inside the approved launch budget.
