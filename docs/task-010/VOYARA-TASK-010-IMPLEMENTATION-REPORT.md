# VOYARA AI MVP — Implementation Task 010 Report

## Founder Command Center Authoritative Read Model

Date: 18 July 2026  
Repository version: `0.10.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 010 is implemented and locally verified.

The retained Founder Command Center at `/{locale}/staff/founder` is no longer a visual simulation. It now reads six service-only PostgreSQL views after the existing staff shell enforces an authenticated Founder Role and AAL2. The page has no write command, no client-derived business value and no AI authority.

The delivered read model prioritises:

- exact human decisions awaiting action;
- six separately defined financial concepts;
- the current commercial and operational pipeline;
- Payment, Booking and Support Exceptions;
- accountable and unassigned team workload;
- source availability and freshness;
- direct links to the existing human work queues and Founder access console.

The implementation deliberately does not invent unavailable metrics. Cash, recognised revenue, Membership performance, AI activity/cost and infrastructure monitoring are visibly unavailable because the repository has no authoritative ledger for them. Zero is displayed only when an implemented PostgreSQL source is authoritatively empty.

No analytics platform, data warehouse, microservice, scheduled job, provider integration or paid dependency was added. The approved launch budget remains realistic for this slice.

Production activation is not claimed. Production Supabase linkage, secrets, SMTP/domain configuration, verified Founder bootstrap and infrastructure monitoring were not supplied.

## B. Implemented scope

### B1. Retained Founder screen

The existing screen number, title, typography, card direction and access-control link were retained. The generic `ScreenPreview` was replaced only on the Founder route with a live server component.

The screen now contains:

1. data-state, authority and generated-at evidence;
2. a priority-ordered human decision queue;
3. six financial definition cards;
4. an ordered operational-stage view;
5. critical Exception, team workload and source-freshness panels;
6. the existing Founder-only staff access control link;
7. a clear read-only authority boundary.

The screen renders a complete unavailable state if the server connection or any required fixed-shape view fails. It never silently converts a query failure into a zero business value.

### B2. Financial metric contract

| Concept | Availability | Exact Task 010 basis | Important qualification |
|---|---|---|---|
| Cash | Unavailable | no cash or bank-balance ledger exists | Payment evidence, Verification or allocation is not cash balance |
| Recognised revenue | Unavailable | no revenue-recognition ledger exists | GBV and Payment are not recognised revenue |
| Gross Booking Value | Available | sum of `bookings.amount_minor` for authoritatively created Bookings | cancellation/refund states are not implemented yet |
| Booked planned Gross Profit | Available | sum of `commercial.grossProfitMinor` from each Booking's exact Quotation version and SHA-256 | planned commercial GP, not realised accounting GP |
| Operational receivables | Available | open Payment Requests in `REQUESTED`, `EVIDENCE_RECEIVED`, `UNDER_REVIEW` or `EVIDENCE_REJECTED` | operational collection queue, not an accounting AR ledger |
| Allocated-funds exposure | Available | immutable fund allocations with no Booking or without `VOUCHER_ISSUED` | operational exposure definition, not cash balance or expense recognition |

All available monetary values are in integer AZN minor units in PostgreSQL and formatted only for display on the server-rendered page.

### B3. Human decision queue

The view derives actionable rows only from existing domain authority:

- exact Quotation `PENDING_APPROVAL` → Commercial Approval queue;
- Payment `EVIDENCE_RECEIVED` → human review;
- Payment `UNDER_REVIEW` → human Verification;
- Payment `VERIFIED` → funds allocation;
- Payment `ALLOCATED` → financial-readiness evaluation;
- Booking `SUPPLIER_CONFIRMED` or `UNDER_VERIFICATION` → Booking Verification;
- Booking `VOUCHER_DRAFTED` → human Voucher issue;
- active P1 or Founder-escalated Support → Support queue.

Each row exposes a bounded reference, state, waiting time, optional exact amount and link to the existing human work queue. Selecting a link does not itself execute a decision.

### B4. Critical Exceptions

The launch read model reports only delivered, evidence-backed Exception states:

- rejected Payment evidence;
- rejected Booking Verification;
- active P1 or Founder-escalated Support.

No SLA breach threshold, forecast, anomaly score or risk probability was invented.

### B5. Operational pipeline

Ten ordered rows cover Travel Request intake, commercial Draft, Commercial Approval, published Proposal, Customer Acceptance, pending Payment work, financially ready Payment, Booking operations, Booking/Voucher Verification and issued Voucher.

The interface explicitly describes this as a cross-domain operational stage snapshot, not a conversion funnel or revenue report. Counts belong to different authoritative aggregates and are not presented as one cohort.

### B6. Workload and freshness

Workload combines active delivered work from:

- Human Review Travel Requests;
- Payment review/allocation/readiness states;
- Booking operations and Verification states;
- active Support cases.

It keeps assigned people separate from an explicit unassigned queue. No productivity target, SLA or performance rating was introduced.

Source freshness reports record count and latest authoritative change for Travel Request, commercial, Payment, Booking and Support. It explicitly marks Membership, AI activity/cost, cash ledger, revenue ledger and system monitoring as `NOT_IMPLEMENTED`.

### B7. Localisation, responsive behaviour and accessibility

All Founder Command Center copy has exact Azerbaijani, Russian and English key parity. Azerbaijani remains the default. Operational database status codes are rendered as machine-readable codes; surrounding interface copy remains fully localised.

The retained design system was extended with responsive metric, decision, pipeline and operations grids. At the existing breakpoints, three-column sections collapse to two columns and then one column; queue actions become full-width on mobile.

The implementation uses:

- a single `main` landmark with `id="main-content"`;
- labelled sections and headings;
- a labelled data-authority strip;
- semantic lists and definition lists;
- a live status region for read-model failure;
- real links to human queues rather than inert controls;
- no client-side state, browser storage or browser-computed metrics.

## C. Database and security changes

Migration:

`supabase/migrations/20260718090140_task010_founder_command_center_read_model.sql`

SHA-256:

`f0a25dd8d509a6a38273cfe2455d4b1f54481a15fcd9494a43bfc9d58a06d41f`

Created views:

| View | Purpose |
|---|---|
| `founder_financial_metrics` | six distinct financial definitions and explicit availability |
| `founder_decision_queue` | exact human work awaiting action |
| `founder_critical_exceptions` | active delivered Payment, Booking and Support Exceptions |
| `founder_pipeline_summary` | ordered current operational-stage counts and relevant amounts |
| `founder_team_workload` | accountable and unassigned active work by delivered domain |
| `founder_source_freshness` | implemented/no-record/not-implemented source state and freshness |

Every view is `security_invoker = true`. `PUBLIC`, `anon` and `authenticated` have no privilege. Only `service_role` receives `SELECT`. This follows current Supabase guidance that views otherwise use owner permissions by default, and that explicit table/view grants remain a separate control from RLS: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Securing your data](https://supabase.com/docs/guides/database/secure-data).

The server query also requires all of the following before creating the admin client:

- a real Supabase viewer rather than demo authority;
- Founder Role;
- AAL2;
- complete valid fixed-shape results from all six views.

The Founder page remains under the existing staff layout, which independently enforces AAL2. The query repeats the Role/assurance checks as defence in depth.

No function, RPC, webhook, command route, write grant or browser credential was introduced. The read model cannot approve, verify, allocate, book, issue or refund anything.

## D. Files created

- `src/server/founder/contract.ts`
- `src/server/founder/queries.ts`
- `src/components/founder-command-center.tsx`
- `supabase/migrations/20260718090140_task010_founder_command_center_read_model.sql`
- `tests/task-010/database-founder-read-model.test.ts`
- `tests/task-010/security-and-ui-contract.test.ts`
- `supabase/tests/database/009_founder_read_model.test.sql`
- `docs/task-010/VOYARA-TASK-010-IMPLEMENTATION-REPORT.md`

## E. Files changed

- `src/app/[locale]/staff/founder/page.tsx`
- `src/app/globals.css`
- `src/i18n/messages/az.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/en.json`
- `scripts/runtime-smoke.mjs`
- `package.json`
- `package-lock.json`
- `README.md`

No approved price, Membership benefit, revenue rule, human Approval boundary or existing domain state machine was changed.

## F. Verification evidence

### F1. Automated results

| Check | Result |
|---|---|
| Task 010 focused tests | 6/6 PASS |
| complete Task 002–010 tests | 88/88 PASS |
| execution of all nine migrations in PGlite | PASS |
| financial definition calculations with synthetic data | PASS |
| Cash and revenue without ledgers | explicit `UNAVAILABLE`, PASS |
| exact booked Quotation GP join | PASS, including negative planned GP |
| authenticated view access | DENIED |
| service Role read access | PASS |
| security-invoker property on all six views | PASS |
| human decision and critical Exception derivation | PASS |
| Membership/AI/system unavailable states | PASS |
| AZ/RU/EN catalogue parity | PASS |
| responsive/accessibility source contracts | PASS |
| no command, browser-state or AI authority | PASS |
| Production build | PASS; 68 pages generated and all routes compiled |
| standalone runtime smoke | PASS, including protected Founder route |
| live development rendering | PASS; AZ, RU and EN Founder pages each returned HTTP 200 under synthetic Founder demo authority |
| npm dependency audit | PASS; 0 vulnerabilities |
| environment validation | expected fail without credentials; PASS with reserved synthetic values |
| secret/data scan | PASS; synthetic test/CI placeholders only; only `.env.example` exists |
| original Task 001 HTML audit | PASS; preserved legacy findings unchanged |

The final `npm run verify` result was exit code 0: TypeScript passed, 88 tests passed with zero failures, the Production build compiled, 68 pages generated and the standalone runtime smoke passed.

### F2. Native Supabase boundary

`supabase/tests/database/009_founder_read_model.test.sql` contains 22 pgTAP assertions for the six views, security-invoker behavior, browser denial, service-only reads and explicit unavailable domains.

Docker is not installed and no local PostgreSQL/Supabase stack is running in this environment. `supabase db lint` and `supabase test db` reached the local connection attempt and returned `LegacyDbConnectError: Failed to connect`. Native advisor/pgTAP results are therefore not claimed. All nine migrations were applied in PGlite and the behavioral database suite passed. Existing CI remains responsible for Docker-backed native Supabase gates.

### F3. Browser boundary

The installed Playwright package had no Chromium binary in this environment, so a screenshot/real-browser run was not claimed. The responsive and accessibility source contract passed, the page rendered successfully through the live Next.js development server in all three locales, the Production build passed and the standalone HTTP smoke passed. Real supported-browser and WCAG evidence remains part of Task 012 Production hardening.

## G. Principal commands executed and outcomes

```text
env HOME=/tmp/voyara-task010-home SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration new --help
  PASS: current CLI syntax reviewed

env HOME=/tmp/voyara-task010-home SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration new task010_founder_command_center_read_model
  PASS: migration created through the pinned Supabase CLI

npm test  # baseline after empty/new migration
  PASS: 82/82 historical tests and all nine migrations

npm run typecheck
  PASS

npm run test:task010
  PASS: 6 tests, 0 failed

npm run verify
  PASS: typecheck, 88/88 tests, Production build, 68 generated pages and runtime smoke

npm run env:check
  EXPECTED FAIL-CLOSED: app URL, Supabase URL, publishable key, secret key and database URL are absent

env ...reserved synthetic values... npm run env:check
  FIRST PROBE REJECTED: deliberately synthetic secret was below the enforced minimum length
  FINAL RESULT PASS: corrected reserved synthetic publishable/secret/database separation accepted; demo mode disabled

npm audit --audit-level=low
  PASS: 0 vulnerabilities

npm run test:legacy
  PASS: preserved eight-screen reference audit

env HOME=/tmp/voyara-task010-home SUPABASE_TELEMETRY_DISABLED=1 npm run db:lint
  NOT EXECUTED AGAINST POSTGRES: local database connection unavailable

env HOME=/tmp/voyara-task010-home SUPABASE_TELEMETRY_DISABLED=1 npm run db:test
  NOT EXECUTED AGAINST POSTGRES: local database connection unavailable

docker --version
  NOT EXECUTED: Docker command is not installed

live Next.js development-server render probe
  PASS: /az/staff/founder, /ru/staff/founder and /en/staff/founder returned 200 and the Founder component rendered

Playwright Chromium launch
  NOT EXECUTED: browser binary is not installed

sha256sum supabase/migrations/20260718090140_task010_founder_command_center_read_model.sql
  PASS: f0a25dd8d509a6a38273cfe2455d4b1f54481a15fcd9494a43bfc9d58a06d41f
```

A quick exploratory PGlite one-liner initially failed because shell expansion changed SQL dollar quotes. The normal repository test harness was then used; it applied all nine migrations and passed. No Product code or database rule was weakened.

A stale Next development lock left by an interrupted exploratory process was moved to `/tmp` and the live render probe was rerun on a clean port. All three locales then rendered successfully.

No real secret, Production personal data or external provider credential was supplied or written.

## H. Classification summary

| Area | Classification | Evidence |
|---|---|---|
| retained Founder screen | EXISTS_AND_ACCEPTED | live server-backed page in AZ/RU/EN |
| Founder access control | EXISTS_AND_ACCEPTED | Founder Role + staff-layout AAL2 + query defence in depth |
| human decision queue | EXISTS_AND_ACCEPTED | exact delivered domain states and queue links |
| GBV | EXISTS_AND_ACCEPTED | Booking-backed exact minor-unit view |
| booked planned Gross Profit | EXISTS_AND_ACCEPTED | exact Quotation version/hash join, explicitly not realised GP |
| operational receivables | EXISTS_AND_ACCEPTED | exact bounded Payment status definition |
| allocated-funds exposure | EXISTS_AND_ACCEPTED | exact fund-allocation/Voucher status definition |
| cash | EXISTS_NEEDS_BACKEND | no cash/bank ledger; visibly unavailable |
| recognised revenue | EXISTS_NEEDS_BACKEND | no recognition ledger; visibly unavailable |
| Membership performance | DEFERRED | no approved subscription authority/table yet |
| AI activity and cost | DEFERRED | no AI provider or cost ledger yet |
| infrastructure system monitoring | MISSING_LAUNCH_CRITICAL | production monitoring belongs to Task 012 |
| native Supabase validation | EXISTS_NEEDS_TESTING | pgTAP written; Docker-backed execution remains CI/Production work |
| real-browser/WCAG validation | EXISTS_NEEDS_TESTING | Task 012 Production-hardening exit evidence |

## I. Risks and deliberate limits

1. GBV currently has no cancellation/refund adjustment because those workflows do not exist. The definition states this explicitly.
2. Planned GP is not realised accounting GP and must never be relabelled as such.
3. Operational receivables are not an accounting accounts-receivable ledger.
4. Allocated exposure is not cash, revenue or recognised cost.
5. The read model uses the service Role and therefore depends on the application Founder+AAL2 gate. Both the page and query enforce it, while direct browser grants are denied.
6. Production monitoring, backup/restore evidence, supported-browser evidence and live provider configuration remain outstanding.

## J. Immediate next implementation task

Proceed to **Implementation Task 011 — Administration launch slice** from the actual repository:

- harden the retained CRM into accountable administration rather than a new enterprise suite;
- add only launch-critical owner/task/state administration supported by approved rules;
- keep approved Membership prices immutable and avoid inventing Membership benefits;
- keep Supplier configuration manual and bounded;
- preserve Founder-only Role authority;
- do not implement Refund Approval/execution until the Founder supplies the missing policy decisions already recorded in the Task 001 decision register.

Task 011 should not alter the Task 010 metric definitions or begin Production-hardening work reserved for Task 012.

After Task 010, two tasks remain in the ratified roadmap: Task 011 Administration and Task 012 Production hardening.
