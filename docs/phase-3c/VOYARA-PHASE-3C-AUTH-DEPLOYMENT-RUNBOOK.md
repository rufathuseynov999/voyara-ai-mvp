# VOYARA AI — Phase 3C Part 1 Runbook: Production Authentication & Environment Readiness

Scope: real Supabase (GoTrue) authentication readiness, environment configuration for local/preview/production, Vercel deployment, observability, and the migration/backup/rollback procedure. **Simulation-only** for suppliers and payments throughout — this runbook does not activate anything live.

---

## 1. Environments

Three environments are supported end to end, classified automatically from Vercel's own `VERCEL_ENV` variable (never set this by hand):

| Environment | `VERCEL_ENV` | Supabase project | Demo mode | Strictness |
|---|---|---|---|---|
| **Local** | unset | none, or your own local/sandbox Postgres | permitted (`VOYARA_DEMO_MODE=true`) | base validation only |
| **Preview** | `preview` | a dedicated **staging** project — never production | forbidden | HTTPS + TLS DB + no placeholders |
| **Production** | `production` | the production project | forbidden | Preview's checks + release id + dedicated health token + no debug logging |

Templates: `.env.local.example`, `.env.preview.example`, `.env.production.example` at the repo root. Copy the relevant one, fill in real values, and never commit the filled-in file (all three are already covered by `.gitignore`'s `.env*` pattern — verify this before your first commit if you fork the template names).

Validate any environment before deploying:

```bash
npm run env:check        # base validation (local)
npm run check:preview    # strict preview validation
npm run launch:check     # strict production validation
```

Each fails closed with a specific, actionable error message (missing field, wrong protocol, placeholder text, etc.) rather than a generic failure.

---

## 2. Supabase project setup (one-time, per project — staging and production each need this)

Perform these steps in the Supabase dashboard for **each** project (staging for Preview, production for Production). This is the "real GoTrue" side of Phase 3C — the application code already speaks to whatever Supabase project you point it at; nothing here requires further code changes.

1. **Create the project.** Note the project URL and, under Project Settings → API, the publishable (`sb_publishable_...`) and secret (`sb_secret_...`) keys.
2. **Apply all 14 migrations**, in order, from `supabase/migrations/`. See §5 below for the exact procedure and how it was verified.
3. **Auth → URL Configuration**: set the Site URL to the environment's app origin (e.g. `https://app.voyara.ai` for production) and add every redirect URL the app uses: `https://<origin>/auth/callback`. Preview deployments get a new URL per branch — either add a wildcard pattern if your Supabase plan supports it, or add each preview URL as it's created.
4. **Auth → Providers → Email**: enable Email provider. Both sign-in methods the app supports are covered by this one provider:
   - **Magic link** (OTP) — enabled by default.
   - **Password** — under Email provider settings, ensure "Enable email provider" is on; password sign-in/sign-up work automatically once it is. Set a minimum password length of at least 8 in the dashboard to match the client-side check in `LoginForm` (`passwordTooShort`).
5. **Auth → Email Templates**: customize the confirmation/magic-link templates before launch (the defaults work but carry Supabase's own branding). This is optional for Preview, recommended for Production.
6. **Auth → Multi-Factor**: ensure TOTP is enabled (it is by default in current Supabase projects). No further configuration needed — `MfaPanel` calls `supabase.auth.mfa.enroll/challenge/verify` directly; AAL2 is reached the moment a user verifies a TOTP code, exactly as tested in `tests/phase-3c/auth-authority.test.ts`.
7. **Database → Connection string**: copy the pooled connection string for `DATABASE_URL`, and confirm it includes `sslmode=require` or stricter — both the Preview and Production validators reject a connection string without enforced TLS.
8. **Never** use the production project for Preview. A staging project costs nothing extra on Supabase's free tier and is the only thing standing between a broken preview build and real customer data.

### Roles in this system

The application's role vocabulary (`src/server/auth/roles.ts`) is `customer | staff | manager | finance | admin | founder`. Where this runbook (and the calling instructions for this phase) say "operations," that maps to the `staff`/`manager` roles collectively — there is no separate `operations` role in the schema, and none was added in Phase 3C (no new architecture). `staffAreaRoles` = `staff, manager, finance, admin, founder`.

Every new `auth.users` row — however it was created (magic link, password sign-up, or an invite) — is auto-granted the **`customer`** role by a database trigger (`private.handle_new_auth_user()`, `supabase/migrations/20260717084526_task002_foundation_security.sql`) and nothing more. No self-registration path can ever reach a staff-only screen; staff and founder roles are granted explicitly via the founder-only invitation flow (`/activate-staff`, already existing).

---

## 3. MFA / AAL2

Every staff-area route (`staffAreaRoles`) additionally requires AAL2 via `requireAssuranceLevel()`. A session that hasn't completed a TOTP challenge is redirected to `/mfa` with the original destination preserved in `?next=`. This is unchanged Phase 3 baseline behavior; Phase 3C added no new MFA code, only tests proving the redirect contract (`tests/phase-3c/auth-authority.test.ts`) and confirming that a freshly password-authenticated session genuinely starts at AAL1 (`tests/phase-3c/password-login-sandbox.test.ts`), matching the real GoTrue contract.

**Founder action required:** the very first founder account for a new Supabase project has no invitation to redeem (there's nothing to invite them *from*). Use the existing founder-bootstrap procedure documented in `docs/task-012/VOYARA-FOUNDER-BOOTSTRAP-RUNBOOK.md` — this Phase 3C runbook does not change that procedure, it only depends on it.

---

## 4. Vercel deployment

`vercel.json` at the repo root declares the framework and build/install commands; it deliberately does not declare headers (the existing `src/proxy.ts` middleware sets CSP, HSTS, and the rest of the security header set at request time — duplicating them in `vercel.json` risks the two layers drifting out of sync).

**Project setup:**
1. Import the repository into a new Vercel project. Framework preset: Next.js (auto-detected; `vercel.json` confirms it explicitly).
2. Under Project Settings → Environment Variables, add every variable from `.env.preview.example` scoped to **Preview**, and every variable from `.env.production.example` scoped to **Production**. Do not scope any secret to "All Environments" — Preview and Production must use different Supabase projects and therefore different keys.
3. `VOYARA_RELEASE_ID` (Production only): set this to `$VERCEL_GIT_COMMIT_SHA` — Vercel exposes this automatically as a system environment variable; you can reference it directly as the value of `VOYARA_RELEASE_ID` in the dashboard, or wire a build step to copy it. Do not hand-write a release id that can drift from what's actually deployed.
4. `VOYARA_HEALTH_TOKEN` (Production only): generate with `openssl rand -hex 32`, store as a Vercel secret, and give the same value to whatever external uptime monitor calls `/api/v1/health/readiness`.

**Health checks**, both already implemented (Phase 3 baseline, unchanged in Phase 3C):
- `GET /api/v1/health` — public liveness, no auth, minimal payload (never leaks database or config state — enforced by `tests/task-012/security-and-launch-contract.test.ts`).
- `GET /api/v1/health/readiness` — token-protected (`Authorization: Bearer <VOYARA_HEALTH_TOKEN>`, `timingSafeEqual` comparison), returns `503` unless environment validation *and* a live database probe both pass. Point your uptime monitor / load balancer health check here for Production, not at the liveness endpoint.

---

## 5. Structured logging and error monitoring

`src/server/observability/logger.ts` is a small leveled JSON logger (`debug < info < warn < error`, controlled by `VOYARA_LOG_LEVEL`) that writes single-line JSON to stdout/stderr — compatible with Vercel's log drains and any standard log aggregator (Datadog, Better Stack, Axiom, etc.) without further code changes. Common secret-shaped context keys (`secret`, `token`, `password`, `authorization`, `apikey`, `jwt`, `cookie`) are redacted automatically before a log line is written.

`src/server/observability/error-reporter.ts` provides `reportError(error, context)`, wired into the two genuine unexpected-failure paths in the orchestration service (never into expected authority rejections like stale-hash or cross-customer denial — those must never page anyone) and into the readiness health check's warn-level paths. It always logs structured; if `VOYARA_ERROR_MONITOR_WEBHOOK` is set, it also POSTs a small redacted JSON summary there, fire-and-forget, never blocking or throwing.

**Founder action required — this is genuinely external and cannot be done from this environment:** no error-monitoring *provider* (Sentry, Better Stack, etc.) is wired in. To activate one:
1. Create an account with your chosen provider and obtain an HTTPS ingestion webhook URL (most providers offer a generic webhook or inbound-integration endpoint; some may need a small serverless adapter in front of their native SDK format — check the provider's docs).
2. Set `VOYARA_ERROR_MONITOR_WEBHOOK` to that URL in Vercel's environment variables (Preview and/or Production).
3. No code change is required — the hook activates the moment the variable is present.

---

## 6. Migration procedure

The 14 migrations under `supabase/migrations/` are applied in filename order and are immutable once applied (`npm run db:migrations:verify` checks each file's SHA-256 against `supabase/migrations/manifest.sha256` — any edit to an already-shipped migration fails this check on purpose).

**Applying to a fresh Supabase project** (staging or production):
```bash
# Via the Supabase CLI, from the repo root, linked to the target project:
supabase link --project-ref <project-ref>
supabase db push
```
Or apply each file in order with `psql` against the project's connection string if you're not using the Supabase CLI. Either way, run `npm run db:migrations:verify` afterward against the repo (this checks the *files*, not the live database — it's a supply-chain integrity check, not a schema-drift check) and confirm manually in the Supabase dashboard's Table Editor that all 14 tables/policies exist as expected.

**Adding a new migration going forward:** create a new timestamped file, never edit an existing one. Re-run `npm run db:migrations:verify` — it will fail loudly if an old file was touched by mistake.

This exact procedure — 14 files, in order, into a clean database — was rehearsed and verified in Phase 3B Part 4 against a real local PostgreSQL 16 sandbox (not Supabase Cloud, since this environment has no network access to supabase.com; the SQL itself is identical regardless of host). All 14 applied cleanly; RLS came up forced on every phase table; every constraint (`UNIQUE quote_versions(quote_id,version_number)`, `UNIQUE payment_webhook_receipts(event_id)`, `PRIMARY KEY orchestration_idempotency_keys(key)`) verified present.

---

## 7. Backup and rollback

Backup/restore procedures were already established in Phase 3 baseline work and are unchanged by Phase 3C: see `docs/task-012/VOYARA-BACKUP-RESTORE-RUNBOOK.md` for the backup schedule and restore rehearsal procedure (`npm run db:backup`, `npm run db:restore:rehearsal`), and `docs/task-012/VOYARA-INCIDENT-AND-ROLLBACK-RUNBOOK.md` for incident response and application rollback via Vercel's deployment history (redeploy a prior build; database rollback is a separate, migration-aware procedure documented there — never just "restore a backup" blindly on a live system with newer application code depending on newer schema).

Phase 3C adds nothing new here beyond ensuring the auth tables (`role_assignments`, `session_revocations`, `user_session_security`, and the new `orchestration_idempotency_keys`/`orchestration_audit_events` from Phase 3B) are included in the same backup scope as every other table — they already are, since the backup procedure operates at the database level, not table-by-table.

---

## 8. What Phase 3C Part 1 did and did not change

**Added:** environment classification (local/preview/production) and preview validation; per-environment `.env` templates; `vercel.json`; structured logging; an error-monitoring hook (not a live provider); email/password sign-in and self-registration UI (alongside the existing, unchanged magic-link flow); tests for all of the above.

**Explicitly preserved, unmodified:** PostgreSQL authority and forced RLS; the Human Approval Gate and content-hash approval; reserve-first idempotency; the existing MFA/AAL2 TOTP flow; the existing staff invitation flow; simulation-only supplier and payment behavior (`VOYARA_SUPPLIER_MODE`/`VOYARA_PAYMENT_MODE` remain `SIMULATION` in every template in this runbook).

**Not done, and out of scope for this phase:** live supplier or payment provider connection; live booking confirmation; wiring an actual error-monitoring account (external action, §5); creating the real Supabase Cloud projects themselves (external action, §2 — this environment has no network path to supabase.com to do it directly).

---

## 9. Founder action checklist (external, cannot be completed from this environment)

- [ ] Create the **staging** Supabase project (Preview) and the **production** Supabase project — separate projects, separate keys.
- [ ] Apply the 14 migrations to each (§6).
- [ ] Configure Auth → URL Configuration, Email provider, Email templates, and confirm TOTP MFA is enabled for each project (§2).
- [ ] Run the founder-bootstrap procedure once against the production project (`docs/task-012/VOYARA-FOUNDER-BOOTSTRAP-RUNBOOK.md`) to create the first founder account.
- [ ] Create the Vercel project, link the repository, and populate environment variables per §4 (two full sets: Preview and Production).
- [ ] Generate `VOYARA_HEALTH_TOKEN` and `VOYARA_WEBHOOK_SECRET` (`openssl rand -hex 32` each) for Production; point an uptime monitor at `/api/v1/health/readiness` with that token.
- [ ] (Optional) Create an error-monitoring provider account and set `VOYARA_ERROR_MONITOR_WEBHOOK` (§5).
- [ ] Confirm `npm run launch:check` passes against the real Production environment variables before the first production deploy.
