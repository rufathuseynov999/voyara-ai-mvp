# VOYARA AI MVP — Implementation Task 007 Report

## Booking Creation, Human Supplier Execution and Supplier Confirmation Capture

Date: 17 July 2026  
Repository version: `0.7.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 007 is implemented and locally verified.

The retained Trip Room now exposes a safe Customer Booking-progress view, supported by a new AAL2 Booking operations queue:

```text
Valid exact Customer Acceptance
+
READY_FOR_BOOKING financial evidence
→ Booking created
→ accountable human Supplier execution recorded
→ Supplier Confirmation captured as immutable evidence
```

PostgreSQL independently proves the exact accepted quotation version and SHA-256 hash, Customer Acceptance, Payment Request, financial-readiness evaluation and readiness hash before a Booking can exist. The browser cannot provide or change the Customer, accepted amount, currency, quotation identity or Acceptance identity.

The three Task 007 states are deliberately separate:

- `CREATED` proves that the Booking aggregate was created from exact readiness;
- `SUPPLIER_EXECUTED` proves that an AAL2 human recorded a manual Supplier action;
- `SUPPLIER_CONFIRMED` proves that immutable Supplier Confirmation evidence was captured for that exact execution identifier and hash.

Supplier Confirmation is not human Booking Verification. Task 007 creates no Booking Verification, Voucher, Credit, Refund or autonomous Supplier authority. No Supplier adapter, webhook, microservice, queue, Kubernetes component or paid provider was introduced.

The launch fallback is one consolidated trip-level Booking with manual Supplier execution through a portal, email, phone or business messaging. This remains compatible with a small Azerbaijan launch team and the approved budget.

Hosted-provider activation is not claimed. A real Supabase launch project, Production credentials and real Supplier ceremony were not supplied.

## B. Implemented scope

### B1. Exact Booking creation

The `booking.create` command requires:

- one Payment Request in `READY_FOR_BOOKING`;
- the exact current readiness evaluation identifier and SHA-256 hash;
- readiness result `READY_FOR_BOOKING`;
- an immutable financial-readiness row for the same Customer, Acceptance, quotation version and quotation hash;
- a commercial quotation still in exact `ACCEPTED` state with matching current, approved and published version/hash pointers;
- the exact immutable Customer Acceptance;
- AAL2 `staff`, `manager`, `admin` or `founder` authority;
- no existing Booking for the Payment Request or quotation.

The resulting `booking-creation-v1` canonical authority payload is derived server-side and retains:

- Payment Request identifier;
- financial-readiness evaluation identifier and hash;
- Acceptance identifier;
- quotation identifier, version and hash.

One canonical payload hash becomes the Booking authority hash. The Customer, locale, AZN amount and commercial identity are copied only from authoritative records.

### B2. Accountable human Supplier execution

The `supplier_booking.complete` command is available only from `CREATED` and records a separate immutable `supplier-execution-v1` payload containing:

- exact Booking identifier;
- constrained manual channel;
- bounded Supplier name;
- execution timestamp;
- Supplier request reference;
- bounded service summary and internal note;
- explicit human declaration;
- accountable actor, session and AAL2 evidence;
- exact SHA-256 hash.

The command records a human action. It does not contact a Supplier automatically and does not claim Supplier Confirmation.

### B3. Immutable Supplier Confirmation capture

The `supplier_confirmation.capture` command is available only from `SUPPLIER_EXECUTED`. It must reference the current exact Supplier execution identifier and hash.

The canonical `supplier-confirmation-v1` payload includes:

- exact Booking identifier;
- exact execution identifier and hash;
- Supplier name derived from the execution record;
- constrained confirmation channel;
- Supplier confirmation timestamp and bounded reference;
- confirmed-service summary and internal note;
- explicit declaration that Booking Verification remains separate;
- accountable actor, session and AAL2 evidence;
- exact SHA-256 hash.

The record is append-only. Its existence changes the Booking only to `SUPPLIER_CONFIRMED`.

### B4. Live AAL2 Booking operations queue

`/{locale}/staff/bookings` provides:

- financially ready accepted quotations;
- exact Customer, amount, version, quotation hash and readiness hash;
- exact Booking creation;
- manual Supplier execution form;
- immutable execution details and hash;
- exact Supplier Confirmation capture;
- immutable confirmation details and hash;
- Work Receipt feedback;
- repeated warnings that Supplier Confirmation is not Booking Verification or Voucher issue.

The route requires `staff`, `manager`, `admin` or `founder` plus AAL2. Finance alone cannot create or operate a Booking.

### B5. Customer-safe Trip Room progress

`/{locale}/trip-room` no longer renders synthetic state cards. It now exposes only:

- Booking reference;
- exact accepted quotation version and SHA-256 hash;
- localized current status;
- three-stage Booking authority timeline;
- safe progress explanation.

Supplier names, execution channels, references, internal notes, actor identities and command receipts are not exposed to the Customer. The screen does not present an itinerary, document or Voucher as verified.

### B6. Command and abuse controls

The Booking endpoint applies:

- same-origin POST enforcement;
- JSON content-type enforcement;
- exact 32 KiB body limit before JSON parsing;
- verified session and PostgreSQL-authoritative Role checks;
- AAL2 for every command;
- strict Zod schemas with unknown-field rejection;
- required idempotency key;
- canonical payload and command SHA-256 hashes;
- service-secret-only `SECURITY INVOKER` RPC execution;
- per-session and all-session revocation inside PostgreSQL;
- 120 Booking commands per human actor per hour.

An exact idempotent replay returns the original response. Reusing a key with changed command content is denied.

## C. Database changes

Migration:

`supabase/migrations/20260717144340_task007_booking_supplier_confirmation_vertical_slice.sql`

SHA-256:

`478d27257bfa34717a40ee4d5c63a959f94c8b3d27908a2fae27126dcf46aa05`

Created tables:

| Table | Purpose | Customer authority |
|---|---|---|
| `bookings` | Exact readiness-bound Booking aggregate | own safe columns only |
| `supplier_booking_executions` | Immutable accountable human Supplier execution | none |
| `supplier_confirmations` | Immutable exact Supplier Confirmation evidence | none |
| `booking_work_receipts` | Attributable lifecycle receipts | own safe receipts only |
| `booking_command_receipts` | Locked idempotency responses | none |

Every Task 007 table has enabled and forced RLS. All client writes are denied. The public RPC `execute_booking_command` is executable only by `service_role`.

The migration includes explicit table grants in addition to RLS. This is required for deterministic Data API exposure under Supabase's April 2026 default-grant change; RLS and grants remain separate controls.

## D. Routes added or activated

| Route | Status | Authority |
|---|---|---|
| `/{locale}/trip-room` | functional Customer Booking-progress view | exact Customer Role and ownership |
| `/{locale}/staff/bookings` | functional Booking operations queue | operations Role plus AAL2 |
| `/api/v1/staff/bookings` | functional Booking command endpoint | same-origin operations authority plus AAL2 |

## E. Verification evidence

### E1. Automated results

| Check | Result |
|---|---|
| Task 007 focused tests | 9/9 PASS |
| Complete Task 002–007 tests | 60/60 PASS |
| execution of all six migrations in PGlite | PASS |
| Booking before financial readiness | DENIED |
| wrong readiness identifier/hash | DENIED |
| AAL1 Booking command | DENIED |
| Finance-only Booking command | DENIED |
| exact Acceptance and readiness binding | PASS |
| Booking creation without Supplier execution | preserved as `CREATED` |
| Supplier Confirmation before execution | DENIED |
| wrong execution identifier/hash | DENIED |
| human Supplier execution record | PASS |
| immutable Supplier Confirmation capture | PASS |
| Supplier Confirmation without Booking Verification/Voucher | PASS |
| Customer-to-Customer RLS isolation | PASS |
| Customer internal Supplier evidence access | DENIED |
| operations AAL1 internal access | DENIED |
| operations AAL2 internal access | PASS |
| AZ/RU/EN catalogue parity | PASS |
| responsive/accessibility source contracts | PASS |
| Production build | PASS; 62 pages generated and all routes compiled |
| standalone runtime smoke | PASS |
| npm dependency audit | PASS; 0 vulnerabilities |
| secret-pattern scan | PASS; no matches and only `.env.example` exists |
| original Task 001 HTML audit | PASS; source hash unchanged |

### E2. Runtime HTTP evidence

The standalone Production server proved:

- `/az/trip-room` preserves its destination through the Customer login redirect;
- `/az/staff/bookings` preserves its destination through the staff login redirect;
- a Booking command without `Origin` returns `403 REQUEST_ORIGIN_DENIED`;
- a same-origin Booking command without a session returns `401 AUTHENTICATION_REQUIRED`;
- static assets, CSP and defensive browser permissions remain operational.

### E3. Native Supabase boundary

`supabase/tests/database/006_booking_authority.test.sql` contains 27 pgTAP assertions covering Task 007 tables, forced RLS, policies, RPC privileges, immutable triggers, exact-hash columns and the absence of Booking Verification/Voucher tables.

Docker is not installed in this environment, so `supabase test db` and `supabase db lint` were not executed locally. Supabase CLI 2.109.1 is installed. The migration was executed repeatedly in PGlite and the behavioral database suite passed. Existing CI remains responsible for native local-Supabase pgTAP and lint gates.

## F. Principal commands executed and outcomes

```text
npx supabase migration new task007_booking_supplier_confirmation_vertical_slice
  FIRST ATTEMPT: failed because /root/.supabase was read-only

env HOME=/tmp/voyara-task007-home ... npx supabase migration new ...
  FILE CREATED: 20260717144340_task007_booking_supplier_confirmation_vertical_slice.sql
  CLI EXIT 1 AFTER CREATION: PostHog shutdown timeout; migration file remained valid

npm run typecheck
  PASS

npm run test:task007
  PASS: 9 tests, 0 failed

npm test
  PASS: 60 tests, 0 failed

npm run verify
  PASS: typecheck, 60 tests, Production build and runtime smoke

npm run build
  PASS: Production build; 62 pages generated

npm run test:runtime
  PASS: Trip Room and Booking route redirects plus Booking API origin/auth boundaries

npm run env:check
  EXPECTED FAIL-CLOSED: five launch variables are not configured

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

One early ad-hoc migration harness and one initial secret-scan shell expression had quoting errors before testing application code. They were replaced by the committed executable PGlite suite and a safely quoted repository scan; both final checks passed.

No real secret was supplied or written.

## G. Files created

- `src/server/booking/contract.ts`
- `src/server/booking/command.ts`
- `src/server/booking/queries.ts`
- `src/app/api/v1/staff/bookings/route.ts`
- `src/components/booking-operations-queue.tsx`
- `src/components/customer-trip-room.tsx`
- `src/app/[locale]/staff/bookings/page.tsx`
- `supabase/migrations/20260717144340_task007_booking_supplier_confirmation_vertical_slice.sql`
- `supabase/tests/database/006_booking_authority.test.sql`
- `tests/task-007/booking-contract.test.ts`
- `tests/task-007/database-booking-authority.test.ts`
- `tests/task-007/security-contract.test.ts`
- `docs/task-007/VOYARA-TASK-007-IMPLEMENTATION-REPORT.md`

Principal updated files:

- `src/app/[locale]/(customer)/trip-room/page.tsx`
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

Task 007 closes these launch-critical controls:

- no Booking without exact Customer Acceptance and `READY_FOR_BOOKING`;
- no browser-supplied Customer, amount, currency or commercial identity authority;
- no AAL1 or Finance-only operations fallback;
- no AI Booking creation, Supplier execution or Supplier Confirmation capture;
- no Supplier execution detached from its exact Booking;
- no Supplier Confirmation detached from exact execution identifier and hash;
- no Supplier Confirmation treated as Booking Verification;
- no direct browser write or RPC grant;
- no Customer access to Supplier references, notes or actor evidence;
- no cross-origin or unbounded Booking command;
- no Voucher created by Supplier Confirmation.

The RLS design follows Supabase's current guidance: exposed-schema tables enable RLS, Customer reads include an ownership predicate, AAL2 is checked explicitly, and service credentials remain server-only.

## I. Remaining boundaries and genuine Founder decisions

Confirmed implementation boundaries:

- hosted Supabase RLS/Auth behavior requires launch-project verification;
- native Docker-backed Supabase lint and pgTAP remain CI-only in this environment;
- one consolidated Supplier execution and confirmation is supported per accepted quotation;
- multi-Supplier and per-line-item orchestration are absent;
- confirmation evidence records references and metadata, not uploaded documents or screenshots;
- no Supplier API, webhook, automated booking or external Supplier action exists;
- failure, cancellation, expiry, rebooking and amendment states are absent;
- Booking Verification and Voucher issue are intentionally absent;
- real-browser keyboard, responsive and WCAG 2.2 AA suites remain Production-hardening work.

Genuine Founder decisions before Production Supplier operation:

1. Confirm whether the launch model may use one consolidated Supplier per accepted quotation or requires per-line-item/multi-Supplier Booking cases.
2. Confirm whether Supplier confirmation-document upload is launch-critical. If approved, it must use private storage, restricted MIME/size validation, malware controls and signed access rather than public URLs.
3. Select the first Supplier adapter only after manual volume, failure rate, commercial access and security evidence justify it.

## J. Budget assessment

The approved USD 10,000–20,000 launch budget remains realistic for this slice because:

- manual Supplier operation remains the launch default;
- no paid Supplier adapter was selected prematurely;
- no separate Booking service, event bus or queue was introduced;
- PostgreSQL remains the single operational authority;
- the retained Trip Room and existing visual system were extended rather than rebuilt;
- the workflow supports a small accountable launch team.

## K. Immediate next implementation task

**IMPLEMENTATION TASK 008 — Human Booking Verification and Voucher Issuance**

The next coding slice should implement:

```text
Exact Supplier Confirmation
→ separate human Booking Verification
→ immutable verified Booking evidence
→ versioned Voucher generation
→ private Customer delivery
```

Task 008 must preserve:

- Supplier Confirmation is not Booking Verification;
- Booking Verification must bind the exact Booking, Supplier execution and Supplier Confirmation hashes;
- a rejected Verification must preserve evidence and require correction rather than editing history;
- no Voucher may exist before successful human Booking Verification;
- Voucher access must be private to the Customer and authorised staff;
- AI may prepare Voucher content but may not verify the Booking or issue the Voucher.
