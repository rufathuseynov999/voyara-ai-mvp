# VOYARA AI MVP — Implementation Task 005 Report

## Commercial Approval Vertical Slice

Date: 17 July 2026  
Repository version: `0.5.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 005 is implemented and locally verified.

The retained Human Approval Queue and Proposal screens now form a real commercial-control vertical slice:

- an assigned AAL2 operator creates a human-authored Quotation from one exact `HUMAN_REVIEW` Travel Request version;
- every save appends a complete immutable canonical Quotation version and SHA-256 hash;
- Customer-visible terms remain separate from internal cost, Gross Profit, margin and risk flags;
- the assigned operator may submit only the current exact version and hash for Approval;
- the safe launch policy permits only an AAL2 Founder to approve, reject and publish;
- Approval applies to one exact version, one payload and one hash;
- a rejection preserves its decision and requires a new version before resubmission;
- publication creates one immutable Customer-safe snapshot tied to the approved version and same full-payload hash;
- viewing the Proposal never creates Customer Acceptance;
- Customer Acceptance requires a separate explicit confirmation of the exact published version, hash, locale and unexpired terms;
- version, approved, published and accepted hashes were proven equal in the executable database flow;
- every accepted command produces an immutable Work Receipt and authority audit event.

No Payment, allocation, Booking, Supplier Confirmation, Booking Verification or Voucher authority was added. AI-provider drafting also remains absent: Task 005 labels the launch fallback truthfully as human-authored and gives AI no Approval, publication or Acceptance authority.

The implementation preserves the existing visual direction and remains one Next.js application with one managed Supabase/PostgreSQL authority boundary. No microservice, Kubernetes cluster, message broker or new paid provider was introduced. The approved initial launch budget remains realistic at this scope.

Hosted-provider activation is not claimed. A real Supabase project and Production credentials were not supplied, so hosted Auth/RLS behavior and a Production publication/Acceptance ceremony were not exercised.

## B. Implemented scope

### B1. Canonical Quotation and internal economics

The Quotation command contract accepts:

- proposal locale, title, summary and validity;
- one to twenty Customer line items;
- integer quantities and decimal AZN inputs converted to integer minor units;
- service fee and discount;
- Customer notes;
- internal total cost;
- constrained internal risk flags.

The server constructs, validates and hashes one canonical `quotation-v1` payload. It derives rather than trusts:

- line totals;
- subtotal;
- final Customer total;
- Gross Profit;
- gross-margin basis points;
- exact source Travel Request identifier, version and hash.

The database independently validates payload structure, arithmetic, allowed risk flags, future validity and the exact source request binding. The application recomputes SHA-256 on every internal read and excludes hash-mismatched records from operational rendering.

Task 005 supports AZN only. This is an intentional launch-safe boundary, not an invented foreign-exchange rule.

Principal files:

- `src/server/commercial/contract.ts`
- `src/server/commercial/command.ts`
- `src/server/commercial/queries.ts`
- `supabase/migrations/20260717115718_task005_commercial_approval_vertical_slice.sql`

### B2. Exact human Approval and rejection

Permitted commercial state progression:

```text
DRAFT
→ PENDING_APPROVAL
→ APPROVED
→ PUBLISHED
→ ACCEPTED
```

Rejection branch:

```text
PENDING_APPROVAL
→ REJECTED
→ new immutable DRAFT version
→ PENDING_APPROVAL
```

Controls:

- only the Travel Request's assigned operator may create, revise or submit a Quotation;
- all staff commercial commands require an active staff-area Role and AAL2;
- Approval and publication require the exact `founder` Role and AAL2 in both the application and PostgreSQL boundaries;
- the launch policy is an immutable `FOUNDER_ONLY` policy version selected by a separate active-policy pointer;
- every decision includes a reason, actor, session, AAL, policy version, exact Quotation version and hash;
- Approved, Published and Accepted content cannot be edited in place;
- a version may receive only one immutable decision;
- wrong actors, AAL1 sessions, wrong hashes, wrong versions and invalid state transitions are denied.

The Founder can see pending Quotations prepared by other assigned operators, but cannot edit those drafts. This separates decision visibility from drafting ownership.

### B3. Customer-safe publication

Publication copies only the `customer` section into `published_proposals`, while preserving a foreign-key binding to the approved full version and the same full-version SHA-256.

Customers cannot read:

- the full Quotation payload;
- cost, Gross Profit or margin;
- risk flags;
- Approval reason or policy record;
- internal Quotation aggregate metadata;
- publisher identifier, Approval decision identifier or staff session identifier;
- draft, submission or Approval Work Receipts.

Column-level grants expose only the safe published fields. Customer Work Receipt access is limited to publication and Acceptance actions. AAL2 staff retain internal read access through RLS.

### B4. Explicit Customer Acceptance

The live Proposal screen shows:

- localized approved title and summary;
- exact line items and totals;
- exact version and SHA-256;
- validity deadline;
- clear Published, Accepted or Expired state;
- a statement that viewing is not Acceptance, Payment, Booking, Booking Verification or Voucher issue.

Acceptance requires an explicit checkbox and command. PostgreSQL verifies:

- active Customer Role;
- record ownership;
- exact published status;
- exact version and hash;
- exact publication locale;
- unexpired validity;
- explicit confirmation.

The immutable Acceptance has a composite foreign key to the exact published `(quotation_id, version_number, payload_hash)`.

Principal files:

- `src/app/[locale]/(customer)/proposal/page.tsx`
- `src/components/published-proposals.tsx`
- `src/app/api/v1/customer/commercial/route.ts`

### B5. Retained Human Approval Queue

`/{locale}/staff/approvals` no longer renders synthetic state cards. It now provides:

- the exact source Travel Request and hash;
- accountable assigned operator;
- Customer-visible term editor;
- internal economics and risk controls;
- exact Quotation version and full hash;
- submit-for-Approval action;
- Founder Approval/rejection reason and actions;
- Founder publication action;
- immutable prior rejection context;
- localized Work Receipt feedback.

The CRM queue links assigned `HUMAN_REVIEW` requests into this retained screen.

Principal files:

- `src/app/[locale]/staff/approvals/page.tsx`
- `src/components/commercial-approval-workspace.tsx`
- `src/app/api/v1/staff/commercial/route.ts`
- `src/components/travel-request-queue.tsx`

### B6. Command and abuse controls

Both commercial endpoints apply:

- same-origin POST enforcement;
- JSON content-type enforcement;
- exact byte limits before JSON parsing;
- verified session and database-authoritative Role checks;
- AAL2 for staff commands;
- explicit Founder check for decisions and publication;
- strict Zod schemas with unknown-field rejection;
- required idempotency key;
- canonical command and Quotation hashes;
- service-secret-only, `SECURITY INVOKER` RPC execution;
- per-session and all-session revocation inside PostgreSQL;
- 10 Customer commercial commands per 24 hours;
- 120 staff commercial commands per hour.

An exact idempotent replay returns the original response. Reusing a key with a changed command or payload is denied.

## C. Database changes

Migration generated through Supabase CLI:

`supabase/migrations/20260717115718_task005_commercial_approval_vertical_slice.sql`

SHA-256:

`9ece2a14a206702d039c27b999414eeb5da951605d104b30353a5f16cd5df4ee`

Created tables:

| Table | Purpose | Customer authority |
|---|---|---|
| `commercial_approval_policy_versions` | Immutable approval-policy history | none |
| `commercial_approval_policy_state` | Active policy pointer | none |
| `commercial_quotations` | Current state and exact-version pointers | none |
| `quotation_versions` | Immutable full canonical versions | none |
| `commercial_approval_decisions` | Immutable exact human decisions | none |
| `published_proposals` | Immutable Customer-safe publication | own safe columns only |
| `customer_quotation_acceptances` | Immutable exact Acceptance | own safe columns only |
| `commercial_work_receipts` | Attributable lifecycle receipts | own publication/Acceptance receipts only |
| `commercial_command_receipts` | Locked idempotency responses | none |

Every Task 005 table has enabled and forced RLS. All client writes are denied. The public RPC `execute_commercial_command` is executable only by `service_role`.

## D. Routes added or activated

| Route | Status | Authority |
|---|---|---|
| `/{locale}/staff/approvals` | functional commercial workspace | staff-area Role + AAL2; Founder-only decision/publication |
| `/{locale}/proposal` | functional safe Proposal and Acceptance | exact Customer Role and ownership |
| `/api/v1/staff/commercial` | functional commercial command endpoint | same-origin staff-area Role + AAL2 |
| `/api/v1/customer/commercial` | functional Acceptance endpoint | same-origin Customer session |
| `/{locale}/staff/crm` | linked to commercial review at `HUMAN_REVIEW` | assigned staff + AAL2 |

## E. Verification evidence

### E1. Automated results

| Check | Result |
|---|---|
| TypeScript | PASS |
| Task 005 tests | 9/9 PASS |
| Complete Task 002–005 tests | 42/42 PASS |
| Executable PGlite database tests | 10/10 PASS |
| execution of all four migrations | PASS |
| exact approved/published/accepted hash equality | PASS |
| assigned-operator draft enforcement | PASS |
| staff/non-Founder decision denial | PASS |
| Founder AAL1 denial | PASS |
| exact hash mismatch denial | PASS |
| edit-after-Approval denial | PASS |
| viewing-without-Acceptance separation | PASS |
| wrong-Customer and wrong-locale Acceptance denial | PASS |
| rejection and new-version history | PASS |
| immutable version/decision/publication/Acceptance/receipt evidence | PASS |
| Customer internal-column denial | PASS |
| Customer-to-Customer isolation | PASS |
| staff AAL1 internal-read denial | PASS |
| AZ/RU/EN catalogue parity | PASS |
| responsive and accessibility source contracts | PASS |
| Production build | PASS; 53 pages generated and every route compiled |
| standalone runtime smoke | PASS |
| npm dependency audit | PASS; 0 vulnerabilities |
| original Task 001 HTML audit | PASS; source hash unchanged |

### E2. Runtime HTTP evidence

The standalone Production server proved:

- `/` returns `307` to `/az`;
- `/az/trip-wizard` returns `200` with Azerbaijani content and defensive headers;
- generated CSS and the VOYARA brand SVG return `200`;
- `/az/staff/crm`, `/az/staff/approvals` and `/az/proposal` preserve their exact destination through the login redirect;
- a commercial command without `Origin` returns `403 REQUEST_ORIGIN_DENIED`;
- a same-origin commercial command without a session returns `401 AUTHENTICATION_REQUIRED`;
- nonce CSP and defensive browser permissions remain present.

### E3. Native Supabase test boundary

`supabase/tests/database/004_commercial_approval.test.sql` contains 37 pgTAP assertions covering Task 005 tables, forced RLS, exact policies, RPC privileges and immutable triggers.

Docker is not installed in this environment, so `supabase test db` and `supabase db lint` were not executed locally. The migration was executed repeatedly in PGlite and the behavioral database suite passed. The existing CI workflow remains responsible for the native local-Supabase pgTAP and lint gates.

## F. Commands executed and exact outcomes

Key successful commands:

```text
env HOME=/tmp/voyara-home npx supabase migration new task005_commercial_approval_vertical_slice
  PASS: migration created; telemetry shutdown emitted a non-schema timeout warning

node [PGlite all-migrations harness]
  PASS: all four migrations executed

npm run typecheck
  PASS

npm run test:task005
  PASS: 9 tests

npm test
  PASS: 42 tests

npm run test:db
  PASS: 10 executable database tests

npm run build
  PASS: compile, TypeScript, 53-page generation and standalone preparation

npm run test:runtime
  PASS: protected Proposal/Approval/CRM routes and commercial API origin/Auth boundaries

npm audit --audit-level=low
  PASS: 0 vulnerabilities

npm run test:legacy
  PASS

env [documented synthetic configuration] npm run env:check
  PASS
```

Disclosed failures and corrections:

- the first Approval database run showed that `SELECT ... FOR SHARE` required an unnecessary update privilege on the immutable policy-version table; the lock was removed and least-privilege select access retained;
- an intermediate Customer-data hardening edit applied the Work Receipt `action` predicate to the wrong relation; migration execution failed immediately, the policy targets were corrected and the complete Task 005 database suite passed;
- early deep-equality assertions compared partial expected objects with complete command receipts; assertions were corrected to verify the intended authoritative fields without discarding receipt evidence;
- `npm run env:check` without configuration correctly failed because the five required connection variables are absent; documented synthetic non-Production values passed;
- `docker info` returned `command not found`, so native Supabase lint and pgTAP were not claimed.

## G. Files created or materially changed

Created:

- `src/server/commercial/contract.ts`
- `src/server/commercial/command.ts`
- `src/server/commercial/queries.ts`
- `src/components/commercial-approval-workspace.tsx`
- `src/components/published-proposals.tsx`
- `src/app/api/v1/staff/commercial/route.ts`
- `src/app/api/v1/customer/commercial/route.ts`
- `supabase/migrations/20260717115718_task005_commercial_approval_vertical_slice.sql`
- `supabase/tests/database/004_commercial_approval.test.sql`
- `tests/task-005/commercial-contract.test.ts`
- `tests/task-005/security-contract.test.ts`
- `tests/task-005/database-commercial-approval.test.ts`
- `docs/task-005/VOYARA-TASK-005-IMPLEMENTATION-REPORT.md`

Materially changed:

- `src/app/[locale]/staff/approvals/page.tsx`
- `src/app/[locale]/(customer)/proposal/page.tsx`
- `src/app/[locale]/staff/crm/page.tsx`
- `src/components/travel-request-queue.tsx`
- `src/app/globals.css`
- all three locale catalogues;
- `scripts/runtime-smoke.mjs`
- `package.json`
- `package-lock.json`
- `README.md`

## H. Security and authority assessment

Closed in Task 005 source:

- no Approval detached from exact version/hash;
- no Customer Acceptance caused by viewing;
- no publication before exact Founder Approval;
- no AAL1 staff command or internal read;
- no non-Founder Approval or publication;
- no in-place edit after Approval or Acceptance;
- no rejected-version overwrite;
- no Customer access to internal economics, risk, reasons, staff sessions or draft receipts;
- no browser write grant or privileged RPC grant;
- no cross-origin or unbounded commercial command;
- no autonomous AI commercial decision;
- no premature Payment, Booking, Verification or Voucher authority.

Remaining Production risks:

- hosted Supabase RLS/Auth behavior needs launch-project verification;
- native Docker-backed Supabase lint and pgTAP remain CI-only in this environment;
- Proposal Acceptance wording and Customer terms require legal approval before Production;
- the Founder-only policy is safe for launch but may become a throughput bottleneck; broader monetary limits require an explicit Founder-approved policy version;
- multi-currency and foreign-exchange behavior remain deliberately deferred;
- AI-provider drafting, source citations, prompt evidence and cost tracking remain absent;
- a real-browser keyboard, responsive and WCAG 2.2 AA suite belongs to Production hardening.

## I. Budget assessment

The approved USD 10,000–20,000 initial launch range remains plausible because Task 005 reuses:

- the retained screens and visual system;
- the existing managed Auth/PostgreSQL stack;
- the existing command and session-security patterns;
- manual human quotation preparation;
- Founder-only Approval as a low-complexity launch default;
- no new paid integration or infrastructure service.

## J. Immediate next implementation task

Recommended next task:

**IMPLEMENTATION TASK 006 — Payment Request, Human Payment Verification and Allocation Readiness**

The slice should begin only after a valid exact Customer Acceptance and should implement:

```text
Payment Request
→ Payment detected or evidence received
→ Human Finance review
→ Payment verified
→ Funds allocated
→ Financial readiness evaluated
```

It must keep provider detection separate from human Verification, use manual evidence as the launch fallback, create no Booking until verified Payment or approved Credit exists, and avoid selecting a paid provider without Founder authority and evidence.

