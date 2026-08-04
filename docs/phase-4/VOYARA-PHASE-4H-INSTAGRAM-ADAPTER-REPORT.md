# VOYARA AI — Phase 4H Instagram Adapter Report

## Scope

Dual-brand (R-Travel + VOYARA) Instagram Messaging adapter, built on the existing WhatsApp/webhook/human-approval/identity-linking/audit/idempotency architecture as the design authority, per the Phase 4H brief. No live Meta credentials exist anywhere in this project; no live message has been sent; the controlled pilot has not started.

## What was built

### Database — Migration 27
`supabase/migrations/20260805090000_task027_phase4h_instagram_dual_brand.sql`, manifest-verified (27/27).

- `instagram_accounts` — one row per connected brand. `unique (brand)`, `unique (instagram_account_id)`, `unique (page_id)` — a caller can never point both brands at the same account, Page, or (structurally) claim a brand identity that contradicts stored configuration.
- `instagram_webhook_receipts` — reserve-first idempotency (`unique (event_id)`), and **append-only**: a `before update or delete` trigger (`private.reject_instagram_evidence_mutation()`) rejects any attempt to modify or delete a receipt, for any role including `service_role` — verified directly against a real PostgreSQL instance.
- Forced RLS on both tables: AAL2 staff/founder read only; no write policy for any authenticated role; anonymous has no policy at all.
- No secret (access token, app secret, or similar) is stored in either table — verified by an automated check of `information_schema.columns`.

### Application code
- `src/config/env-core.ts` — `readInstagramAppCredentials`, `readInstagramBrandCredentials`, `readInstagramCredentials`, `validateInstagramConfiguration`. Brand-scoped; a caller-supplied brand parameter selects which env vars to read and is never written back into or trusted as an override of stored configuration.
- `src/server/agents/instagram/instagram-contract.ts` — wire schemas; structurally rejects any `object` other than the literal `'instagram'`.
- `src/server/agents/instagram/instagram-signature.ts` — webhook challenge and X-Hub-Signature-256 verification (Meta's standard mechanism, shared across all Graph API products).
- `src/server/agents/instagram/instagram-adapter.ts` — one instance per brand, brand fixed at construction.
- `src/server/agents/instagram/instagram-inbound.ts` — **never calls `autoLinkIdentity`.** A first-time sender gets a new, deliberately unlinked contact; only a prior `HUMAN_CONFIRMED` action (performed by staff, out of band) produces a lookup hit for a returning sender. This is the one deliberate behavioral difference from WhatsApp's inbound handling, per the explicit requirement that Instagram identity linking must never be auto-verified.
- `src/server/agents/instagram/instagram-fixtures.ts` — six documented fixtures (first-time sender, second sender, returning sender, delivery receipt, unknown page).
- `src/app/api/v1/instagram/webhook/route.ts` — signature verified on the raw body before any parsing; brand resolved per-entry by matching the Page id against each brand's own configured Page id; an entry matching neither brand is dropped, never processed.
- `src/server/agents/channel-registry.ts` — Instagram is now a real `SANDBOX`-mode channel, gated by two independent checks: credentials must be present for the requested brand, **and** `VOYARA_INSTAGRAM_ACTIVATION_ENABLED` must be `'true'`. `LIVE` mode remains unavailable for every channel in this build, Instagram included.
- `.env.example` — full Instagram section documenting every variable's requirement/ownership/activation stage.

### Scripts
- `scripts/certify-instagram.mjs` (`npm run certify:instagram`) — 19 fixture-based checks when unconfigured (the only state possible in this project today); switches to a real, read-only `health()` probe per brand if real credentials are ever present, and still sends no message.
- `scripts/check-instagram.ts` (`npm run check:instagram`) — deployment validator distinguishing `BOTH_NOT_CONFIGURED` / `ONLY_RTRAVEL_CONFIGURED` / `ONLY_VOYARA_CONFIGURED` / `BOTH_CONFIGURED`, and exiting non-zero on malformed, partial, duplicate-ID, or brand-mismatched configuration.

### Tests
- `tests/phase-4h/instagram-adapter.test.ts` — 23 hermetic tests: signature/challenge verification, credential parsing, dual-brand isolation, the activation-switch gate, and the identity-linking guarantee.
- `tests/phase-4h/instagram-sandbox.test.ts` — 12 tests against real PostgreSQL: authorized/unauthorized RLS access (each self-seeding its own `auth.users`/`role_assignments` rows rather than assuming suite-order state), brand-uniqueness constraints, idempotent duplicate rejection, append-only immutability (UPDATE and DELETE both proven rejected), and repeatable cleanup.

## Verification results (this session, real commands, real output)

| Check | Result |
|---|---|
| TypeScript | 0 errors |
| Migration verification | 27/27 |
| Full hermetic suite | 849 pass / 0 fail / 22 skip (871 total) |
| Instagram hermetic tests (subset) | 23/23 |
| Instagram sandbox tests, isolated | 12/12, zero residue |
| Full sandbox suite (`test:db`) | 237/242 pass, 5 fail (see below) |
| Instagram certification | 19/19 |
| Production validator | All required states confirmed correct |
| Security scan | PASS |
| Production build | Succeeded; `/api/v1/instagram/webhook` present in the route manifest |
| Runtime smoke | PASS |
| Browser tests | PASS, zero CSP violations |

### The 5 remaining sandbox failures are pre-existing, not Instagram-related
Confirmed by direct evidence: all 5 are in `tests/phase-3c/password-login-sandbox.test.ts` (4 tests — require a real GoTrue Auth API `/auth/v1/signup` endpoint, which this project's local test environment does not run) and `tests/phase-4g/staff-action-authorization.test.ts` (1 test — expects `anon` to hold zero grant on `workflow_steps`; a local sandbox grant-precision gap, not a Migration 27 or production RLS issue). None reference Instagram, Migration 27, or any Phase 4H file. A shared-bootstrap correction (self-contained, local-sandbox-only seed data for canonical `FOUNDER`/`STAFF1`/`OPS` test identities) reduced the initial 43 pre-existing failures to these 5 without touching RLS, production authorization, or any individual test file's logic.

## Meta credentials, approvals, and founder actions still required

Nothing in this list has been done. All of it requires Rufat or VOYARA's Meta-facing provider — see the Activation Runbook for full detail:

- Meta Business verification (may overlap with Phase 4C's WhatsApp verification — confirm before duplicating)
- A Meta Developer App with the Instagram product added (App ID, App Secret)
- Two Instagram Business/Creator accounts (R-Travel, VOYARA), each linked to its own Facebook Page
- Long-lived access tokens per brand
- Meta App Review
- A webhook verification token, entered into Meta's dashboard
- All nine `VOYARA_INSTAGRAM_*` / `VOYARA_META_*` environment variables supplied in a real deployment environment
- `VOYARA_INSTAGRAM_ACTIVATION_ENABLED` deliberately set to `'true'` only after the above is verified — remains `false` today
- The controlled pilot itself has not started and is not covered by this report
