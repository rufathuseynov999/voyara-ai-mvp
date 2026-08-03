# VOYARA AI MVP — Implementation Task 008 Report

## Human Booking Verification and Voucher Issuance

Date: 17 July 2026  
Repository version: `0.8.0`  
Founder: Rufat Huseynov  
Launch market: Azerbaijan

## A. Executive outcome

Task 008 is implemented and locally verified.

The retained Booking operations queue and Trip Room now support the complete authority chain:

```text
Exact Supplier Confirmation
→ separate human Booking Verification review
→ immutable VERIFY or REJECT decision
→ versioned Voucher draft
→ separate exact-version Voucher issuance
→ private Customer delivery
```

Supplier Confirmation is never treated as Booking Verification. A Voucher cannot be drafted until PostgreSQL proves a successful human Verification against the exact Booking, Supplier execution and Supplier Confirmation identifiers and SHA-256 hashes. A Voucher cannot be delivered until a separately authorised human issues one exact immutable Voucher version and hash.

Verification is limited to AAL2 `manager`, `admin` or `founder` authority. The verifier cannot be the same human who executed the Supplier action or captured the current Supplier Confirmation. Voucher preparation is available to accountable AAL2 operations staff; issuance is separately limited to AAL2 `manager`, `admin` or `founder` authority.

A rejected Verification preserves the original confirmation and rejection evidence. Operations must append a corrected Supplier Confirmation version bound to the superseded evidence and exact rejection decision before starting a new review. Approved or rejected evidence is never edited in place.

The Customer sees only the exact issued Voucher version in the private AZ/RU/EN Trip Room. Draft Voucher versions, Verification decisions, internal notes, Supplier references and actor evidence remain unavailable to Customer sessions.

AI may be declared as assistance used while a human prepares Voucher content, but AI has no database Role, Verification command or issuance authority. No AI, Supplier, messaging, file-storage or Payment provider was introduced.

Hosted-provider activation is not claimed. Production Supabase linkage, credentials, SMTP/domain setup and Founder bootstrap were not supplied.

## B. Implemented scope

### B1. Exact human Booking Verification

The separate review flow is bound to:

- one exact Booking and Booking authority hash;
- one exact Supplier execution identifier and hash;
- the current exact Supplier Confirmation identifier, version and hash;
- an accountable AAL2 human reviewer and session;
- four explicit checklist assertions;
- an immutable `VERIFY` or `REJECT` decision, rationale, canonical payload and SHA-256 hash.

The database independently denies:

- AAL1 review or decision attempts;
- `staff`-only Verification authority;
- a reviewer who executed the Supplier action;
- a reviewer who captured the current Supplier Confirmation;
- stale, superseded or mismatched evidence;
- changed identifiers or hashes;
- a Verification decision without the complete checklist;
- autonomous AI Verification.

Successful Verification advances the Booking to `BOOKING_VERIFIED`. Rejection advances it to `VERIFICATION_REJECTED` and creates no Voucher authority.

### B2. Correction without rewriting history

After rejection, an authorised AAL2 operations human can append a new Supplier Confirmation version. The canonical correction payload retains:

- the superseded confirmation identifier, version and hash;
- the exact rejected Verification decision identifier and hash;
- the exact Supplier execution identifier and hash;
- corrected bounded Supplier evidence;
- the accountable actor, session and new SHA-256 hash.

The previous confirmation and rejection remain immutable and attributable. The corrected confirmation becomes the only current evidence eligible for a new independent review.

### B3. Immutable versioned Voucher preparation

After exact successful Verification, an AAL2 operations human can prepare a Voucher draft. Each immutable Voucher version is bound to:

- Booking identifier and authority hash;
- accepted quotation identifier, exact version and hash;
- Supplier execution identifier and hash;
- Supplier Confirmation identifier, version and hash;
- Booking Verification identifier and hash;
- localized Customer-safe travel and support content;
- preparation actor and session;
- whether AI assistance was declared;
- one canonical payload and SHA-256 hash.

Draft revisions append version 2, 3 and onward. Earlier versions cannot be updated or deleted. AI assistance is metadata only and grants no authority.

### B4. Separate exact-version Voucher issuance

Only an AAL2 `manager`, `admin` or `founder` can issue a Voucher. Issuance must name the current exact draft version and hash, and PostgreSQL revalidates the complete Booking and Verification authority chain.

The immutable issuance event records the exact Voucher, version, hash, actor, session and issuance payload. Issuance moves the Booking to `VOUCHER_ISSUED`; it does not alter any prior evidence.

### B5. Private Customer delivery

`/{locale}/trip-room` now provides:

- a localized Booking authority timeline;
- safe `UNDER_VERIFICATION`, rejection/correction, verified, draft and issued states;
- one private Customer Voucher card only after issuance;
- only the exact issued Voucher version and Customer-safe content.

Customer table privileges omit internal Booking pointers. RLS additionally restricts access by authenticated Customer ownership and issued-version identity. A Customer cannot read another Customer's Voucher, any draft, historical draft version, Verification evidence or internal Supplier evidence.

### B6. Live Booking operations workflow

`/{locale}/staff/bookings` now supports:

- starting an exact-evidence Verification review;
- the four-part human checklist;
- immutable VERIFY or REJECT decisions;
- clear verifier-independence enforcement;
- corrected Supplier Confirmation append after rejection;
- Voucher draft preparation and immutable revision;
- exact-version Voucher issuance;
- work-receipt feedback and visible authority hashes.

The retained visual direction, three-language route tree and responsive patterns were extended rather than redesigned.

### B7. Command and abuse controls

`/api/v1/staff/fulfilment` applies:

- same-origin POST enforcement;
- JSON content-type enforcement;
- a 65,536-byte body limit before JSON parsing;
- authenticated session and PostgreSQL-authoritative Role checks;
- AAL2 for every fulfilment command;
- strict Zod schemas with unknown-field rejection;
- stable raw-input command hashes and required idempotency keys;
- service-secret-only `SECURITY INVOKER` database execution;
- per-session and all-session revocation inside PostgreSQL;
- per-human rate controls;
- bounded canonical content and immutable Work/Command Receipts.

An exact replay returns the original result. Reusing an idempotency key with changed content is denied.

## C. Database changes

Migration:

`supabase/migrations/20260717175117_task008_booking_verification_voucher_vertical_slice.sql`

SHA-256:

`c74508172940ce7ed8157330307eb19630a9e865f7dd2ef45b97111eb4d0598c`

Created tables:

| Table | Purpose | Customer authority |
|---|---|---|
| `booking_verification_reviews` | Exact-evidence independent human review | none |
| `booking_verification_decisions` | Immutable VERIFY/REJECT decision and hash | none |
| `vouchers` | Voucher aggregate and issued-version authority | own issued Voucher only |
| `voucher_versions` | Immutable exact-authority Voucher content versions | own exact issued version only |
| `voucher_issuance_events` | Immutable exact-version human issuance | none |
| `fulfilment_work_receipts` | Attributable fulfilment lifecycle receipts | none |
| `fulfilment_command_receipts` | Locked idempotency responses | none |

`supplier_confirmations` was extended into append-only versioned evidence with supersession and rejection bindings. `bookings` was extended with separated Verification and Voucher lifecycle states and authority pointers.

All Task 008 tables have enabled and forced RLS. Client writes are denied. The public RPC `execute_fulfilment_command` is executable only by `service_role`. Explicit grants and RLS are both applied because they are separate controls under current Supabase Data API behavior.

## D. Routes added or activated

| Route | Status | Authority |
|---|---|---|
| `/{locale}/trip-room` | private issued-Voucher delivery and Booking progress | exact Customer Role and ownership |
| `/{locale}/staff/bookings` | Verification, correction, Voucher preparation and issue | AAL2 operations; elevated Role for Verification/issue |
| `/api/v1/staff/fulfilment` | fulfilment command endpoint | same-origin authenticated AAL2 authority |

## E. Verification evidence

### E1. Automated results

| Check | Result |
|---|---|
| Task 008 focused tests | 11/11 PASS |
| Complete Task 002–008 tests | 71/71 PASS |
| execution of all seven migrations in PGlite | PASS |
| exact hash mismatch | DENIED |
| AAL1 or `staff`-only Verification | DENIED |
| same human execution/capture and Verification | DENIED |
| rejection followed by Voucher issue | DENIED |
| rejected Supplier evidence retained | PASS |
| corrected Supplier Confirmation version append | PASS |
| second exact-evidence review and Verification | PASS |
| immutable Voucher version 1 and revision 2 | PASS |
| exact version 2 issue | PASS |
| Customer draft or internal evidence access | DENIED |
| Customer access to internal Booking pointers | DENIED |
| owning Customer exact issued version access | PASS |
| other Customer Voucher access | DENIED |
| operations AAL1 internal access | DENIED |
| operations AAL2 internal access | PASS |
| immutable evidence update/delete | DENIED |
| AI Verification or issuance | DENIED |
| AZ/RU/EN catalogue parity | PASS |
| responsive/accessibility source contracts | PASS |
| Production build | PASS; 63 pages generated and all routes compiled |
| standalone runtime smoke | PASS |
| npm dependency audit | PASS; 0 vulnerabilities |
| secret/data scan | PASS; synthetic test/CI placeholders only and only `.env.example` exists |
| original Task 001 HTML audit | PASS; preserved legacy findings unchanged |

### E2. Runtime HTTP evidence

The standalone Production server proved:

- localized public and protected routes compile and serve;
- `/{locale}/trip-room` preserves its destination through Customer login;
- `/{locale}/staff/bookings` preserves its destination through staff login;
- a fulfilment command without `Origin` returns the origin-denied response;
- a same-origin fulfilment command without a session returns the authentication-required response;
- static assets, CSP and defensive browser permissions remain operational.

### E3. Native Supabase boundary

`supabase/tests/database/007_fulfilment_authority.test.sql` contains 34 pgTAP assertions covering Task 008 tables, forced RLS, policies, RPC privileges, immutable triggers, authority columns and grants.

Docker and a local PostgreSQL/Supabase stack are not installed in this environment. Therefore `supabase test db` and `supabase db lint` could not connect and did not execute their native assertions/advisors. All seven migrations were applied repeatedly in PGlite, and the full behavioral database suite passed. Existing CI remains responsible for the native Supabase pgTAP and lint gates.

## F. Principal commands executed and outcomes

```text
env HOME=/tmp/voyara-task008-home npm_config_cache=/tmp/voyara-task008-npm-cache npm ci
  PASS: 95 packages installed

env HOME=/tmp/voyara-task008-home ... npx supabase migration new task008_booking_verification_voucher_vertical_slice
  FILE CREATED: 20260717175117_task008_booking_verification_voucher_vertical_slice.sql
  CLI EXIT 1 AFTER CREATION: PostHog shutdown timeout; migration file remained valid

npm run typecheck
  PASS

npm run test:task008
  PASS: 11 tests, 0 failed

npm test
  PASS: 71 tests, 0 failed

npm run verify
  PASS: typecheck, 71 tests, Production build and runtime smoke

npm run build
  PASS through verify: Production build; 63 pages generated

npm run test:runtime
  PASS through verify: protected routes and every current API origin/auth boundary

npm run env:check
  EXPECTED FAIL-CLOSED: app URL, Supabase URL, publishable key, secret key and database URL are absent

env ...synthetic reserved values... npm run env:check
  PASS: publishable/secret/database separation accepted; demo mode disabled

npm audit --audit-level=low
  PASS: 0 vulnerabilities

npm run test:legacy
  PASS: preserved eight-screen reference audit

npm run db:lint
  NOT EXECUTED: local PostgreSQL connection unavailable; CLI also reported a telemetry shutdown timeout

npm run db:test
  NOT EXECUTED: local PostgreSQL connection unavailable; CLI also reported a telemetry shutdown timeout

docker --version
  NOT EXECUTED: Docker command is not installed
```

No real secret, Production personal data or external provider credential was supplied or written.

## G. Files created

- `src/server/fulfilment/contract.ts`
- `src/server/fulfilment/command.ts`
- `src/app/api/v1/staff/fulfilment/route.ts`
- `supabase/migrations/20260717175117_task008_booking_verification_voucher_vertical_slice.sql`
- `supabase/tests/database/007_fulfilment_authority.test.sql`
- `tests/task-008/database-fulfilment-authority.test.ts`
- `tests/task-008/fulfilment-contract.test.ts`
- `tests/task-008/security-contract.test.ts`
- `docs/task-008/VOYARA-TASK-008-IMPLEMENTATION-REPORT.md`

Principal updated files:

- `src/server/booking/contract.ts`
- `src/server/booking/queries.ts`
- `src/server/bos/authority.ts`
- `src/components/booking-operations-queue.tsx`
- `src/components/customer-trip-room.tsx`
- `src/app/[locale]/staff/bookings/page.tsx`
- `src/i18n/messages/az.json`
- `src/i18n/messages/ru.json`
- `src/i18n/messages/en.json`
- `src/app/globals.css`
- `scripts/runtime-smoke.mjs`
- `tests/task-007/security-contract.test.ts`
- `supabase/tests/database/006_booking_authority.test.sql`
- `package.json`
- `package-lock.json`
- `README.md`

## H. Security and authority review

Task 008 closes these launch-critical controls:

- no Booking Verification inferred from Supplier Confirmation;
- no same-human self-verification of Supplier work or evidence capture;
- no AAL1 or base-staff Verification fallback;
- no stale or mismatched Confirmation hash accepted;
- no rejected evidence overwritten or silently retried;
- no Voucher before successful exact-evidence human Verification;
- no draft edit in place;
- no issue of a changed or stale Voucher version/hash;
- no AI Booking Verification or Voucher issuance;
- no Customer access to drafts, other versions, internal evidence or another Customer's Voucher;
- no direct browser database write or public RPC grant;
- no cross-origin, unbounded or unattributed fulfilment command;
- no service secret in browser code.

The RLS design follows current Supabase guidance: exposed-schema tables enable RLS, explicit table grants are least privilege, Customer reads carry ownership and issued-version constraints, staff AAL2 is checked explicitly, and service credentials remain server-only.

References reviewed:

- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://supabase.com/docs/guides/api/securing-your-api>
- <https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically>

## I. Remaining boundaries and genuine Founder decisions

Confirmed implementation boundaries:

- hosted Supabase RLS/Auth behavior still requires launch-project verification;
- native Docker-backed Supabase lint and pgTAP remain CI-only in this environment;
- the private Voucher is responsive HTML inside Trip Room, not a downloadable PDF or stored document;
- the database supports multiple confirmed services, while the launch UI records one consolidated confirmed-service block per Supplier Confirmation version;
- no Supplier document upload, private object storage or malware scanning is implemented;
- no Production Supplier, Payment, AI, CRM, messaging or email integration exists;
- Credit, cancellation, amendment, Refund, compensation and chargeback authorities are absent;
- no Customer Support case workflow or operational Exception management exists;
- real-browser keyboard, responsive and WCAG 2.2 AA suites remain Production-hardening work.

Genuine Founder decisions before Production Voucher operation:

1. Confirm whether the launch Voucher may remain private responsive HTML or requires a downloadable PDF. A PDF requirement adds template/version rendering, private storage, file validation and signed delivery work.
2. Confirm whether the launch model may use one consolidated Supplier/service block per accepted trip or needs per-line-item/multi-Supplier Voucher sections.
3. Confirm whether Supplier confirmation-document upload is launch-critical. If approved, it requires private storage, restricted MIME/size validation, malware controls and signed access.

No decision is required to proceed with the next core implementation slice.

## J. Budget assessment

The approved USD 10,000–20,000 launch budget remains realistic for this slice because:

- PostgreSQL remains the single operational authority;
- no paid AI, Supplier, document or messaging provider was added;
- no microservice, queue, event bus or Kubernetes component was introduced;
- responsive HTML is the initial private Voucher delivery fallback;
- the retained Booking queue and Trip Room were extended instead of rebuilt;
- manual accountable operations remain suitable for a small launch team.

## K. Immediate next implementation task

**IMPLEMENTATION TASK 009 — Trip Room Support and Exception Management**

The next coding slice should implement:

```text
Issued Voucher / active Trip Room
→ authenticated Customer Support request
→ accountable human-owned case
→ priority and escalation
→ immutable case events
→ Customer-safe status updates
```

Task 009 must preserve:

- Support activity does not alter Booking, Payment or Voucher authority;
- Refund, cancellation and compensation remain separate human Approval authorities;
- Customer-visible updates exclude internal notes and sensitive Supplier evidence;
- AI may classify, summarize or draft a response but may not resolve a case, promise compensation or approve a Refund;
- manual operations remain the launch fallback until case volume justifies integrations.
