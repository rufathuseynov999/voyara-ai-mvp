# VOYARA AI MVP — Implementation Task 004 Report

## Travel Request Vertical Slice

Date: 17 July 2026  
Repository version: `0.4.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 004 is implemented and locally verified.

The retained AI Trip Wizard and CRM Pipeline screens now form a real Customer-to-staff Travel Request vertical slice:

- a verified Customer can save and submit a validated AZ/RU/EN request;
- every save creates a new immutable request-content version with a canonical SHA-256 hash;
- one immutable submission binds the Customer confirmation to one exact request version and the same hash;
- PostgreSQL owns the distinct `DRAFT`, `SUBMITTED`, `AI_PREPARATION` and `HUMAN_REVIEW` states;
- Customers can read only their own requests, versions, submissions and lifecycle events;
- staff reads require an active staff-area Role and an `aal2` session;
- an `aal2` staff member can claim a submitted request and perform only the ordered pre-commercial state transitions;
- same-origin, bounded, validated, idempotent and rate-controlled server commands apply every write;
- the lifecycle explicitly stops before Quotation, Approval, Proposal publication, Customer Acceptance, Payment, Booking or Voucher authority.

No AI provider call is made. Moving a record into `AI_PREPARATION` records `providerCalled: false`; this is a queue state, not a claim that an AI job ran. Human-created preparation remains a valid manual launch fallback.

The implementation remains one Next.js application, one managed Supabase/PostgreSQL boundary and one modular server command layer. No microservice, Kubernetes cluster, message broker or paid provider was added. The approved Azerbaijan launch budget remains realistic at this scope.

Hosted-provider activation is not claimed. A real Supabase project and Production credentials were not provided, so hosted RLS, Auth email delivery, real TOTP sessions and Production data behavior were not exercised.

## B. Implemented scope

### B1. Retained AI Trip Wizard

`/{locale}/trip-wizard` retains the existing screen identity and visual direction while replacing the placeholder state cards with a functional request interface.

Implemented fields:

- destination;
- departure city;
- departure and return dates;
- adults, children and infants;
- total budget in AZN;
- trip purpose;
- preferences and notes;
- accuracy confirmation;
- acknowledgement of processing for request preparation and human review.

Controls:

- Customer Auth session and active `customer` Role required before rendering stored data;
- Zod and PostgreSQL validation;
- strict object schemas reject unknown fields;
- exact ISO date validation and reverse-date denial;
- bounded travellers, budget, notes and request-body size;
- manual draft save and exact submission;
- localized status and confirmation states;
- no statement that submission creates a Proposal, charge, Payment, Booking or Voucher.

Principal files:

- `src/app/[locale]/trip-wizard/page.tsx`
- `src/components/travel-request-form.tsx`
- `src/server/travel-request/contract.ts`
- `src/app/api/v1/travel-requests/route.ts`

### B2. Immutable request versions and submission evidence

The mutable `travel_requests` row is only the current lifecycle pointer. Customer content is stored separately in append-only `travel_request_versions`.

Each version records:

- request and Customer identifiers;
- monotonically increasing version number;
- complete canonical payload;
- interface locale;
- SHA-256 payload hash;
- creating actor and timestamp.

The submission table has a composite foreign key to `(travel_request_id, version_number, payload_hash)`. This database constraint prevents a submission from being attached to a different hash or version. Versions, submissions and lifecycle events all reject update and delete operations.

One partial unique index permits only one active draft per Customer. A retry without a request identifier reuses that draft instead of silently creating another active draft.

Principal file:

- `supabase/migrations/20260717104504_task004_travel_request_vertical_slice.sql`

### B3. Authoritative lifecycle

Permitted state progression:

```text
DRAFT
→ SUBMITTED
→ AI_PREPARATION
→ HUMAN_REVIEW
```

Rules:

- only a Customer owner can save or submit;
- only `DRAFT` content is editable through a new immutable version;
- a submitted request cannot be edited in place;
- a draft cannot be claimed;
- an active staff-area Role and `aal2` are required for every staff command;
- a request must be claimed before it can enter preparation;
- only the assigned staff actor may perform preparation transitions;
- `HUMAN_REVIEW` cannot be entered before `AI_PREPARATION`;
- no transition to a commercial, financial or booking state exists in Task 004.

Every accepted command writes an attributable lifecycle event with command correlation, actor, session, AAL, old state, new state, exact request version or command hash, and timestamp.

### B4. Staff CRM queue

`/{locale}/staff/crm` now reads submitted Travel Requests through authenticated RLS instead of synthetic CRM cards.

The queue displays:

- localized lifecycle status;
- destination and dates;
- traveller count;
- budget in AZN;
- localized purpose;
- Customer and assigned-operator identifiers;
- notes;
- the current version hash;
- only the action valid for the current actor and state.

The enclosing staff layout and the page both enforce an active staff Role and `aal2`. Staff writes still pass through the service-secret-only transaction function; the browser receives no write grant and no secret.

Principal files:

- `src/app/[locale]/staff/crm/page.tsx`
- `src/components/travel-request-queue.tsx`
- `src/app/api/v1/staff/travel-requests/route.ts`
- `src/server/travel-request/queries.ts`

### B5. Command and abuse controls

Customer and staff endpoints apply:

- same-origin POST enforcement;
- JSON content type;
- exact byte limits before JSON parsing;
- verified session and database-authoritative Role checks;
- AAL2 on staff commands;
- strict Zod validation;
- required idempotency key;
- canonical command and content hashes;
- server-secret-only RPC execution;
- session revocation and all-session cutoff checks inside PostgreSQL;
- 30 accepted Customer commands per hour;
- 5 accepted Customer submissions per 24 hours;
- 120 accepted staff commands per hour.

An exact replay returns the original receipt. Reusing an idempotency key with a changed payload returns `IDEMPOTENCY_CONFLICT` without applying another version or transition.

## C. Database changes

Migration generated through Supabase CLI:

`supabase/migrations/20260717104504_task004_travel_request_vertical_slice.sql`

SHA-256:

`e8501677e83574d5c8d86146a3115c3deccba22ade57322654c80cc8fd8c05d0`

Created tables:

| Table | Purpose | Client authority |
|---|---|---|
| `public.travel_requests` | Current owner, state, version and assignment pointer | owner read or AAL2 staff read |
| `public.travel_request_versions` | Immutable exact Customer content versions | owner read or AAL2 staff read |
| `public.travel_request_submissions` | Immutable exact-version/hash submission evidence | owner read or AAL2 staff read |
| `public.travel_request_lifecycle_events` | Immutable attributable lifecycle history | owner read or AAL2 staff read |
| `public.travel_request_command_receipts` | Locked idempotency and response receipts | no client access |

Every Task 004 table has enabled and forced RLS. Authenticated users receive read-only table grants where a policy exists. No browser role receives insert, update, delete or RPC execution authority.

The public RPC `execute_travel_request_command` is `SECURITY INVOKER`. Execute authority is revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`.

## D. Routes added or activated

| Route | Status | Authority |
|---|---|---|
| `/{locale}/trip-wizard` | functional | public sign-in gate; active Customer Role for form and data |
| `/{locale}/staff/crm` | functional Travel Request queue | staff-area Role + AAL2 |
| `/api/v1/travel-requests` | functional Customer command endpoint | same-origin Customer session |
| `/api/v1/staff/travel-requests` | functional staff command endpoint | same-origin staff-area Role + AAL2 |

## E. Verification evidence

### E1. Automated results

| Check | Result |
|---|---|
| TypeScript | PASS |
| Task 004 tests | 10/10 PASS |
| Complete Task 002–004 tests | 33/33 PASS |
| PGlite execution of all three migrations | PASS |
| exact idempotent replay | PASS |
| payload-drift replay denial | PASS |
| exact version/hash submission binding | PASS |
| immutable version, submission and lifecycle evidence | PASS |
| save-after-submit denial | PASS |
| missing submission acknowledgements denial | PASS |
| Customer-to-Customer isolation | PASS |
| authenticated-client write and RPC denial | PASS |
| staff AAL1 read and command denial | PASS |
| staff AAL2 queue read and claim | PASS |
| premature human-review denial | PASS |
| ordered preparation transitions | PASS |
| AZ/RU/EN catalogue parity | PASS |
| AZ/EN Cyrillic-mixing guard | PASS |
| responsive and accessibility source contracts | PASS |
| Production build | PASS; 51 pages generated and every route compiled |
| standalone runtime smoke | PASS |
| npm dependency audit | PASS; 0 vulnerabilities |
| original Task 001 HTML audit | PASS; source hash unchanged |

### E2. Runtime HTTP evidence

The standalone Production server proved:

- `/` returns `307` to `/az`;
- `/az/trip-wizard` returns `200` with `<html lang="az">` and the Azerbaijani sign-in gate;
- generated CSS and the VOYARA brand SVG return `200`;
- `/az/staff/crm` returns `307` to the exact preserved login destination;
- a Customer command without `Origin` returns `403 REQUEST_ORIGIN_DENIED`;
- a same-origin Customer command without a session returns `401 AUTHENTICATION_REQUIRED`;
- nonce CSP and defensive permissions headers remain present.

### E3. Source and data checks

- dependency audit found zero vulnerabilities;
- secret-pattern scan found only explicit variable names, role names and synthetic placeholders;
- fixture email addresses remain synthetic example values;
- no Production Customer record was introduced;
- no `dangerouslySetInnerHTML`, `eval`, dynamic function or sensitive application logging was added;
- the Task 001 source remains unchanged.

Original source:

`reference/task-001/voyara-mvp-demo-july7-10.html`

SHA-256:

`dcf076419625a71676fe8029da574dfca0eb86259152c747552cb46a74f62ceb`

## F. Commands executed and exact outcomes

Key successful commands:

```text
env HOME=/tmp/voyara-home npx supabase migration new task004_travel_request_vertical_slice
  PASS: migration created; telemetry shutdown emitted a non-schema timeout warning

npm run typecheck
  PASS

npm run test:task004
  PASS: 10 tests

npm test
  PASS: 33 tests

npm run build
  PASS: compile, TypeScript, 51-page generation and standalone preparation

npm run test:runtime
  PASS: redirect, localized wizard, static assets, protected CRM, API origin and auth boundaries

npm run verify
  PASS: typecheck + 33 tests + Production build + runtime smoke

npm audit --audit-level=low
  PASS: 0 vulnerabilities

npm run test:legacy
  PASS

env [documented synthetic configuration] npm run env:check
  PASS
```

Disclosed failures and corrections:

- the first Task 004 database test exposed that the service role could not execute the locked private validation helper; explicit `service_role` execute grants were added while `anon` and `authenticated` remained revoked, then the suite passed;
- the first immutable-evidence assertion ran as `service_role`, whose table grant already denies update; the test was corrected to exercise the owner-level trigger, proving the append-only rejection directly;
- a standalone server launched in one isolated command session could not be reached from a separate command namespace; a deterministic same-process runtime harness was added and passed;
- `npm run env:check` without an environment correctly failed because the five required connection variables were absent; rerunning with documented synthetic non-Production values passed;
- Docker CLI is not installed (`docker info` returned command-not-found), so `supabase db lint` and the real pgTAP suite were not executed locally.

## G. Files created or materially changed

Created:

- `src/server/travel-request/contract.ts`
- `src/server/travel-request/command.ts`
- `src/server/travel-request/queries.ts`
- `src/components/travel-request-form.tsx`
- `src/components/travel-request-queue.tsx`
- `src/app/api/v1/travel-requests/route.ts`
- `src/app/api/v1/staff/travel-requests/route.ts`
- `supabase/migrations/20260717104504_task004_travel_request_vertical_slice.sql`
- `supabase/tests/database/003_travel_requests.test.sql`
- `tests/task-004/travel-request-contract.test.ts`
- `tests/task-004/security-contract.test.ts`
- `tests/task-004/database-travel-request.test.ts`
- `scripts/runtime-smoke.mjs`
- `docs/task-004/VOYARA-TASK-004-IMPLEMENTATION-REPORT.md`

Materially changed:

- `src/app/[locale]/trip-wizard/page.tsx`
- `src/app/[locale]/staff/crm/page.tsx`
- `src/app/globals.css`
- all three locale catalogues
- `package.json`
- `package-lock.json`
- `.github/workflows/verify.yml`
- `README.md`

## H. Security and authority assessment

Closed in Task 004 source:

- no client-owned Travel Request lifecycle state;
- no editable submitted content;
- no submission detached from its version/hash;
- no Customer read of another Customer's request;
- no staff queue read at AAL1;
- no browser write grant or privileged RPC grant;
- no cross-origin command;
- no unbounded JSON body;
- no silent duplicate/replay mutation;
- no unclaimed preparation transition;
- no direct transition from submission to human review;
- no AI-created commercial authority;
- no premature Quotation, Approval, Payment, Booking or Voucher.

Remaining integration and Production risks:

- hosted Supabase RLS/Auth behavior still needs launch-project verification;
- Docker-backed Supabase lint and pgTAP remain CI-only in this environment;
- a real-browser responsive, keyboard and WCAG 2.2 AA suite belongs to Production hardening; Task 004 proves source contracts and standalone HTTP behavior, not a complete accessibility certification;
- formal privacy notice and terms text require the approved legal documents before Production. Task 004 records an operational submission acknowledgement and does not invent legal terms;
- request limits are safe starting controls and require tuning from measured launch traffic;
- AI provider execution, prompt evidence, source citations and cost tracking remain deliberately absent;
- staff reassignment and SLA administration remain for the later administration slice.

## I. Budget assessment

The approved USD 10,000–20,000 initial launch range remains plausible because Task 004 uses:

- the existing retained screens;
- the existing managed Auth/PostgreSQL stack;
- one server command boundary;
- manual preparation fallback;
- no new provider contract;
- no separate CRM product, queue service or analytics platform.

The budget would be put at risk by adding autonomous AI operations, multiple provider integrations or a separate workflow platform before the commercial authority path is proven.

## J. Exact next implementation task

**IMPLEMENTATION TASK 005 — Commercial Approval Vertical Slice**

Required boundary from the ratified roadmap:

1. create an AI-or-human Draft record derived from one exact Travel Request version;
2. create immutable Quotation versions with canonical payloads and SHA-256 hashes;
3. record risk flags without permitting AI Approval;
4. implement human Approval or rejection with Role, limit, AAL2 and idempotency guards;
5. keep Founder co-sign deny-by-default until the launch Approval matrix is configured;
6. publish only the exact approved Quotation version and hash;
7. bind authenticated Customer Acceptance to the same published hash;
8. generate an attributable Work Receipt;
9. prove that draft editing, hash mismatch, AI Approval, unauthorised publication and mismatched Acceptance all fail;
10. activate the retained Proposal and Human Approval Queue screens without starting Payment or Booking.

The genuinely required Production decision for this next slice is the launch commercial Approval matrix: authorised Roles, monetary or margin limits, risk triggers and when Founder co-sign is mandatory. Implementation can begin with a safe Founder-only/deny-by-default configuration, but broader Production Approval authority must not be invented.
