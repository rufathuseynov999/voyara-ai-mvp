# VOYARA AI MVP — Implementation Task 011 Report

## Administration Launch Slice

Date: 18 July 2026  
Repository version: `0.11.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 011 is implemented and locally verified.

The retained CRM screen at `/{locale}/staff/crm` now combines its existing PostgreSQL-backed Travel Request queue with a bounded launch-administration workspace. The screen was not replaced or visually redesigned. It now provides:

- a journey stage derived from exact Travel Request, Quotation, Payment Request and Booking records;
- accountable operational tasks bound to one exact Travel Request version and SHA-256;
- immutable task ownership and state history;
- the eight exact Founder-approved Personal and Corporate Membership prices as immutable PostgreSQL versions;
- public price cards backed by the public PostgreSQL catalogue when configured, with a hash-checked approved fallback for unconfigured local builds;
- a manual, versioned Supplier configuration registry with no credentials or autonomous Supplier action;
- explicit governance states for Roles, Approval limits and Refunds.

The implementation does not create a parallel CRM authority. Journey stage is derived, not manually set. A CRM task cannot change commercial Approval, Customer Acceptance, Payment, allocation, financial readiness, Booking, Supplier Confirmation, Booking Verification, Voucher, Support, Refund, Role or Approval-limit authority.

The approved launch budget remains realistic for this slice. No external CRM, Supplier, Payment, AI, messaging, analytics or workflow provider was added. No microservice, queue, scheduler, Kubernetes cluster or new paid dependency was introduced.

Production activation is not claimed. Required Production environment values and managed Supabase linkage were not supplied. The Refund workflow remains blocked because FDR-002 does not provide approved cancellation/Refund terms.

## B. Implemented scope

### B1. Retained CRM route

The existing CRM route, screen number, heading and Travel Request queue remain in place. Task 011 adds the administration workspace after the retained queue.

Access remains:

- authenticated staff-area Role;
- AAL2 before page rendering;
- server-side data loading;
- same-origin command API;
- no protected data bundled into the public page.

The staff session banner now contains a direct CRM link for Staff, Manager, Finance, Admin and Founder Roles.

### B2. Derived CRM journey

`public.administration_crm_pipeline` is a service-only, security-invoker view. One row represents one persisted non-Draft Travel Request.

The displayed stage is derived in this order:

1. Travel Request intake;
2. commercial Draft;
3. Commercial Approval;
4. published Proposal;
5. Customer Acceptance;
6. Payment pending;
7. financially ready;
8. Booking operations;
9. Booking Verification/Voucher preparation;
10. Voucher issued.

The row carries the exact source request version/hash, current domain status, current authority hash and last change. No command updates the derived stage.

### B3. Accountable CRM tasks

The Task 011 task aggregate supports:

- create against one exact current non-Draft Travel Request version/hash;
- optional accountable owner at creation;
- claim an unassigned task;
- move `OPEN` to `IN_PROGRESS` or `DONE`;
- move `IN_PROGRESS` to `DONE`;
- Manager/Admin/Founder reassignment;
- Manager/Admin/Founder cancellation;
- manually selected target due date;
- immutable event version, previous-event hash, actor, AAL2 session and note.

Terminal `DONE` and `CANCELLED` tasks cannot be changed. Every aggregate update requires the next immutable event and SHA-256 pointer. Stale version/hash commands are rejected. Staff and Finance may assign new work only to themselves; assigning another person requires elevated authority.

The target due date is not represented as a contractual SLA. No unapproved SLA threshold, automatic breach promise or staff performance target was invented.

### B4. Membership price authority

The database contains exactly these immutable version-1 records:

| Audience | Plan | Monthly | Annual | Pricing model |
|---|---|---:|---:|---|
| Personal | Smart | 19 AZN | 190 AZN | Fixed |
| Personal | Plus | 39 AZN | 390 AZN | Fixed |
| Personal | Premium | 69 AZN | 690 AZN | Fixed |
| Personal | Black | 299 AZN | 2,990 AZN | Fixed |
| Corporate | Starter | 149 AZN | — | Fixed |
| Corporate | Standard | 299 AZN | — | Fixed |
| Corporate | Professional | 599 AZN | — | Fixed |
| Corporate | Enterprise | Custom | — | Custom |

Each record contains a canonical `membership-plan-v1` payload, integer AZN minor units, Founder-baseline attribution and SHA-256. The current plan pointer and its version are mutation-protected. There is no price-edit browser command in Task 011.

The public landing page now calls `loadPublicMembershipCatalogue()`. When Supabase is configured, it reads `public.membership_plan_catalogue` through the public RLS/grant boundary. An unconfigured local build uses the same eight approved values only. A database result is accepted only if all eight plan hashes match the approved catalogue; a partial or unexpected result is not displayed.

Membership performance remains unavailable in the Founder Command Center because a price catalogue is not a performance ledger.

No benefits, points, rewards, referral terms, service entitlements, fees, cancellation percentages or Refund terms were added.

### B5. Manual Supplier configuration

Supplier administration stores only:

- stable internal code;
- display name;
- bounded service category;
- bounded operational channel;
- `ACTIVE` or `PAUSED` configuration state;
- short operations note;
- change reason, actor, AAL2 session, version and SHA-256 history.

Manager, Admin and Founder may create or revise configuration. Other AAL2 staff-area Roles can read the registry but cannot write it.

The schema has no API key, password, token, bank, net-rate, contract-term, Customer-data or autonomous-booking field. Configuration does not contact a Supplier, execute a Supplier booking, capture Supplier Confirmation or verify a Booking.

### B6. Governance boundaries

The administration interface states the following rather than simulating unavailable features:

| Control | Task 011 state | Reason |
|---|---|---|
| Role assignment/revocation | Existing Founder AAL2 access console | Already database-authoritative and Founder-only |
| Approval limits | `NOT_CONFIGURED` | No Founder-approved threshold matrix exists; Founder-only commercial Approval v1 remains safe |
| Refunds | `BLOCKED_PENDING_FOUNDER_POLICY` | FDR-002 lacks approved legal/commercial cancellation and Refund terms |

No Approval limit or Refund command was introduced in the Task 011 contract or endpoint.

## C. Database and security controls

### C1. New PostgreSQL objects

Tables:

- `public.membership_plans`;
- `public.membership_plan_versions`;
- `public.crm_tasks`;
- `public.crm_task_events`;
- `public.supplier_registry`;
- `public.supplier_configuration_versions`;
- `public.administration_command_receipts`.

Views:

- `public.membership_plan_catalogue`;
- `public.supplier_configuration_catalogue`;
- `public.administration_crm_pipeline`;
- `public.administration_team_directory`;
- replacement of the fixed-shape `public.founder_source_freshness` view without falsely declaring Membership performance implemented.

Functions:

- append-only evidence rejection;
- CRM aggregate guard;
- Supplier aggregate guard;
- consistent denied-result audit helper;
- `public.execute_administration_command` command gateway.

### C2. Command security

The browser endpoint enforces:

- same-origin requests;
- JSON content type;
- 64 KiB request limit;
- authenticated viewer;
- staff-area Role;
- AAL2;
- strict Zod discriminated-union schemas;
- 12–160 character idempotency key;
- no-store responses.

PostgreSQL independently enforces:

- active authoritative Role;
- AAL2 session evidence;
- session and user-wide revocation;
- command-specific Role boundary;
- 120 commands per actor per hour launch guard;
- exact Travel Request version/hash;
- exact current task/Supplier version and previous hash;
- legal state transition;
- owner/elevated-authority rules;
- immutable evidence and terminal state;
- idempotency conflict denial;
- accepted and denied authority audit events.

No browser Role receives `INSERT`, `UPDATE`, `DELETE` or RPC execute authority for Task 011 aggregates. Only `service_role` executes the command function.

### C3. RLS and grants

RLS is enabled and forced on every new table. The migration explicitly grants the minimum required table and view privileges rather than assuming RLS alone controls API exposure.

Implementation references used for current Supabase behaviour:

- Supabase Row Level Security guide: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase April 2026 explicit-grants change: <https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically>

Membership current prices are public read-only records. CRM, Supplier and team-directory administration data is server-only or AAL2-operations read-only as appropriate.

## D. Role matrix

| Command | Staff | Finance | Manager | Admin | Founder | AI agent |
|---|---:|---:|---:|---:|---:|---:|
| Create CRM task | Yes, self/unassigned | Yes, self/unassigned | Yes | Yes | Yes | No |
| Claim CRM task | Yes | Yes | Yes | Yes | Yes | No |
| Update owned CRM task state | Yes | Yes | Yes | Yes | Yes | No |
| Reassign CRM task | No | No | Yes | Yes | Yes | No |
| Cancel CRM task | No | No | Yes | Yes | Yes | No |
| Create Supplier configuration | No | No | Yes | Yes | Yes | No |
| Revise Supplier configuration | No | No | Yes | Yes | Yes | No |
| Change Membership price | No command | No command | No command | No command | No Task 011 command | No |
| Configure Approval limits | No command | No command | No command | No command | Not configured | No |
| Execute Refund | Blocked | Blocked | Blocked | Blocked | Blocked pending policy | No |

## E. Localisation, accessibility and responsive treatment

All new interface copy has exact Azerbaijani, Russian and English key parity. Azerbaijani remains the default route. One locale catalogue drives each rendered interface state.

The retained design system was extended with:

- labelled sections and heading relationships;
- semantic lists and definition lists;
- real forms, labels and required-field constraints;
- live command-result status;
- explicit disabled fieldsets for Demo/unavailable authority;
- keyboard-operable buttons, selects and `details` history;
- responsive two-column administration cards and four-column price cards that collapse at existing breakpoints;
- visible non-colour blocked-state labels.

Real browser, keyboard, axe and viewport evidence remains part of Task 012 because Chromium is not installed in this workspace.

## F. Verification executed

### F1. Passing checks

| Command | Exact result |
|---|---|
| `npm run test:task011` | PASS — 9 tests, 9 passed, 0 failed, 0 skipped |
| `npm run typecheck` | PASS; TypeScript emitted no error |
| `npm test` | PASS — 97 tests, 97 passed, 0 failed, 0 skipped; all 10 migrations loaded through PGlite |
| `npm run build` | PASS — Next.js 16.2.10 Production build; 69 static/dynamic pages generated; administration API route present |
| `npm run test:runtime` | PASS — approved public prices, route protection, assets, and Administration origin/auth boundaries verified |
| `npm audit --audit-level=low` | PASS — 0 vulnerabilities |

Task 011 database tests prove:

- anonymous read of the exact public Membership catalogue;
- exact approved Smart, Black and Enterprise price states;
- Staff self-assignment restriction;
- AAL1 denial;
- exact task version/hash state update;
- stale task version denial;
- Staff reassignment denial and Manager acceptance;
- Supplier creation denial for Staff and acceptance for Manager;
- immutable Supplier version revision;
- evidence mutation denial;
- CRM/Supplier commands do not mutate Travel Request authority;
- service-only administration views;
- AI denial for every Task 011 command.

### F2. Disclosed non-passing or unavailable checks

`npm run env:check` was executed and failed exactly because these Production values are absent:

- `NEXT_PUBLIC_APP_URL`;
- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
- `SUPABASE_SECRET_KEY`;
- `DATABASE_URL`.

This is an environment-input blocker, not hidden as a passing check.

Native `supabase test db`, Supabase lint against a running local stack, pgTAP, backup/restore and Production migration rehearsal were not run because Docker is not installed and no managed project was supplied. Chromium/Chrome is not installed, so real-browser evidence was not claimed.

## G. Classification reconciliation

| Area | Task 011 classification | Evidence-based treatment |
|---|---|---|
| Retained CRM Travel Request queue | `EXISTS_AND_ACCEPTED` | Preserved and still live |
| Derived CRM journey | `EXISTS_AND_ACCEPTED` | Server-derived, service-only, no manual authority state |
| CRM owner/task/history | `EXISTS_AND_ACCEPTED` | Exact-request-bound AAL2 commands and immutable events |
| Contractual SLA policy | `DEFERRED` | Manual target dates only; no approved SLA threshold |
| Personal Membership prices | `EXISTS_AND_ACCEPTED` | Exact immutable approved versions |
| Corporate Membership prices | `EXISTS_AND_ACCEPTED` | Exact immutable approved versions |
| Membership benefits/performance | `FOUNDER_DECISION_REQUIRED` | Benefits unapproved; performance ledger absent |
| Supplier manual configuration | `EXISTS_AND_ACCEPTED` | Versioned bounded configuration; no integration authority |
| External Supplier/CRM integrations | `DEFERRED` | Manual launch fallback retained |
| Role administration | `EXISTS_AND_ACCEPTED` | Existing Founder-only AAL2 console retained |
| Approval limits | `DEFERRED` | Founder-only commercial Approval v1 remains active |
| Refund workflow | `FOUNDER_DECISION_REQUIRED` | FDR-002 policy blocker; no simulation built |
| Production linkage and credentials | `EXISTS_NEEDS_INTEGRATION` | Task 012 input and deployment work |
| Real-browser/a11y/viewport proof | `EXISTS_NEEDS_TESTING` | Task 012; browser binary unavailable here |

## H. Principal evidence files

Implementation:

- `supabase/migrations/20260718123000_task011_administration_vertical_slice.sql`;
- `src/server/administration/contract.ts`;
- `src/server/administration/command.ts`;
- `src/server/administration/queries.ts`;
- `src/app/api/v1/staff/administration/route.ts`;
- `src/components/administration-workspace.tsx`;
- `src/app/[locale]/staff/crm/page.tsx`;
- `src/app/[locale]/page.tsx`;
- `src/components/access-banner.tsx`;
- `src/server/bos/authority.ts`;
- `src/app/globals.css`;
- `src/i18n/messages/az.json`;
- `src/i18n/messages/ru.json`;
- `src/i18n/messages/en.json`;
- `scripts/runtime-smoke.mjs`.

Tests:

- `tests/task-011/administration-contract.test.ts`;
- `tests/task-011/database-administration-authority.test.ts`;
- `tests/task-011/security-and-ui-contract.test.ts`.

Control and package evidence:

- `README.md`;
- `package.json`;
- `package-lock.json`;
- this report.

## I. Deliberate non-implementation

Task 011 does not implement:

- Refund request, Approval, execution or reconciliation;
- cancellation percentages or policy text;
- Approval thresholds or delegated commercial Approval;
- Membership benefit, reward, fee or performance tracking;
- an external CRM;
- automatic lead scoring or conversion forecasts;
- automated Supplier contact or booking;
- Supplier credentials or commercial contract terms;
- SLA promises, performance rankings or automatic breach escalation;
- Production deployment or managed database linkage.

## J. Immediate next implementation task

The exact next task is:

**IMPLEMENTATION TASK 012 — PRODUCTION HARDENING AND LAUNCH READINESS**

It should begin with the actual repository and close only evidence-backed launch-readiness work:

1. obtain or create a non-Production managed Supabase project and exact environment values;
2. apply all 10 migrations cleanly and run native pgTAP/database lint;
3. run real-browser AZ/RU/EN, responsive, keyboard and accessibility suites;
4. verify Production demo-data exclusion and secret boundaries;
5. rehearse database backup/restore and migration rollback response without destructive schema rollback;
6. add managed health/alerting and operational runbooks proportionate to the launch budget;
7. complete Founder bootstrap, domain/SMTP and launch checklist evidence;
8. keep Refund launch blocked until FDR-002 is resolved.

Task 012 must not introduce unapproved providers, broad observability infrastructure, microservices or Kubernetes.
