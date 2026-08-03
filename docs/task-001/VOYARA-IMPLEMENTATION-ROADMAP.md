# VOYARA AI — IMPLEMENTATION ROADMAP

**Task:** Implementation Task 001  
**Date:** 2026-07-17  
**Basis:** Actual recovered implementation plus the ratified MVP stack and current Founder rules

## 1. Roadmap decision

Use a **controlled partial rebuild beneath the retained eight-screen experience**. The static MVP remains the visual acceptance reference. Implementation proceeds in vertical slices through a Next.js App Router/PWA frontend, one Node/TypeScript Business Operations Service, managed PostgreSQL with RLS, and Postgres-backed jobs. No microservices, Kubernetes, separate message broker, or multi-provider rollout is justified for the Azerbaijan launch.

Every slice must include its data migration, server command/read path, Role/RLS checks, audit events, UI state, localisation, and risk-weighted tests. A caption or client-side state is never acceptance evidence for an authoritative business transition.

## 2. Delivery gates

| Sequence | Vertical slice | Scope grounded in current source | Exit evidence | Principal gaps closed | Budget control |
|---:|---|---|---|---|---|
| 1 | Foundation and security | Create the Production repository; map the eight retained screens to public/customer/staff route groups; establish `/az`, `/ru`, `/en`; add BOS module boundaries, managed Postgres connection, forward-only migration runner, synthetic seed, environment validation, structured error/trace format, CSP-compatible asset extraction, CI and secret scanning | Clean install/build/test from a fresh checkout; first migration up/down policy documented; no real personal fixture; protected route returns denial without session; locale parity test; exact visual reference retained | GAP-001, GAP-005, GAP-006, GAP-025–GAP-027, GAP-032 | One web deployment, one managed database, one service boundary; no provider purchase needed |
| 2 | Authentication and Roles | Managed customer/staff sessions; customer, staff, manager, finance, admin and founder permissions; organisation/trip ownership; Approval limits; step-up hook; RLS and command middleware | Positive and negative Role/RLS matrix; session revocation; customer isolation; staff action attribution; client cannot assign Roles or limits | GAP-012, GAP-019, GAP-026 | Use managed auth already adjacent to managed Postgres; avoid custom identity service |
| 3 | Travel Request | Replace the simulated wizard with validated AZ-default request capture; consent and source attribution; persist request; staff queue/CRM read view; rate limit and abuse controls | AZ/RU/EN happy-path and validation tests; request visible only to owner/authorised staff; duplicate/replay behaviour defined; no literal mixed-locale copy | GAP-007, GAP-008, first part of GAP-021 | Narrow request fields to launch need; manual staff follow-up remains valid |
| 4 | Commercial Approval | AI/human draft record; quotation versions; canonical payload; SHA-256 hash; risk flags; human Approval/rejection; Founder co-sign when configured; publish exact approved version; authenticated Customer Acceptance bound to the same hash; Work Receipt | Database guard proves edit-in-place and mismatched hashes fail; approved, published and accepted hashes match; role/limit/step-up/idempotency negative tests; AI cannot publish or approve | GAP-009–GAP-011, GAP-024 | AI provider optional at first: a human-created draft can exercise the full authority path |
| 5 | Payment Verification | Authoritative payment request; provider-event/evidence record; human Finance review; Payment Verification; allocation; financial-readiness calculation; distinct statuses shown in Payment screen, Trip Room and CRM | Provider detection cannot mark verified; non-Finance actor denied; allocation reconciles; duplicate webhook/evidence is idempotent; audit trail contains actor/source/correlation; financial labels remain distinct | GAP-015, part of GAP-018, GAP-023 | Start with bank/manual payment evidence and configured payment links; integrate one signed provider webhook only when justified |
| 6 | Booking and Verification | Booking creation gated on valid Acceptance plus verified Payment or approved Credit; manual Supplier execution; Supplier Confirmation capture; separate human Booking Verification; voucher generation and private delivery | Guards deny premature Booking and voucher issue; Supplier Confirmation alone cannot verify Booking; voucher immutable/versioned and accessible only to owner/authorised staff | GAP-016, GAP-019, part of GAP-023 | Manual Supplier operation is the launch default; add one Supplier adapter after volume/evidence |
| 7 | Trip Room and Support | Populate retained itinerary, documents, wallet and notifications from authoritative records; private object storage and short-lived URLs; authenticated support tickets; configured WhatsApp human handoff; privacy/retention controls | Customer isolation and signed-URL expiry tests; verified voucher available; unverified changes labelled; consent and support audit; accessible tab/keyboard behaviour | GAP-019, GAP-020, relevant parts of GAP-025 and GAP-028 | Defer rewards and broad family features; use tickets plus manual WhatsApp fallback before messaging automation |
| 8 | Founder Command Center | Connect the retained decision-first layout to database views: decisions, cash, revenue, GBV, GP, receivables, exposure, pipeline, Payment risk, Booking health, Support risk, membership, AI cost, workload and system health | Metric definitions and SQL tests; cash/revenue/GBV/GP/receivables/exposure are distinct; source and freshness visible; Founder access enforced; no browser-derived value metrics | GAP-018, GAP-022, parts of GAP-024 | Build only views backed by delivered domains; no separate analytics platform for launch |
| 9 | Administration | CRM state transitions, owners, SLA/tasks; membership-plan administration constrained to approved prices; Supplier configuration; Roles/limits governed by founder-only dual controls; refund workflow after policy approval | Accessible, audited state changes; price/config history; no silent mutation of accepted content; refund request, Approval, execution and reconciliation are separate; negative permission tests | GAP-002–GAP-004, GAP-017, GAP-021 | Keep low-volume configuration manual and audited; do not build a broad enterprise admin suite |
| 10 | Production hardening | Real-browser responsive/a11y/localisation suites; migration and restore rehearsal; backups/PITR; monitoring/alerts; rate-limit tuning; dependency/security review; incident/manual fallback runbooks; Production data-removal check | Supported browser/viewport pass; WCAG 2.2 AA evidence; locale parity; clean migration; restore drill; webhook/replay tests; no demo PII or secrets; launch checklist signed | GAP-029–GAP-032 and residual risk | Managed observability and database backups; scale only after measured evidence |

## 3. Immediate next coding task

### IMPLEMENTATION TASK 002 — PRODUCTION REPOSITORY FOUNDATION AND SECURITY SLICE

Create the ratified Next.js App Router/PWA foundation with addressable `/az`, `/ru` and `/en` route groups, preserving the existing design and all eight screen references. Add the managed PostgreSQL migration skeleton, the single Node/TypeScript BOS skeleton, synthetic fixtures, environment/secret validation, protected customer/staff shells, CI, and first Role/RLS/locale tests.

Task 002 should **not** implement every future table, provider integration or business flow. Its acceptance boundary is a reproducible, secure foundation on which Task 003 can deliver a real Travel Request end to end.

## 4. Cross-slice acceptance rules

Each completed slice must prove all applicable items below:

1. The visible state comes from an authoritative server record, not hard-coded or client-owned state.
2. Every value-bearing command is authenticated, authorised, validated, idempotent where retryable, and attributable.
3. AI output remains a Draft until the required human decision is recorded.
4. Approved or accepted content is versioned and never edited in place.
5. Customer content is complete in one of AZ, RU or EN per interface state; Azerbaijani is the default.
6. Fixtures are synthetic; secrets and Production personal data do not enter source or logs.
7. Database guards and permission denials are blocking tests, not manual assumptions.
8. A manual operational fallback is documented before adding another paid provider.

## 5. Deliberate deferrals

The following are outside the first launch-critical slices unless evidence changes priority:

- rewards, points, referral economics and family-tier progression until Founder approval;
- broad corporate travel administration beyond the approved plan catalogue and essential request handling;
- multiple payment, Supplier, CRM or messaging integrations;
- autonomous AI execution of any risk-sensitive action;
- a separate data warehouse, microservices, Kubernetes or external message broker;
- native mobile applications while the responsive PWA meets launch needs.

## 6. Budget realism

The USD 10,000–20,000 initial launch range remains plausible only if scope follows the gates above: one market, one managed stack, one modular service, manual Finance and Supplier operations, limited provider adapters, and deferral of unapproved membership features. Delivering the future 58-table design, all named providers and fully automated operations in the initial slice would exceed the approved budget and increase authority risk.

