# VOYARA AI MVP — Implementation Task 009 Report

## Trip Room Support and Exception Management

Date: 18 July 2026  
Repository version: `0.9.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 009 is implemented and locally verified.

The retained Trip Room and a supporting AAL2 operations queue now implement this launch-critical vertical slice:

```text
Exact issued Voucher
→ authenticated Customer Support request
→ accountable human-owned case
→ human priority and escalation
→ immutable SHA-256-linked case events
→ Customer-safe status updates
→ separate human resolution and closure
```

A Customer can open a Support case only for a Booking they own when PostgreSQL holds an exact `VOUCHER_ISSUED` Booking and matching issued Voucher version and hash. The case retains that exact Booking, Voucher identifier, version and SHA-256 for its lifetime. PostgreSQL also permits only one active Support case per Booking, preventing duplicate active operational queues while allowing new cases after resolution.

Every Support action appends one immutable canonical event linked to the case authority hash and the preceding event hash. The mutable case summary can move only when the next event already exists. The Customer receives only `CUSTOMER` events; internal notes, actor evidence, escalation evidence and event hashes remain restricted to AAL2 operations.

AI has no command authority to claim, prioritise, escalate, update, resolve or close a case. Resolution and closure require an accountable human and explicit confirmation that Support does not alter Payment, Booking, Voucher, cancellation, compensation or Refund authority.

No Supplier, Payment, WhatsApp, CRM, AI, storage or other paid provider was added. Text-based Support plus manual human operations is the budget-compatible launch fallback.

Hosted-provider activation is not claimed. Production Supabase linkage, credentials, SMTP/domain setup and verified Founder bootstrap were not supplied.

## B. Implemented scope

### B1. Exact-Voucher Customer Support

Inside `/{locale}/trip-room`, a Customer with an issued Voucher can:

- open a case bound server-side to the exact issued Voucher;
- select one bounded category and `NORMAL` or `URGENT` reported urgency;
- provide a bounded subject and message;
- explicitly acknowledge that a Support request creates no automatic cancellation, compensation or Refund;
- see one active case per Booking and add further Customer messages;
- review the complete Customer-safe event history for current and previous cases.

The browser submits only the Booking identifier. The server independently resolves the current issued Voucher, verifies Customer ownership and builds the exact canonical case payload. A Customer cannot nominate another Voucher, Customer or authority hash.

### B2. Accountable human operations

The supporting `/{locale}/staff/support` route provides:

- an AAL2-only Staff/Manager/Admin/Founder queue;
- explicit claim of an unowned open case;
- immutable ownership after claim;
- Manager/Admin/Founder priority decisions;
- monotonic escalation to Manager and, by elevated Roles, Founder;
- Customer-visible operational updates;
- separately marked internal operations notes;
- human resolution and closure declarations;
- the complete actor-attributed event/hash history.

A base Staff owner may escalate to Manager. Only Manager/Admin/Founder authority may escalate to Founder or change priority. A non-owner base Staff member cannot update another human's case. Manager/Admin/Founder can intervene without silently replacing the recorded owner.

### B3. Immutable event chain

Each event contains:

- case identifier and case authority SHA-256;
- monotonically increasing event sequence;
- preceding event sequence and SHA-256;
- bounded event type and `CUSTOMER` or `INTERNAL` visibility;
- canonical payload and event SHA-256;
- actor identifier, human kind, session, assurance level and timestamp.

Event and command-receipt updates/deletes are rejected. A case aggregate cannot be deleted, cannot change its exact Voucher identity and cannot transition without the next immutable event.

### B4. Customer/internal visibility separation

Customer RLS requires exact ownership. Customer table grants omit:

- case owner and escalation evidence;
- case authority and current event pointers;
- event actor and session evidence;
- internal notes and event hashes.

The event RLS policy additionally requires `visibility = 'CUSTOMER'` for the Customer owner. AAL2 operations can inspect the complete chain through a server-admin query only after application Role and assurance checks.

### B5. Authority separation

Support commands cannot:

- verify Payment or allocate funds;
- create or verify a Booking;
- treat Supplier Confirmation as Booking Verification;
- issue or revise a Voucher;
- approve cancellation, compensation, Credit or Refund;
- assign Roles or alter Approval limits.

The Support gateway updates only `support_cases`, `support_case_events`, Support receipts and general authority-audit evidence. Tests prove the issued Booking and Voucher remain unchanged after the complete Support lifecycle.

### B6. Localisation, responsive behavior and accessibility

All Customer Support copy and all supporting operations copy have exact key parity in Azerbaijani, Russian and English. Azerbaijani remains the default. No Customer state uses fallback copy from another locale.

The existing visual direction was extended with the established card, fieldset, status, timeline and authority-note patterns. Forms use native labels, fieldsets, required controls, bounded inputs, focus styles and polite live status regions. Support facts and action panels collapse to one column at the existing mobile breakpoint.

### B7. Command and abuse controls

Both Support APIs apply:

- same-origin POST enforcement;
- JSON content-type enforcement;
- 32,768-byte Customer and 65,536-byte staff body limits before parsing;
- authenticated session and PostgreSQL-authoritative Role checks;
- AAL2 for every staff command;
- strict Zod schemas with unknown-field rejection;
- server-computed canonical SHA-256 values;
- required idempotency keys and locked receipts;
- per-session and all-session revocation checks inside PostgreSQL;
- 30 accepted Customer and 120 accepted staff Support commands per actor per hour;
- a database-unique active-case guard per Booking;
- generic Customer error responses that do not expose internal evidence.

## C. Database changes

Migration:

`supabase/migrations/20260718074118_task009_support_exception_management_vertical_slice.sql`

SHA-256:

`e469d9a02d313d77d2583fe304aa0ef33cfb5e72926507c7c67f1cccf33d6517`

Created tables:

| Table | Purpose | Customer authority |
|---|---|---|
| `support_cases` | Exact-Voucher-bound case aggregate, owner, priority and terminal state | own cases, Customer-safe columns only |
| `support_case_events` | Immutable previous-hash-linked case history | own `CUSTOMER` events only |
| `support_command_receipts` | Locked idempotent command responses | none |

Principal controls:

- exact composite foreign key to `(booking_id, voucher_id, version_number, voucher_hash)` in `voucher_versions`;
- unique partial index allowing only one active case per Booking;
- guarded case update/delete trigger;
- immutable event and command-receipt triggers;
- forced RLS on all three tables;
- least-privilege explicit Customer-safe column grants;
- service-role-only command RPC;
- exact Role, AAL2, session-revocation, ownership, priority, escalation and state checks inside PostgreSQL.

Explicit grants and RLS are both applied because they are separate controls under current Supabase Data API behavior.

## D. Routes added or activated

| Route | Status | Authority |
|---|---|---|
| `/{locale}/trip-room` | Customer case opening, messaging and Customer-safe history added beneath issued Vouchers | Customer Role, ownership and exact issued Voucher |
| `/{locale}/staff/support` | Support ownership, priority, escalation, updates, notes, resolution and closure | AAL2 Staff/Manager/Admin/Founder, with command-specific authority |
| `/api/v1/customer/support` | Customer Support commands | same-origin authenticated Customer |
| `/api/v1/staff/support` | human operations commands | same-origin authenticated AAL2 operations |

## E. Verification evidence

### E1. Automated results

| Check | Result |
|---|---|
| Task 009 focused tests | 11/11 PASS |
| Complete Task 002–009 tests | 82/82 PASS |
| execution of all eight migrations in PGlite | PASS |
| exact issued Voucher mismatch or other Customer ownership | DENIED |
| duplicate active case for one Booking | DENIED |
| Customer B access to Customer A case | DENIED |
| operations AAL1 access or command | DENIED |
| unowned base-Staff update | DENIED |
| Manager priority decision | PASS |
| Staff-to-Manager escalation | PASS |
| internal note in Customer view | DENIED |
| Customer-safe operations update | PASS |
| Customer message after resolution | DENIED |
| immutable event update/delete | DENIED |
| Booking and Voucher mutation through Support | DENIED |
| AI claim/escalation/resolution/closure | DENIED |
| AZ/RU/EN catalogue parity | PASS |
| responsive/accessibility source contracts | PASS |
| Production build | PASS; 68 pages generated and all routes compiled |
| standalone runtime smoke | PASS |
| npm dependency audit | PASS; 0 vulnerabilities |
| environment validation | expected fail without credentials; PASS with reserved synthetic values |
| secret/data scan | PASS; synthetic test/CI placeholders only; only `.env.example` exists |
| original Task 001 HTML audit | PASS; preserved legacy findings unchanged |

The final `npm run verify` result was exit code 0: TypeScript passed, 82 tests passed with zero failures, the Production build compiled, 68 pages generated and the standalone runtime smoke passed.

### E2. Runtime HTTP evidence

The standalone Production server proved:

- the localized route tree and static assets serve with the existing CSP/security headers;
- `/{locale}/trip-room` preserves its destination through Customer login;
- `/{locale}/staff/support` preserves its destination through staff login;
- Customer and staff Support commands without `Origin` are denied;
- same-origin Customer and staff Support commands without a session require authentication.

### E3. Native Supabase boundary

`supabase/tests/database/008_support_authority.test.sql` contains 23 pgTAP assertions covering Task 009 tables, forced RLS, policies, RPC privileges, immutable triggers and exact authority columns.

Docker is not installed and no local PostgreSQL/Supabase stack is running in this environment. `supabase db lint` and `supabase test db` therefore reached the local connection attempt but returned `LegacyDbConnectError: Failed to connect`. The native pgTAP/advisor results are not claimed. All eight migrations were repeatedly applied in PGlite, and the full behavioral database suite passed. Existing CI remains responsible for the Docker-backed native Supabase gates.

## F. Principal commands executed and outcomes

```text
env HOME=/tmp/voyara-task009-home npm_config_cache=/tmp/voyara-task009-npm-cache npm ci
  PASS: 95 packages installed from the recovered exact Task 008 package lock

npm run verify  # restored Task 008 baseline
  PASS: 71/71 tests, seven migrations, 63 generated pages and runtime smoke

env HOME=/tmp/voyara-task009-home ... npx supabase migration new task009_support_exception_management_vertical_slice
  FILE CREATED: 20260718074118_task009_support_exception_management_vertical_slice.sql
  CLI SHUTDOWN WARNING: PostHog telemetry timeout occurred after file creation

node --input-type=module -e "...apply every sorted supabase/migrations SQL file through PGlite..."
  PASS: all eight migrations applied in order

npm run typecheck
  PASS

npm run test:task009
  PASS: 11 tests, 0 failed

npm run verify
  PASS: typecheck, 82/82 tests, Production build, 68 generated pages and runtime smoke

npm run env:check
  EXPECTED FAIL-CLOSED: app URL, Supabase URL, publishable key, secret key and database URL are absent

env ...reserved synthetic values... npm run env:check
  PASS: publishable/secret/database separation accepted; demo mode disabled

npm audit --audit-level=low
  PASS: 0 vulnerabilities

npm run test:legacy
  PASS: preserved eight-screen reference audit

env HOME=/tmp/voyara-task009-home SUPABASE_TELEMETRY_DISABLED=1 npm run db:lint
  NOT EXECUTED AGAINST POSTGRES: local database connection unavailable

env HOME=/tmp/voyara-task009-home SUPABASE_TELEMETRY_DISABLED=1 npm run db:test
  NOT EXECUTED AGAINST POSTGRES: local database connection unavailable

docker --version
  NOT EXECUTED: Docker command is not installed

sha256sum supabase/migrations/20260718074118_task009_support_exception_management_vertical_slice.sql
  PASS: e469d9a02d313d77d2583fe304aa0ef33cfb5e72926507c7c67f1cccf33d6517
```

The first focused suite produced 10 passes and one test-only mismatch: the service Role correctly lacked `UPDATE` privilege before the immutable trigger could execute. The test was corrected to use the database owner when testing the trigger itself; no Product permission was weakened. The final focused and complete suites passed.

The first native CLI attempts also encountered the environment's read-only default `/root/.supabase` path. They were rerun with the writable Task-specific `HOME`, reached the database connection step, and then correctly disclosed that no local database was running.

No real secret, Production personal data or external provider credential was supplied or written.

## G. Files created

- `src/server/support/contract.ts`
- `src/server/support/command.ts`
- `src/server/support/queries.ts`
- `src/components/customer-support-panel.tsx`
- `src/components/support-operations-queue.tsx`
- `src/app/api/v1/customer/support/route.ts`
- `src/app/api/v1/staff/support/route.ts`
- `src/app/[locale]/staff/support/page.tsx`
- `supabase/migrations/20260718074118_task009_support_exception_management_vertical_slice.sql`
- `supabase/tests/database/008_support_authority.test.sql`
- `tests/task-009/database-support-authority.test.ts`
- `tests/task-009/support-contract.test.ts`
- `tests/task-009/security-contract.test.ts`
- `docs/task-009/VOYARA-TASK-009-IMPLEMENTATION-REPORT.md`

Principal updated files:

- `src/server/bos/authority.ts`
- `src/components/customer-trip-room.tsx`
- `src/components/access-banner.tsx`
- `src/app/[locale]/(customer)/trip-room/page.tsx`
- `src/i18n/messages/az.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/en.json`
- `src/app/globals.css`
- `scripts/runtime-smoke.mjs`
- `package.json`
- `package-lock.json`
- `README.md`

## H. Security and authority review

Task 009 closes these launch-critical controls:

- no Support case without exact Customer-owned issued Voucher authority;
- no second active case for the same Booking;
- no direct client write or public RPC grant;
- no cross-Customer case/event access;
- no internal note, actor evidence or event hash in the Customer view;
- no AAL1 staff access;
- no silent claim or owner replacement;
- no unowned base-Staff update;
- no base-Staff priority change or Founder escalation;
- no non-monotonic escalation;
- no case-summary mutation without the next immutable event;
- no edit/delete of events or receipts;
- no Customer message after resolution/closure;
- no AI Support decision authority;
- no Support-side mutation of Payment, Booking, Voucher or Refund state;
- no service secret in browser code.

The RLS design follows current Supabase guidance: exposed-schema tables enable RLS, grants are explicit and least privilege, Customer reads carry ownership and visibility constraints, AAL2 staff access is explicit, and service credentials remain server-only.

References reviewed:

- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically>

## I. Remaining boundaries and genuine Founder decisions

Confirmed implementation boundaries:

- hosted Supabase RLS/Auth behavior still requires launch-project verification;
- native Docker-backed Supabase lint and pgTAP remain CI-only in this environment;
- Support accepts bounded text only; private attachments, MIME/size validation, malware controls and signed URLs are absent;
- no inbound email, WhatsApp, CRM or other channel integration exists;
- the issued Voucher's configured Support contact remains the manual handoff;
- no public SLA, operating-hours promise or unapproved compensation promise was invented;
- cancellation, amendment, Credit, Refund, compensation and chargeback authorities remain separate and absent;
- real-browser keyboard, responsive and WCAG 2.2 AA suites remain Production-hardening work.

Genuine Founder decisions before Production Support launch:

1. Approve the launch Support hours, urgent-response policy and escalation thresholds. Current priorities and escalation controls are operational records, not a public SLA.
2. Confirm whether text plus the manual Voucher Support contact is sufficient for launch, or whether private evidence attachments are launch-critical. Attachments require private storage, validation, malware controls, retention and signed access.
3. Approve cancellation, compensation and Refund policies before those separate human-authority workflows are implemented. Support must not promise or execute them meanwhile.

No decision is required to proceed with the Founder Command Center slice.

## J. Budget assessment

The approved USD 10,000–20,000 launch budget remains realistic for this slice because it reuses the single Next.js/BOS/PostgreSQL/Supabase boundary, existing Trip Room, existing Role/AAL2/session controls and manual human operations. It adds no paid messaging, CRM, AI, file-storage or Supplier provider.

The budget would be pressured by simultaneously adding omnichannel ingestion, private attachments, automated WhatsApp, broad SLA automation, cancellation/compensation/Refund execution and a separate ticketing platform. Those items remain evidence-led decisions rather than hidden scope.

## K. Remaining implementation tasks

Three core implementation tasks remain:

1. **Implementation Task 010 — Founder Command Center**
2. **Implementation Task 011 — Administration and operational controls**
3. **Implementation Task 012 — Production hardening and launch readiness**

## L. Immediate next implementation task

**IMPLEMENTATION TASK 010 — FOUNDER COMMAND CENTER AUTHORITATIVE READ MODEL**

Connect the retained Founder Command Center to PostgreSQL-authoritative decision and risk views for:

- pending decisions and critical Exceptions;
- cash, revenue, Gross Booking Value, Gross Profit, receivables and exposure as distinct metrics;
- commercial pipeline;
- Payment, Booking and Support risk;
- Membership performance where evidence exists;
- AI activity/cost where evidence exists;
- team workload and system health;
- source freshness and unavailable-data states.

The slice must preserve Founder-only AAL2 access, use database-derived definitions rather than browser totals, avoid inventing absent metrics, and add no separate analytics platform.
