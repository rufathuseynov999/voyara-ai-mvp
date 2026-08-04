# VOYARA AI MVP

This repository contains the implementation through the final Task 012 for the Azerbaijan-first VOYARA AI MVP and the preserved Task 001 eight-screen reference.

## Current implementation boundary

Implemented through Task 012:

- Next.js 16 App Router and installable PWA foundation;
- Azerbaijani-default `/az`, Russian `/ru` and English `/en` route trees;
- addressable references for all eight approved MVP screens;
- approved personal and corporate prices only;
- passwordless email-link Customer registration and sign-in with PKCE callback handling;
- invitation-only staff activation, with the intended Role resolved from PostgreSQL rather than user metadata;
- protected Customer and staff routes that preserve the requested destination and fail closed;
- mandatory TOTP AAL2 for every staff route and explicit Founder-only protection for the Founder Command Center;
- database-authoritative Role assignment/revocation through a same-origin, idempotent Founder command endpoint;
- strict per-session and all-session application revocation checked on every protected request;
- immutable authority evidence, locked command receipts and Customer-isolated session state;
- a complete AZ/RU/EN Travel Request form on the retained AI Trip Wizard screen;
- authenticated Customer draft/save/submit commands with validation, same-origin enforcement, bounded request bodies, idempotency and rate controls;
- PostgreSQL-authoritative `DRAFT`, `SUBMITTED`, `AI_PREPARATION` and `HUMAN_REVIEW` states;
- immutable request versions, exact SHA-256-bound submission evidence and attributable lifecycle events;
- Customer ownership RLS plus AAL2 staff read/claim and ordered preparation transitions;
- a server-backed Travel Request queue on the retained CRM screen;
- a PostgreSQL-authoritative commercial state machine from human-authored quotation draft through exact-version Approval, publication and Customer Acceptance;
- immutable quotation versions with canonical payloads, SHA-256 binding, internal economics and constrained risk flags;
- Founder-only AAL2 Approval/rejection and publication as the safe launch policy, with the active policy stored separately from immutable policy versions;
- a Customer-safe published Proposal snapshot that never exposes internal cost, margin, risk flags or Approval rationale;
- explicit Customer Acceptance bound to the same published version and hash; viewing alone never creates Acceptance;
- immutable commercial decisions, publications, Acceptances, Work Receipts and authority audit events;
- service-role-only same-origin commercial command endpoints with bounded bodies, strict schemas, idempotency, session revocation and rate controls;
- live AZ/RU/EN Proposal and Human Approval Queue screens, while retaining the existing visual direction;
- an exact Payment Request derived only from an accepted quotation version, hash and Customer Acceptance;
- separate immutable Customer evidence and Finance-detection records that never become verified Payment automatically;
- AAL2 human Finance review and exact-evidence Verification or rejection, with full-amount matching enforced independently by PostgreSQL;
- Finance/Founder-only funds allocation bound to the exact human Verification record and hash;
- deterministic financial-readiness evidence that stops at `READY_FOR_BOOKING` and creates no Booking authority;
- a live AZ/RU/EN Customer Payment screen and supporting AAL2 Finance queue at `/{locale}/staff/finance`;
- manual bank/card reference evidence as the launch fallback, with no invented paid-provider dependency;
- one Booking aggregate created only from exact Customer Acceptance plus exact `READY_FOR_BOOKING` evidence;
- accountable AAL2 human Supplier execution as a separate immutable canonical record and SHA-256 hash;
- immutable Supplier Confirmation evidence bound to the exact execution identifier and hash;
- a live AAL2 Booking operations queue at `/{locale}/staff/bookings` with no autonomous Supplier action;
- a customer-safe AZ/RU/EN Trip Room Booking-progress view that exposes no Supplier references or internal notes;
- explicit separation of Booking creation, Supplier execution and Supplier Confirmation;
- a separate Manager/Admin/Founder AAL2 Booking Verification review bound to the exact Booking, Supplier execution and Supplier Confirmation identifiers and SHA-256 hashes;
- enforced verifier independence from the human who executed the Supplier action or captured the Supplier Confirmation;
- immutable human VERIFY or REJECT decisions with a four-part verification checklist and attributable rationale;
- append-only corrected Supplier Confirmation versions after rejection, linked to both superseded evidence and the exact rejection decision without editing history;
- immutable versioned Voucher drafts bound to the exact verified Booking, quotation, execution, Supplier Confirmation and Verification evidence;
- optional disclosure that a human-prepared Voucher used AI assistance, without granting AI Booking Verification or Voucher-issue authority;
- separate Founder/Admin/Manager AAL2 Voucher issuance of one exact version and hash;
- Customer-isolated delivery of only the exact issued Voucher version inside the retained AZ/RU/EN Trip Room; drafts and internal Verification evidence remain private;
- authenticated Customer Support cases opened only from the exact issued Voucher in the retained Trip Room;
- immutable SHA-256-linked Support event history with exact case, previous-event and actor attribution;
- accountable AAL2 Staff/Manager/Admin/Founder ownership, priority and monotonic escalation controls at `/{locale}/staff/support`;
- strict separation of Customer-visible updates from internal operations notes and Supplier evidence;
- explicit human-only resolution and closure that cannot alter Payment, Booking, Voucher, cancellation, compensation or Refund authority;
- one active-case launch UI per Booking, manual operations fallback and no added messaging/provider cost;
- a live AZ/RU/EN Founder Command Center backed only by service-role PostgreSQL views after Founder and AAL2 enforcement;
- a human-decision queue, critical Payment/Booking/Support Exceptions, operational pipeline, accountable workload and source-freshness panels;
- six separately defined financial concepts: available Booking-backed GBV, booked planned Gross Profit, operational receivables and allocated exposure, plus explicitly unavailable cash and recognised revenue;
- explicit unavailable states for Membership performance, AI activity/cost, cash ledger, revenue ledger and system monitoring rather than invented launch metrics;
- security-invoker Founder views with no authenticated browser grants and no command or AI authority;
- the retained CRM screen extended with a PostgreSQL-derived Customer journey that reads, but never overrides, exact Travel Request, commercial, Payment and Booking states;
- accountable CRM tasks bound to one exact Travel Request version and SHA-256, with owner, target due date and an immutable event chain;
- AAL2 human task creation, claiming and state updates, with Manager/Admin/Founder-only reassignment and cancellation;
- the eight Founder-approved personal and corporate Membership prices stored as immutable versioned PostgreSQL catalogue records with exact SHA-256 evidence;
- a read-only Membership administration view that contains no invented benefits, rewards, fees or cancellation terms;
- a bounded manual Supplier registry with immutable configuration versions, Manager/Admin/Founder authority and no credential, integration or Booking fields;
- explicit administration states for Founder-only Role control, unconfigured Approval limits and Refunds blocked pending Founder-approved policy;
- current Supabase publishable/secret key separation and SSR session-refresh adapter;
- a modular Node/TypeScript BOS authority and idempotency skeleton;
- generated PostgreSQL migration with profiles, Role assignments, private idempotency and append-only audit-event tables;
- RLS ownership policies, least-privilege grants, synthetic local seed and pgTAP tests;
- nonce-based Content Security Policy and defensive browser headers;
- TypeScript, localisation, authority, environment, fixture and executable RLS tests;
- GitHub Actions gates for application and real local-Supabase tests.
- Production-only validation that rejects HTTP/reserved origins, placeholder credentials, Demo authority, debug logging, non-TLS database connections and reused health secrets;
- a minimal public liveness endpoint plus a constant-time Bearer-token-protected deep-readiness endpoint that checks exact Production configuration and PostgreSQL availability without returning provider errors;
- hardened CSP/resource headers and Production HSTS;
- a final PostgreSQL migration that denies implicit schema creation and browser function execution while preserving only explicitly granted read/RPC authority;
- an immutable SHA-256 manifest for all 11 ordered migrations;
- automated credential, fixture, public-data and client-authority scanning;
- safe-by-default logical backup and staging-only restore-rehearsal tooling;
- mobile/desktop real-browser checks for the eight retained screens plus AZ/RU/EN, keyboard, landmark, label and overflow checks;
- CI gates for audit, migration integrity, Production-like no-seed migration reset, pgTAP and Playwright Chromium;
- Founder bootstrap, launch, backup/restore and incident/forward-fix runbooks.

External activation inputs or deliberately deferred domains:

- Production Supabase project linkage, domain or credentials have not been supplied in this workspace;
- Production SMTP/domain configuration and the first verified Founder account bootstrap;
- Credit or Refund business flows;
- AI-provider quotation drafting; Task 005 quotations are explicitly human-authored;
- external Supplier, Payment, CRM, messaging or AI-provider integrations;
- automated Support-channel ingestion, private Support attachments, cancellation, compensation or Refund workflows;
- authoritative cash/bank, revenue-recognition, Membership-performance, AI-cost and infrastructure-monitoring ledgers; the Founder view marks each unavailable until implemented.

No visual placeholder is presented as Production business authority.

## Preserved source

The latest recovered source is retained outside the public application at:

`reference/task-001/voyara-mvp-demo-july7-10.html`

SHA-256:

`dcf076419625a71676fe8029da574dfca0eb86259152c747552cb46a74f62ceb`

Run its deterministic audit with:

```bash
npm run test:legacy
```

## Requirements

- Node.js 20.9 or newer; Node 24 is used in CI.
- npm 11.
- Docker only when running the complete local Supabase stack and pgTAP suite.
- Playwright Chromium for the real-browser launch suite.

## Start the application

Public routes work without credentials and protected routes redirect to sign-in:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`; `/` redirects to Azerbaijani at `/az`.

For a local-only protected-screen preview with synthetic AAL2 authority:

```bash
VOYARA_DEMO_MODE=true VOYARA_DEMO_ROLE=founder npm run dev
```

Production validation rejects demo mode.

## Supabase local development

The configuration enables passwordless email signup for Customers and TOTP MFA. Anonymous, SMS and social sign-in remain disabled. A self-created account receives only `customer`; staff authority is possible only through a pending Founder-created invitation or an audited Founder Role command. Realtime, analytics, vectors and Edge Functions remain disabled. Storage is reserved for a later private-document slice.

```bash
npm run db:start
npm run db:lint
npm run db:test
```

The repository pins Supabase CLI 2.109.1. `supabase test db` requires Docker. The default `npm test` suite executes all 11 migrations through PGlite so ownership, invitation activation, AAL2, Role, session revocation, Travel Request isolation, commercial exact-hash authority, Payment authority separation, Booking Verification, private Voucher delivery, Support visibility/ownership, administration authority, final default-privilege hardening, immutable evidence and transition denials can be verified without Docker.

For Production, configure the exact site/redirect URLs, a launch-grade SMTP sender and the verified Founder account before enabling staff invitations. The synthetic `founder@voyara.example` seed is local-only and must never be promoted.

Use the variable names in `.env.example`. Browser code receives only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; `SUPABASE_SECRET_KEY` and `DATABASE_URL` remain server-only.

## Verification

```bash
npm run env:check
npm run security:scan
npm run db:migrations:verify
npm run typecheck
npm test
npm run build
npm run test:runtime
npm audit --audit-level=low
```

`npm run verify` runs type-checking, security and migration-integrity gates, all Task 002–012 tests, the Production build and a standalone runtime smoke check. `npm run verify:full` additionally runs the real-browser suite.

`npm run launch:check` is the strict Production environment gate. It is expected to fail until real domain, Supabase, database, health-token and release values are supplied.

Task 003-specific checks are available with:

```bash
npm run test:task003
```

Task 004-specific checks are available with:

```bash
npm run test:task004
```

Task 005-specific checks are available with:

```bash
npm run test:task005
```

Task 006-specific checks are available with:

```bash
npm run test:task006
```

Task 007-specific checks are available with:

```bash
npm run test:task007
```

Task 008-specific checks are available with:

```bash
npm run test:task008
```

Task 009-specific checks are available with:

```bash
npm run test:task009
```

Task 010-specific checks are available with:

```bash
npm run test:task010
```

Task 011-specific checks are available with:

```bash
npm run test:task011
```

Task 012-specific and browser checks are available with:

```bash
npm run test:task012
npx playwright install chromium
npm run test:browser
```

Backup and restore commands are safe plans unless their explicit execution confirmations are provided:

```bash
npm run db:backup
npm run db:restore:rehearsal
```

## Addressable screen map

| Screen | Route |
|---|---|
| Public Landing | `/{locale}` |
| AI Trip Wizard | `/{locale}/trip-wizard` |
| Proposal | `/{locale}/proposal` |
| Human Approval Queue | `/{locale}/staff/approvals` |
| Founder Command Center | `/{locale}/staff/founder` |
| Trip Room | `/{locale}/trip-room` |
| Payment and Confirmation | `/{locale}/payment` |
| CRM Pipeline | `/{locale}/staff/crm` |

Supporting routes include `/{locale}/login`, `/{locale}/mfa`, `/{locale}/activate-staff`, `/{locale}/access-denied`, the Founder-only `/{locale}/staff/founder/access` console, the AAL2 Finance queue at `/{locale}/staff/finance`, the AAL2 Booking operations queue at `/{locale}/staff/bookings`, and the AAL2 Support and exception queue at `/{locale}/staff/support`.

Replace `{locale}` with `az`, `ru` or `en`.

## Implementation evidence

- Task 001 controls: `docs/task-001/`
- Task 002 report: `docs/task-002/VOYARA-TASK-002-IMPLEMENTATION-REPORT.md`
- Task 003 report: `docs/task-003/VOYARA-TASK-003-IMPLEMENTATION-REPORT.md`
- Task 004 report: `docs/task-004/VOYARA-TASK-004-IMPLEMENTATION-REPORT.md`
- Task 005 report: `docs/task-005/VOYARA-TASK-005-IMPLEMENTATION-REPORT.md`
- Task 006 report: `docs/task-006/VOYARA-TASK-006-IMPLEMENTATION-REPORT.md`
- Task 007 report: `docs/task-007/VOYARA-TASK-007-IMPLEMENTATION-REPORT.md`
- Task 008 report: `docs/task-008/VOYARA-TASK-008-IMPLEMENTATION-REPORT.md`
- Task 009 report: `docs/task-009/VOYARA-TASK-009-IMPLEMENTATION-REPORT.md`
- Task 010 report: `docs/task-010/VOYARA-TASK-010-IMPLEMENTATION-REPORT.md`
- Task 011 report: `docs/task-011/VOYARA-TASK-011-IMPLEMENTATION-REPORT.md`
- Task 012 launch controls and final report: `docs/task-012/`

The numbered implementation sequence closes after Task 012. Production activation is an operational go/no-go procedure using the Task 012 checklist, not a Task 013 architecture or implementation document.
