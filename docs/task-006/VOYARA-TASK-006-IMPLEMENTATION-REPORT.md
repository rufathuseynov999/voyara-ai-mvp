# VOYARA AI MVP — Implementation Task 006 Report

## Payment Request, Human Payment Verification and Allocation Readiness

Date: 17 July 2026  
Repository version: `0.6.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 006 is implemented and locally verified.

The retained Payment and Confirmation screen now forms a real financial-control vertical slice:

```text
Exact Customer Acceptance
→ Payment Request
→ Payment evidence or Finance detection
→ Human Finance review
→ Human Payment Verification
→ Funds allocation
→ Financial readiness evaluated
→ READY_FOR_BOOKING
```

The implementation enforces the central authority rule: a Customer receipt, bank reference, manual Finance observation or future provider event is evidence only. It does not verify Payment, allocate funds or create financial readiness.

An AAL2 human with `finance`, `admin` or `founder` authority must review and explicitly verify one exact evidence record and SHA-256 hash. Only an AAL2 `finance` or `founder` actor may allocate the verified funds and evaluate readiness. The database independently verifies the exact accepted quotation, Customer Acceptance, amount, currency, evidence, review, Verification and allocation chain.

`READY_FOR_BOOKING` is evidence that the next workflow may begin. Task 006 creates no Booking, Supplier Confirmation, Booking Verification, Voucher, Credit or Refund authority.

Manual bank/card references are the launch fallback. No paid Payment provider or webhook was selected without Founder authority and evidence. The implementation remains one Next.js application with one managed Supabase/PostgreSQL authority boundary. No microservice, Kubernetes cluster, queue or new paid dependency was introduced.

Hosted-provider activation is not claimed. A real Supabase launch project and Production credentials were not supplied, so hosted Auth/RLS behavior and a real bank/acquirer ceremony were not exercised.

## B. Implemented scope

### B1. Exact Payment Request

An AAL2 Finance, Admin or Founder may create one Payment Request only when PostgreSQL proves:

- the Quotation is in `ACCEPTED` state;
- current, approved, published and accepted versions match;
- current, approved, published and accepted SHA-256 hashes match;
- one immutable Customer Acceptance exists for that exact version and hash;
- the Customer total is valid AZN minor-unit data;
- no prior Payment Request exists for the Quotation.

The amount, currency, Customer, locale and quotation identity are derived from authoritative records. They are not accepted from the browser. A database trigger makes the Payment Request identity and amount immutable.

### B2. Evidence and detection remain unverified

The Customer may submit:

- a bank-transfer reference; or
- a card-Payment reference.

Finance may manually record:

- a bank-statement observation; or
- an acquirer-dashboard observation.

Every submission creates a canonical `payment-evidence-v1` record with:

- exact Payment Request identifier;
- source kind and constrained channel;
- AZN amount in integer minor units;
- observed timestamp;
- bounded external reference and note;
- explicit accuracy declaration;
- SHA-256 hash;
- accountable actor, session and assurance evidence.

Evidence records are append-only. Customers cannot read internal evidence rows, Finance observations, reviewer identities or command receipts. The Customer-safe Payment Request exposes only the exact commercial reference, amount, lifecycle status and stage timestamps.

### B3. Human Finance review and Verification

Permitted financial state progression:

```text
REQUESTED
→ EVIDENCE_RECEIVED
→ UNDER_REVIEW
→ VERIFIED
```

Rejection branch:

```text
UNDER_REVIEW
→ EVIDENCE_REJECTED
→ new immutable evidence version
→ EVIDENCE_RECEIVED
→ UNDER_REVIEW
```

Controls:

- review requires the current exact evidence identifier and hash;
- Verification requires the same reviewed evidence identifier and hash;
- the Verification decision has its own canonical payload and SHA-256 hash;
- `VERIFY` is denied unless evidence amount and currency equal the Payment Request exactly;
- `REJECT` preserves the evidence, review and immutable decision;
- a new evidence version never overwrites rejected evidence;
- AAL1 actors are denied;
- AI actors remain denied by the BOS authority policy;
- `finance`, `admin` and `founder` may verify; no staff or manager fallback exists.

### B4. Funds allocation

Allocation is a separate `funds.allocate` command and record. It requires:

- Payment Request status `VERIFIED`;
- exact current Verification identifier and hash;
- an immutable human `VERIFY` decision;
- exact full amount and AZN currency;
- AAL2 `finance` or `founder` authority.

Admin may perform Finance review and Verification but cannot allocate funds. The allocation record represents VOYARA's internal allocation evidence; it does not execute an external bank transfer.

### B5. Financial readiness

Readiness is a separate `payment.evaluate_readiness` command. PostgreSQL requires:

- Payment Request status `ALLOCATED`;
- exact current allocation identifier and hash;
- full allocation equal to the verified Payment amount;
- exact immutable Customer Acceptance for the same quotation version and hash;
- AAL2 `finance` or `founder` authority.

The resulting immutable evaluation records:

- `READY_FOR_BOOKING`;
- `VERIFIED_PAYMENT_FULLY_ALLOCATED`;
- exact acceptance, allocation and quotation references;
- canonical readiness input and SHA-256 hash;
- accountable actor and session evidence.

No Booking row, Supplier call, Booking Verification or Voucher is created.

### B6. Live Customer Payment screen

`/{locale}/payment` now provides:

- exact Payment Request and amount;
- accepted Quotation version and SHA-256;
- localized current status;
- six-stage authority timeline;
- manual evidence form only in valid states;
- explicit declaration and evidence-only warning;
- `READY_FOR_BOOKING` explanation that excludes Booking and Voucher authority.

The screen is available consistently in Azerbaijani, Russian and English and no longer renders the synthetic `ScreenPreview` state cards.

### B7. AAL2 Finance queue

`/{locale}/staff/finance` provides:

- accepted Quotations awaiting Payment Request creation;
- exact Customer, amount, version and quotation hash;
- manual detection entry;
- current exact evidence and evidence hash;
- human review start;
- Verification or rejection with required reason;
- Finance/Founder-only allocation;
- Finance/Founder-only readiness evaluation;
- immutable Work Receipt feedback.

The route requires `finance`, `admin` or `founder` plus AAL2. A session banner link exposes the queue only to those Roles.

### B8. Command and abuse controls

Both Payment endpoints apply:

- same-origin POST enforcement;
- JSON content-type enforcement;
- exact byte limits before JSON parsing;
- verified session and PostgreSQL-authoritative Role checks;
- AAL2 for every staff command;
- command-specific allocation authority;
- strict Zod schemas with unknown-field rejection;
- required idempotency key;
- canonical payload and command SHA-256 hashes;
- service-secret-only `SECURITY INVOKER` RPC execution;
- per-session and all-session revocation inside PostgreSQL;
- 10 Customer financial commands per 24 hours;
- 120 staff financial commands per hour.

An exact idempotent replay returns the original response. Reusing a key with changed command content is denied.

## C. Database changes

Migration:

`supabase/migrations/20260717143000_task006_payment_verification_vertical_slice.sql`

SHA-256:

`eed87d5499530d62eb79a178cf1da819120e0150be2ae0c92c46629d2c6b3d07`

Created tables:

| Table | Purpose | Customer authority |
|---|---|---|
| `payment_requests` | Exact accepted-quotation aggregate and safe lifecycle status | own safe columns only |
| `payment_evidence_versions` | Immutable unverified evidence/detection versions | none |
| `payment_review_events` | Immutable human Finance review start | none |
| `payment_verification_decisions` | Immutable exact human decisions | none |
| `fund_allocations` | Immutable exact internal allocation evidence | none |
| `financial_readiness_evaluations` | Immutable deterministic readiness evidence | none |
| `financial_work_receipts` | Attributable lifecycle receipts | own safe receipts only |
| `financial_command_receipts` | Locked idempotency responses | none |

Every Task 006 table has enabled and forced RLS. All client writes are denied. The public RPC `execute_payment_command` is executable only by `service_role`.

## D. Routes added or activated

| Route | Status | Authority |
|---|---|---|
| `/{locale}/payment` | functional Customer Payment lifecycle | exact Customer Role and ownership |
| `/{locale}/staff/finance` | functional Finance queue | `finance`, `admin` or `founder` + AAL2 |
| `/api/v1/customer/payments` | functional evidence endpoint | same-origin Customer session |
| `/api/v1/staff/payments` | functional financial command endpoint | same-origin Finance authority + AAL2 |

## E. Verification evidence

### E1. Automated results

| Check | Result |
|---|---|
| Restored Task 005 TypeScript baseline | PASS |
| Restored Task 002–005 baseline tests | 42/42 PASS |
| Task 006 focused tests | 9/9 PASS |
| Complete Task 002–006 tests | 51/51 PASS |
| execution of all five migrations in PGlite | PASS |
| exact Acceptance-to-Payment Request binding | PASS |
| evidence-without-Verification separation | PASS |
| wrong-Customer evidence denial | PASS |
| wrong evidence hash denial | PASS |
| AAL1 Finance decision denial | PASS |
| wrong-amount Verification denial | PASS |
| rejection and new evidence history | PASS |
| Admin allocation denial | PASS |
| exact human Verification-to-allocation binding | PASS |
| allocation-to-readiness binding | PASS |
| no Booking table after readiness | PASS |
| immutable evidence/review/decision/allocation/readiness/receipt records | PASS |
| Customer-to-Customer RLS isolation | PASS |
| Customer internal evidence denial | PASS |
| Finance AAL1 internal-read denial | PASS |
| AZ/RU/EN catalogue parity | PASS |
| responsive/accessibility source contracts | PASS |
| Production build | PASS; 58 pages generated and all routes compiled |
| standalone runtime smoke | PASS |
| npm dependency audit | PASS; 0 vulnerabilities |
| original Task 001 HTML audit | PASS; source hash unchanged |

### E2. Runtime HTTP evidence

The standalone Production server proved:

- `/` returns `307` to `/az`;
- localized public content and static assets return `200`;
- `/az/payment` preserves its destination through the Customer login redirect;
- `/az/staff/finance` preserves its destination through the staff login redirect;
- a Payment command without `Origin` returns `403 REQUEST_ORIGIN_DENIED`;
- a same-origin Payment command without a session returns `401 AUTHENTICATION_REQUIRED`;
- nonce CSP and defensive browser permissions remain present.

### E3. Native Supabase boundary

`supabase/tests/database/005_payment_authority.test.sql` contains 36 pgTAP assertions covering Task 006 tables, forced RLS, policies, RPC privileges, immutable triggers and exact-hash columns.

Docker is not installed in this environment, so `supabase test db` and `supabase db lint` were not executed locally. Supabase CLI 2.109.1 is installed. The migration was executed repeatedly in PGlite and the behavioral database suite passed. Existing CI remains responsible for native local-Supabase pgTAP and lint gates.

## F. Principal commands executed and outcomes

```text
env HOME=/tmp/voyara-task006-home npm_config_cache=/tmp/voyara-task006-npm-cache npm ci --ignore-scripts
  PASS: 95 packages installed

npm run typecheck
  PASS

npm test  [Task 005 baseline]
  PASS: 42 tests, 0 failed

npm run test:task006
  PASS: 9 tests, 0 failed

npm test  [complete Task 002–006 suite]
  PASS: 51 tests, 0 failed

npm run build
  PASS: Production build; 58 pages generated

npm run test:runtime
  PASS: Payment and Finance route redirects plus Payment API origin/auth boundaries

env ...synthetic reserved values... npm run env:check
  PASS: publishable/secret/database separation accepted

npm audit --audit-level=low
  PASS: 0 vulnerabilities

npm run test:legacy
  PASS: preserved eight-screen reference audit

sha256sum reference/task-001/voyara-mvp-demo-july7-10.html
  PASS: dcf076419625a71676fe8029da574dfca0eb86259152c747552cb46a74f62ceb

docker --version
  NOT EXECUTED: docker command is not installed
```

The first environment check without a configured `.env.local` failed closed and reported the five expected missing launch variables. A second check with reserved synthetic values passed. No real secret was supplied or written.

## G. Files created

- `src/server/payment/contract.ts`
- `src/server/payment/command.ts`
- `src/server/payment/queries.ts`
- `src/app/api/v1/customer/payments/route.ts`
- `src/app/api/v1/staff/payments/route.ts`
- `src/components/customer-payment-workspace.tsx`
- `src/components/finance-payment-queue.tsx`
- `src/app/[locale]/staff/finance/page.tsx`
- `supabase/migrations/20260717143000_task006_payment_verification_vertical_slice.sql`
- `supabase/tests/database/005_payment_authority.test.sql`
- `tests/task-006/payment-contract.test.ts`
- `tests/task-006/database-payment-authority.test.ts`
- `tests/task-006/security-contract.test.ts`
- `docs/task-006/VOYARA-TASK-006-IMPLEMENTATION-REPORT.md`

Principal updated files:

- `src/app/[locale]/(customer)/payment/page.tsx`
- `src/components/access-banner.tsx`
- `src/server/bos/authority.ts`
- `src/i18n/messages/az.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/en.json`
- `src/app/globals.css`
- `scripts/runtime-smoke.mjs`
- `package.json`
- `package-lock.json`
- `README.md`

## H. Security and authority review

Task 006 closes these launch-critical controls:

- no Payment Request without exact Customer Acceptance;
- no browser-supplied Payment amount or currency authority;
- no provider detection or Customer evidence treated as verified Payment;
- no review detached from exact evidence and hash;
- no AAL1 financial command;
- no staff/manager Payment Verification fallback;
- no Admin funds allocation;
- no allocation detached from exact human Verification;
- no readiness detached from exact Acceptance and full allocation;
- no AI Payment Verification, allocation or readiness decision;
- no direct browser write or RPC grant;
- no cross-origin or unbounded financial command;
- no Booking, Supplier Confirmation, Booking Verification or Voucher created by readiness.

## I. Remaining boundaries and genuine Founder decisions

Confirmed implementation boundaries:

- hosted Supabase RLS/Auth behavior requires launch-project verification;
- native Docker-backed Supabase lint and pgTAP remain CI-only in this environment;
- manual evidence currently records references and metadata, not uploaded receipt images;
- no Payment provider or webhook is integrated;
- no external bank movement is executed by `funds.allocate`;
- one exact full-amount AZN Payment Request is supported;
- deposits, split payments, overpayments, underpayments and multi-currency/FX remain absent;
- Credit, Refund and chargeback authority remain absent;
- real-browser keyboard, responsive and WCAG 2.2 AA suites remain Production-hardening work.

Genuine Founder decisions before Production Payment activation:

1. Select the launch acquiring/bank evidence source only after commercial, settlement, refund, security and webhook evidence is reviewed.
2. Confirm whether launch requires full payment only or an approved deposit/balance schedule. Task 006 safely defaults to one exact full payment and does not invent split-payment rules.
3. Confirm whether receipt-image upload is launch-critical. If approved, it must use private storage, restricted MIME/size validation, malware controls and signed access rather than public URLs.

## J. Budget assessment

The approved USD 10,000–20,000 launch budget remains realistic for this slice because:

- no paid provider was selected prematurely;
- manual bank/card evidence is a viable launch fallback;
- no separate Finance service or queue was introduced;
- PostgreSQL remains the single financial authority;
- the existing Payment screen and visual system were retained;
- the workflow supports a small launch team and accountable Founder/Finance operation.

## K. Immediate next implementation task

**IMPLEMENTATION TASK 007 — Booking Creation, Human Supplier Execution and Supplier Confirmation Capture**

The next coding slice should implement:

```text
Valid exact Customer Acceptance
+
READY_FOR_BOOKING financial evidence
→ Booking created
→ human Supplier booking execution recorded
→ Supplier Confirmation captured as immutable evidence
```

Task 007 must preserve these separations:

- `READY_FOR_BOOKING` is not a Booking;
- Booking creation is not Supplier execution;
- Supplier execution is not Supplier Confirmation;
- Supplier Confirmation is not human Booking Verification;
- no Voucher may be issued before later human Booking Verification.
