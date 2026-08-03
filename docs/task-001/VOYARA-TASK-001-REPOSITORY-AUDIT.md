# VOYARA AI — TASK 001 REPOSITORY AND EXISTING MVP AUDIT

**Status:** Complete  
**Audit date:** 2026-07-17  
**Founder:** Rufat Huseynov  
**Audited implementation:** `reference/task-001/voyara-mvp-demo-july7-10.html`  
**Recovered source name:** `voyara-mvp-demo-july7 10.html`  
**SHA-256:** `dcf076419625a71676fe8029da574dfca0eb86259152c747552cb46a74f62ceb`

> **Task 002 preservation note:** the unchanged source and original audit harness were moved to `reference/task-001/` so personal-looking fixtures and simulated authority are not served by the new public application. This document otherwise remains the historical Task 001 record.

## 1. Executive finding

The recovered MVP is **structurally reusable as the approved visual and interaction reference**, but it is not a functional launch MVP. It is a polished, self-contained investor demonstration: eight DOM screen states, hard-coded examples, three small navigation scripts, embedded images, and no application backend.

The correct treatment is a **controlled partial rebuild beneath the retained experience**:

- preserve the eight-screen structure, brand language, visual tokens, Human Approval Gate concept, Work Receipt, Founder Command Center, Trip Room, and CRM presentation;
- extract those accepted surfaces into the ratified production stack rather than repainting them;
- replace simulated commercial actions with server-authoritative vertical slices;
- do not carry hard-coded prices, benefits, metrics, personal fixtures, or authority claims into Production.

The largest launch gaps are the complete absence of Travel Request capture, authentication and Roles, PostgreSQL migrations in this repository, APIs, content-bound Approval, Customer Acceptance, Payment Verification and allocation, Booking Verification, Voucher authority, Refund controls, secure document access, and provider integrations.

The largest security and authority risk is **false authority**: the interface says that prices, Payments, Bookings, vouchers and audit entries are approved or immutable, but every such state is static HTML. There is no authenticated actor, canonical payload, SHA-256 hash, database guard, immutable ledger, or permission boundary behind the claim.

The approved USD 10,000–20,000 launch budget remains realistic only for a narrow Azerbaijan-first vertical-slice MVP using the ratified modular monolith, managed PostgreSQL, a small team, manual Supplier execution, manual Finance verification, and one integration at a time. It is not realistic for implementing the entire future-state architecture or all integrations simultaneously.

## 2. Scope and evidence rule

### 2.1 What was actually recovered

The newest retained executable implementation was one HTML file, modified on 2026-07-10. No Git history, application repository, backend source, migrations, provider configuration, deployment project, or existing tests accompanied it.

The file was copied byte-for-byte to `reference/task-001/voyara-mvp-demo-july7-10.html`; both copies produced the same SHA-256 listed above. The audit wrapper added around it is clearly separated from the recovered implementation.

### 2.2 Control documents reconciled

The following retained control documents were consulted without creating a new architecture document:

- `VOYARA-Production-Architecture-v2_1.md`
- `VOYARA-Database-Architecture-v2_2.md`
- `VOYARA-API-Architecture-v2_3.md`
- the current Task 001 Founder instructions, which override older pricing and product conflicts

The retained Production Architecture proposes Next.js App Router/PWA, managed Supabase Postgres, RLS, a single Node/TypeScript Business Operations Service (BOS), Postgres-backed jobs, Vercel for the frontend, and no microservices. The API document explicitly states that its contract design had **no implementation**. The database document describes a future 58-table design and states that its migrations had not been executed, while separately referring to an external 45-table staging environment. No credentials, migration files, schema dump, or repository evidence were available to verify that external staging claim. It is therefore recorded as **documented but unverified**, not as implemented scope.

## 3. Repository inventory

### 3.1 Pre-audit implementation inventory

| Area | Confirmed state |
|---|---|
| Application source | One self-contained HTML file |
| Entry point | Browser opens the HTML document directly |
| Framework | None |
| Languages | HTML5, CSS3, vanilla JavaScript; interface copy in Russian, Azerbaijani and English |
| Dependencies | One external Google Fonts stylesheet; ten embedded `data:image` assets |
| Build tool | None |
| Package manager | None |
| Configuration/environment | None |
| Backend/API | None |
| Database/schema/migrations | None |
| Authentication/permissions | None |
| Tests | None |
| Localisation catalogues | None |
| Deployment configuration | None |
| Documentation in source | None beyond screen captions and demo copy |

### 3.2 Audit wrapper inventory

```text
voyara-ai-mvp/
├── .env.example
├── .gitignore
├── README.md
├── package-lock.json
├── package.json
├── public/
│   └── index.html
├── scripts/
│   └── serve.cjs
├── tests/
│   ├── browser-audit.cjs
│   └── dom-audit.cjs
└── docs/
    └── task-001/
        ├── VOYARA-EXISTING-SCREEN-MATRIX.md
        ├── VOYARA-FOUNDER-DECISION-REGISTER.md
        ├── VOYARA-IMPLEMENTATION-ROADMAP.md
        ├── VOYARA-MVP-GAP-REGISTER.md
        └── VOYARA-TASK-001-REPOSITORY-AUDIT.md
```

`node_modules/` is generated and excluded. The wrapper is for reproducible audit/runability only; it is not presented as the missing Production application.

### 3.3 Source measurements

| Measurement | Result |
|---|---:|
| File size | 849,103 bytes |
| Source lines | 1,524 newline-terminated lines; 1,525 logical split lines |
| Authoritative screen sections | 8 (`s1`–`s8`) |
| Inline script blocks | 3 |
| Inline style blocks | 8 |
| Embedded images | 10 |
| Media queries | 15 |
| Buttons | 50 |
| Business-action buttons with no implemented handler | 34 |
| Anchors without `href` | 25 |
| Forms | 0 |
| Inputs/selects/textareas | 0 |
| `fetch`/XHR/WebSocket calls | 0 / 0 / 0 |
| Local/session storage references | 0 / 0 |
| `innerHTML` writes / `eval` calls | 0 / 0 |
| Duplicate DOM IDs after parsing | 0 |

Evidence: `reference/task-001/voyara-mvp-demo-july7-10.html`; executable measurements from `reference/task-001/dom-audit.cjs`.

## 4. Framework and dependency assessment

The recovered source is a monolithic static document. CSS, content, screen states and assets are all embedded. This makes the demonstration portable, but it prevents normal application concerns—routing, data loading, authentication, state ownership, localisation catalogues, component tests, caching, CSP enforcement, and incremental deployment—from being managed cleanly.

The only remote runtime dependency is Google Fonts at `reference/task-001/voyara-mvp-demo-july7-10.html:7-8`. The page otherwise uses embedded assets and browser-native APIs.

The audit wrapper uses Node.js 20+, `jsdom@29.1.1`, and `playwright@1.61.1` as development-only dependencies. `npm audit` reported zero known vulnerabilities for this audit dependency tree on 2026-07-17. That result does not assess future Production dependencies.

## 5. Runability assessment

### 5.1 Results

| Check | Exact result |
|---|---|
| Source hash preservation | PASS — recovered source and `reference/task-001/voyara-mvp-demo-july7-10.html` hashes match |
| `npm install` | PASS — dependencies installed and lockfile generated |
| Locked clean reinstall | PASS after environment correction — the first `npm ci` attempt failed because npm tried to create denied cache path `/root/.npm`; rerunning with `--cache /tmp/voyara-npm-cache` installed 41 packages, exit 0 |
| Local server | PASS — final same-process probe returned HTTP 200, correct `Content-Type`, exact served-file hash; a preceding cross-execution-session probe could not reach loopback and returned curl status `000` |
| Missing path | PASS — HTTP 404 |
| Encoded path traversal attempt | PASS — HTTP 400 |
| DOM parse and inline-script execution | PASS — no script errors |
| Eight-screen switcher | PASS — each tab activates exactly one matching screen |
| Presenter previous/next/ArrowRight | PASS |
| Six Trip Room tabs | PASS — each activates exactly one matching panel |
| Real Chromium E2E | NOT EXECUTED SUCCESSFULLY — local browser binary absent; downloaded temporary Chromium could not start under the container's denied kernel networking operation |
| Production build | NOT APPLICABLE — no recovered build system or Production application exists |

There are no broken imports because the recovered source imports no JavaScript modules. There are no missing application environment variables because the application performs no backend work. Provider and Production variables are absent because those integrations do not exist.

### 5.2 Commands executed

```text
file reference/task-001/voyara-mvp-demo-july7-10.html
wc -c -l reference/task-001/voyara-mvp-demo-july7-10.html
sha256sum reference/task-001/voyara-mvp-demo-july7-10.html
npm install --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/voyara-npm-cache
npm start
npm test
npm run test:browser
npm audit --audit-level=low
npm ls --depth=0
curl HTTP/header/hash/404/path-traversal checks against the local server
rg source inventory, route, interaction, pricing, secret-pattern and integration-pattern searches
```

Browser attempts and failures are disclosed in §10.2. No browser pass is claimed.

The failed cache-path `npm ci` attempt is retained in the record because Task 001 requires exact disclosure. It did not identify a package or source defect; the same lockfile installed successfully when npm's cache was pointed at a writable path.

## 6. Existing screen audit

All eight screens live in `reference/task-001/voyara-mvp-demo-july7-10.html`; there are no URL routes. The switcher adds/removes the `.on` class and does not update history or the URL.

### 6.1 Public Landing — `s1`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:158-342`.
- **What is real:** branded layout, responsive CSS intent, embedded logo/founder image, pricing cards, business-model explanation, screen switching.
- **What is simulated:** every CTA, plan selection, business demo request, sign-up action and customer journey.
- **Data:** hard-coded HTML.
- **Localisation:** Russian body copy with English labels; document language is `ru`, not Azerbaijani default.
- **Conflict:** displayed personal prices are Smart 39, Plus 69, Premium 129 and Black 990; approved prices are Smart 19/190, Plus 39/390, Premium 69/690 and Black 299/2,990. Corporate cards say contract/request instead of 149/299/599/custom. Free, benefits and rewards are not approved by the current Founder rules.
- **Accessibility:** visible button names and image alt text exist, but navigation anchors lack destinations and there is no `main` landmark.
- **Classification:** `EXISTS_NEEDS_HARDENING`; CTAs are `EXISTS_NEEDS_BACKEND`.

### 6.2 AI Trip Wizard — `s2`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:502-529`.
- **What is real:** a single visual “Step 2 of 3”, month chips and layout.
- **What is simulated:** destination/date/traveller capture, flexibility controls, AI activity, progression and submission.
- **Data:** hard-coded; there are zero form controls and no request object.
- **Localisation:** Russian only inside an English demo frame.
- **Accessibility:** chip controls are buttons, but none changes state; no labels/errors because there are no inputs.
- **Classification:** visual state `EXISTS_NEEDS_BACKEND`; Travel Request capture is `MISSING_LAUNCH_CRITICAL`.

### 6.3 Proposal — `s3`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:531-571`.
- **What is real:** visual distinction between AI Draft and approved customer-facing proposal; Work Receipt presentation.
- **What is simulated:** Supplier availability, price construction, Approval, publication and Customer Acceptance.
- **Authority:** Draft and approved states are rendered together. There is no quotation ID/version, canonical payload, payload hash, approver identity, immutable event, expiry enforcement or accepted hash.
- **Localisation:** Russian customer content inside English framing.
- **Classification:** Draft and published views `EXISTS_NEEDS_BACKEND`; Acceptance `MISSING_LAUNCH_CRITICAL`.

### 6.4 Human Approval Queue — `s4`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:573-641`.
- **What is real:** visual queue, risk summary, Founder co-sign explanation.
- **What is simulated:** keyboard shortcuts, approve/reject buttons, role checks, step-up authentication, dual control, notifications and ledger writes.
- **Authority:** no content snapshot/hash; the “permanent approval ledger” is copy, not a control.
- **Security:** no authentication or permission boundary exists.
- **Classification:** queue view `EXISTS_NEEDS_BACKEND`; decision execution `MISSING_LAUNCH_CRITICAL`; co-sign `EXISTS_NEEDS_SECURITY`.

### 6.5 Founder Command Center — `s5`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:643-780`.
- **What is real:** polished founder-oriented information architecture and visual prioritisation.
- **What is simulated:** all MRR, ARR, revenue, profit, NRR, CAC, LTV, Approval, AI, team, Booking and system figures.
- **Financial issue:** MRR and monthly revenue are displayed separately, but cash, Gross Booking Value, Gross Profit, receivables, allocation and exposure are not represented as distinct authoritative measures. Hard-coded figures violate the retained production rule that KPIs derive from database views.
- **Decision issue:** the queue is visual only; there is no action trace or drill-down.
- **Classification:** layout/data `EXISTS_NEEDS_BACKEND`; financial semantics `EXISTS_NEEDS_HARDENING`.

### 6.6 Trip Room — `s6`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:781-1046`; tab handler at `reference/task-001/voyara-mvp-demo-july7-10.html:1028-1044`.
- **What is real:** six functional tabs—trip, documents, wallet, family, rewards and notifications—plus a working external WhatsApp link.
- **What is simulated:** itinerary, document downloads, invoices, wallet, payment status, family profiles, rewards, support history and AI suggestions.
- **Security:** no login, ownership check, signed URL, encrypted vault, expiry, consent or audit trail protects the passport-like and traveller information shown.
- **Privacy:** founder/family/staff names, passport-like entries, emergency-contact details and a full WhatsApp destination appear in demo fixtures. Their synthetic/public status is unverified.
- **Product conflict:** points, tier progress, lounge access, upgrades and referral rewards are unapproved benefits.
- **Localisation:** primarily Azerbaijani, but the screen heading/frame remains English.
- **Classification:** shell/tabs `EXISTS_AND_ACCEPTED`; content `EXISTS_NEEDS_BACKEND`; support `EXISTS_NEEDS_INTEGRATION`.

### 6.7 Payment and Confirmation — `s7`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:1048-1174`.
- **What is real:** detailed visual states for payment request and post-payment confirmation.
- **What is simulated:** membership selection, payment initiation, provider redirect, provider event, Finance review, Payment Verification, allocation, financial readiness, Booking, Supplier Confirmation, Booking Verification, voucher generation, downloads and notifications.
- **Authority failure:** both states render together. The UI collapses provider payment, human verification, Supplier Confirmation, Booking Verification and voucher availability into captions. No state machine or actor evidence exists.
- **Commercial conflict:** the screen includes specific benefits, credits, service fees and cancellation/refund percentages that are not Founder-approved in the current baseline.
- **Classification:** payment request `EXISTS_NEEDS_INTEGRATION`; Payment/Booking/Refund authority `MISSING_LAUNCH_CRITICAL`.

### 6.8 CRM Pipeline — `s8`

- **Evidence:** `reference/task-001/voyara-mvp-demo-july7-10.html:1175-1376`.
- **What is real:** responsive-intent Kanban and operations layouts.
- **What is simulated:** lead capture, voice ingestion, subscriptions, suppliers, AI activity, task/SLA management, financial attribution, Payments, Bookings and immutable audit.
- **Integrity issue:** the screen claims “API live”, supplier integrations, payment uptime and immutable logs without executable evidence. It also repeats obsolete prices and hard-coded financial figures.
- **Interaction:** cards cannot be opened, moved, filtered or edited; rail anchors have no destinations.
- **Classification:** shell `EXISTS_NEEDS_BACKEND`; integrations `EXISTS_NEEDS_INTEGRATION`; audit claim `EXISTS_NEEDS_SECURITY`.

Detailed rows are in `VOYARA-EXISTING-SCREEN-MATRIX.md`.

## 7. Data and backend audit

| Capability | Repository evidence | Finding |
|---|---|---|
| Database technology | None in executable source | PostgreSQL is an approved authority, not implemented here |
| Schema/models | None | Missing |
| Migrations/seeds | None | Missing launch-critical; external staging cannot be reproduced |
| API routes/services | None | No reads, commands, webhooks or agent endpoints |
| Authentication | None | Missing launch-critical |
| Roles/permissions | None | Missing; Founder/Admin/Finance/Ops boundaries are captions only |
| RLS | None | No policies or tests in repository |
| File storage | None | Download buttons are inert |
| Scheduled jobs/queues | None | No outbox, retries, polling or scheduler |
| Webhooks | None | No signature verification or replay protection |
| AI-provider calls | None | AI work figures are static |
| Payment integration | None | Payriff/PASHA/Kapital references are UI fixtures |
| CRM integration | None | Pipeline is static |
| Messaging integration | One `wa.me` link | No WhatsApp BSP, templates, consent, delivery receipt or escalation flow |

## 8. Authority audit

| Required separation | Visual representation | Enforced implementation | Result |
|---|---|---|---|
| AI Draft vs human Approval | Yes | No | Claim only |
| Draft Quotation vs Published Offer | Yes | No | Both static states coexist |
| Proposal viewing vs Customer Acceptance | Button shown | No | Acceptance missing |
| Payment detection vs Payment Verification | No reliable separation | No | Collapsed |
| Payment Verification vs allocation | Not shown | No | Missing |
| Financial readiness vs Booking creation | Not shown | No | Missing |
| Supplier Confirmation vs Booking Verification | Captions imply both | No | Collapsed |
| Booking Verification vs Voucher issue | Captions imply immediate issue | No | Collapsed |
| Refund request vs Approval vs execution | Policy copy only | No | Missing |
| Approval bound to quotation version/hash | Not shown | No | Missing |
| Approved/published/accepted hash equality | Not shown | No | Missing |
| Immutable material history | “immutable/permanent” text | No | False authority risk |

## 9. Security audit

### 9.1 Positive findings

- No common secret, private-key, bearer-token, database-URL or API-key pattern was found in repository source.
- No `innerHTML` write, `eval`, XHR, WebSocket or dynamic API call exists in the recovered HTML.
- All ten images have alt text; all buttons have a discoverable text/ARIA name.
- The audit-only static server confines reads to `public/`; an encoded traversal attempt returned HTTP 400.
- Audit dependencies reported zero known vulnerabilities on the audit date.

### 9.2 Material gaps

- No authentication, session management, MFA/step-up control, RBAC, RLS or server-side permission check exists.
- No input validation exists because no input path exists; launch-critical paths will require schema validation.
- No CSRF strategy, rate limiting, bot mitigation, webhook HMAC, replay protection or idempotency implementation exists.
- No secure file storage, signed URL, malware scan, retention rule or document access log exists.
- No Production secret manager/rotation configuration exists.
- Inline scripts and styles plus a remote font stylesheet prevent adoption of a strict CSP without refactoring.
- No Production CSP, HSTS or permissions policy is supplied. The local audit server's headers are not a Production security configuration.
- Personal-looking demo fixtures and an actual-looking WhatsApp destination require explicit sanitisation/approval before external use.
- Static UI copy exposes internal “net rates hidden” and “API live” claims without evidence; this is an integrity and investor-diligence risk.

## 10. Test audit

### 10.1 Before Task 001

No unit, integration, end-to-end, security, accessibility, localisation, responsive or migration test existed.

### 10.2 Added during Task 001

`reference/task-001/dom-audit.cjs` now verifies:

- parsed screen order and unique IDs;
- initial state;
- every screen switcher action;
- presenter next/previous/keyboard action;
- every Trip Room tab;
- script execution errors;
- basic DOM accessibility counts;
- localisation character signals;
- absence/presence of network, storage and unsafe-rendering primitives.

Result: **PASS**, exit code 0.

`reference/task-001/browser-audit.cjs` is prepared to verify real Chromium runtime errors, failed requests, desktop/mobile overflow and the same interactions. Result in this environment: **NOT PASSED**, exit code 1, because the Playwright Chromium executable is absent. Download through the browser CDN returned an invalid zero-byte payload under network restrictions; a temporary packaged Chromium then stalled on `NETLINK socket: Operation not permitted`. No application browser result is inferred from that infrastructure failure.

### 10.3 Remaining test gaps

| Test class | Status |
|---|---|
| Unit | Missing |
| API contract | Missing |
| Database guard/RLS | Missing |
| Migration | Missing |
| Integration/provider sandbox | Missing |
| Browser E2E | Harness exists; successful execution outstanding |
| Security/abuse | Static checks only |
| Accessibility | Basic DOM counts only; WCAG audit outstanding |
| Localisation | Mixed-language signals detected; catalogue/parity tests missing |
| Responsive | CSS intent inspected; real viewport verification outstanding |

## 11. Major risks

| Risk | Severity | Why it matters |
|---|---|---|
| Static captions presented as authority | Critical | Can misrepresent Approval, Payment, Booking and audit readiness |
| No backend/DB/auth/API implementation | Critical | No commercial transaction can be trusted or persisted |
| Payment and Booking state collapse | Critical | Can issue service/voucher before verified financial and Booking readiness |
| No content-bound Approval | Critical | Approved content could differ from published/accepted content in a future naive implementation |
| Obsolete prices and unapproved benefits/policies | High | Customer, legal and revenue-model conflict |
| PII-like fixtures in client source | High | Privacy and external-demo risk |
| Hard-coded Founder metrics | High | Cash, revenue, GBV, GP and exposure cannot be relied on |
| No browser/accessibility/localisation coverage | Medium | Launch defects likely across devices and languages |
| External staging claims unreproducible | High | Documentation cannot substitute for migrations and automated tests |

## 12. Classification ledger

This ledger is the basis for the completion counts. Each item has one status only.

| ID | Major implementation item | Status |
|---|---|---|
| C01 | Landing visual shell | EXISTS_NEEDS_HARDENING |
| C02 | Personal pricing content | EXISTS_NEEDS_HARDENING |
| C03 | Corporate pricing content | EXISTS_NEEDS_HARDENING |
| C04 | Landing CTAs/navigation outcomes | EXISTS_NEEDS_BACKEND |
| C05 | Wizard visible step | EXISTS_NEEDS_BACKEND |
| C06 | Travel Request capture/persistence | MISSING_LAUNCH_CRITICAL |
| C07 | AI Draft Proposal state | EXISTS_NEEDS_BACKEND |
| C08 | Published Proposal state | EXISTS_NEEDS_BACKEND |
| C09 | Customer Acceptance authority | MISSING_LAUNCH_CRITICAL |
| C10 | Approval Queue view | EXISTS_NEEDS_BACKEND |
| C11 | Approval decision execution | MISSING_LAUNCH_CRITICAL |
| C12 | Founder co-sign control | EXISTS_NEEDS_SECURITY |
| C13 | Founder dashboard data/layout | EXISTS_NEEDS_BACKEND |
| C14 | Financial metric separation | EXISTS_NEEDS_HARDENING |
| C15 | AI/team/system/exception monitoring | EXISTS_NEEDS_BACKEND |
| C16 | Trip Room shell and tab navigation | EXISTS_AND_ACCEPTED |
| C17 | Trip Room itinerary/documents/wallet/family/rewards | EXISTS_NEEDS_BACKEND |
| C18 | Trip Room support/messaging | EXISTS_NEEDS_INTEGRATION |
| C19 | Payment request/provider initiation | EXISTS_NEEDS_INTEGRATION |
| C20 | Payment detection/review/verification/allocation | MISSING_LAUNCH_CRITICAL |
| C21 | Booking/Supplier Confirmation/verification/voucher | MISSING_LAUNCH_CRITICAL |
| C22 | Refund request/Approval/execution | MISSING_LAUNCH_CRITICAL |
| C23 | CRM/Kanban/operations shell | EXISTS_NEEDS_BACKEND |
| C24 | CRM/voice/Supplier/Payment metrics integrations | EXISTS_NEEDS_INTEGRATION |
| C25 | Work Receipt/immutable audit | EXISTS_NEEDS_SECURITY |
| C26 | Eight-screen structure | EXISTS_AND_ACCEPTED |
| C27 | Presenter navigation | EXISTS_AND_ACCEPTED |
| C28 | Minimal reproducible local server | EXISTS_AND_ACCEPTED |
| C29 | Azerbaijani-default trilingual behaviour | EXISTS_NEEDS_HARDENING |
| C30 | Responsive verification | EXISTS_NEEDS_TESTING |
| C31 | Accessibility semantics | EXISTS_NEEDS_HARDENING |
| C32 | Backend/API/BOS | MISSING_LAUNCH_CRITICAL |
| C33 | PostgreSQL migrations/RLS/guards in repository | MISSING_LAUNCH_CRITICAL |
| C34 | Authentication/session management | MISSING_LAUNCH_CRITICAL |
| C35 | RBAC/permissions/step-up authentication | EXISTS_NEEDS_SECURITY |
| C36 | Versioning/SHA-256/immutable history | EXISTS_NEEDS_SECURITY |
| C37 | Validation/rate-limit/webhook/idempotency security | EXISTS_NEEDS_SECURITY |
| C38 | Production secrets/configuration management | EXISTS_NEEDS_SECURITY |
| C39 | DOM interaction tests | EXISTS_AND_ACCEPTED |
| C40 | Real-browser E2E | EXISTS_NEEDS_TESTING |
| C41 | Unit/integration/security/localisation/migration tests | EXISTS_NEEDS_TESTING |
| C42 | Provider adapter layer | EXISTS_NEEDS_INTEGRATION |
| C43 | Production hosting/observability/restore drill | DEFERRED |
| C44 | Creator/referral/agency automation | DEFERRED |
| C45 | Demo-data privacy/synthetic fixtures | EXISTS_NEEDS_SECURITY |
| C46 | Production identity/contact details | FOUNDER_DECISION_REQUIRED |
| C47 | Commercial benefits/refund content | FOUNDER_DECISION_REQUIRED |

### 12.1 Counts

| Status | Count |
|---|---:|
| EXISTS_AND_ACCEPTED | 5 |
| EXISTS_NEEDS_HARDENING | 6 |
| EXISTS_NEEDS_BACKEND | 9 |
| EXISTS_NEEDS_INTEGRATION | 4 |
| EXISTS_NEEDS_SECURITY | 7 |
| EXISTS_NEEDS_TESTING | 3 |
| MISSING_LAUNCH_CRITICAL | 9 |
| DEFERRED | 2 |
| FOUNDER_DECISION_REQUIRED | 2 |
| **Total classified items** | **47** |

## 13. Immediate next implementation task

**IMPLEMENTATION TASK 002 — PRODUCTION REPOSITORY FOUNDATION AND SECURITY SLICE**

Create the ratified Next.js App Router/PWA repository with `/az`, `/ru` and `/en` locale routes, reuse the existing design tokens and eight-screen visual baseline without redesign, establish the managed PostgreSQL/Supabase local/staging project with forward-only migrations, create the Node/TypeScript modular BOS command skeleton, add synthetic seed data, secret/config validation, CI, and the first database guard/RLS tests. The first proof should be a secure health/read path plus an audited write-command skeleton—not a new landing-page design.

Do not begin provider integrations or implement all 58 conceptual tables in one batch. Task 002 should establish the smallest secure foundation required for Task 003 authentication/Roles and Task 004 Travel Request.
