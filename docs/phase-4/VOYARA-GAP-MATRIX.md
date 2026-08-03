# VOYARA AI — Definitive Gap Matrix (updated through Phase 4E)

**The project is not complete.** Phase 4E adds a structured R-Travel partner/supplier/contract operating layer, portal-assisted operations, document references, service-booking and air-ticketing records, a dry-run-first reversible data-migration system, transparent supplier ranking, and read-only CRM/Founder extensions — all fixture-only. R-Travel remains the legal merchant, supplier-contract authority, booking authority, invoicing authority, and refund/chargeback authority throughout. Nothing below claims real R-Travel data or supplier activation. Legend: ✅ Implemented and tested · 🟡 Partial · ❌ Missing · 🔑 Requires an external account/contract/credential VOYARA does not control.

---

## 1. Core commercial engine

| Capability | Status | Detail |
|---|---|---|
| Quote lifecycle, versioning, content-hash approval | ✅ | Phase 3A/3B, exhaustively tested |
| Human Approval Gate (HAG) | ✅ | Structural (type-literal) + tested throughout |
| Reserve-first idempotency | ✅ | Real PostgreSQL `23505` proof, Phase 3B Part 4 |
| Forced RLS / cross-customer isolation | ✅ | Proven on quotes, payments, role_assignments |
| Detection ≠ verification (payments) | ✅ | `reconcilePayment()`, exact-match only |
| Booking preparation (never confirmation) | ✅ | No live-booking code path exists anywhere |
| Refund preparation (never execution) | ✅ | Same pattern, type-enforced |
| One hotel supplier (Hotelbeds) | 🟡 | Adapter complete, **FIXTURE-CERTIFIED only** — no real credentials |
| One payment provider | 🟡 | Generic adapter complete, **no provider chosen or credentialed yet** |
| Auth: email/password, magic link, TOTP MFA | ✅ | Real GoTrue-compatible code, sandbox-verified |
| Customer / staff / founder roles | ✅ | `customer, staff, manager, finance, admin, founder` — no separate "operations" role; `staff`/`manager` fill that function |
| Production environment validation, health, logging | ✅ | Phase 3C Part 1 |
| Vercel/Supabase staging deployment | 🟡 | Guided step-by-step with founder; not yet completed end-to-end in this thread |
| Marketing landing page (AZ/RU/EN) | ✅ | Reviewed and corrected per founder feedback |

## 2. Communication channels

| Capability | Status | Detail |
|---|---|---|
| Unified conversation/message data model | ✅ | Phase 4A; extended Phase 4B with brand/external-id/handover/delivery-status fields |
| Channel-adapter interface (provider-neutral) | ✅ | Phase 4A; **no live channel connected** |
| Dual Instagram accounts (R-Travel + VOYARA) — data model | ✅ | Phase 4B — `customer_facing_brand`, `INSTAGRAM_RTRAVEL`/`INSTAGRAM_VOYARA` identity kinds, campaign attribution, external conversation/message ids |
| Dual Instagram accounts — real channel adapter | ❌ | 🔑 Meta Business verification + App Review + two connected Pages/IG accounts — see the Phase 4B activation runbook §1 |
| Multilingual AI voice receptionist | ❌ | No telephony, no STT/TTS, no voice-agent logic |
| Website AI chat widget | ❌ | No widget UI, no LLM-driven chat logic |
| WhatsApp Business agent — architecture, adapter, webhook endpoint | ✅ | Phase 4C — fixture-certified (7/7); **NOT_CONFIGURED, no real WhatsApp number connected** |
| WhatsApp Business — real number activation | ❌ | 🔑 Meta Business verification + WhatsApp Business Platform access required — see the Phase 4C activation runbook |
| Website AI chat | ✅ | Phase 4C — real AZ/RU/EN widget, cryptographically opaque sessions, strict anonymous isolation, rate limiting |
| Message risk classification + policy-gated low-risk auto-send | ✅ | Phase 4C — founder-approved, versioned, hash-verified policy; sensitive messages unaffected |
| Provider-neutral LLM routing | ✅ | Phase 4C — simulation-only; tiered selection, spending ceilings, closed tool-permission set |
| Real LLM provider connected | ❌ | 🔑 No provider or API key configured — founder decision |
| Multilingual AI voice receptionist — architecture, adapter, webhook endpoint | ✅ | Phase 4D — fixture-certified (12/12); **NOT_CONFIGURED, no real telephony provider or number connected** |
| Multilingual AI voice receptionist — real provider activation | ❌ | 🔑 No voice provider selected; needs API key, webhook secret, test/production number — see the Phase 4D activation runbook |
| Email channel | ❌ | Not started |

## 3. AI agents

| Capability | Status | Detail |
|---|---|---|
| Agent Operating Layer (draft → human-approve → send) | ✅ | Phase 4A |
| COO agent (Daily Digest, read-only) | ✅ | Phase 4A |
| Sales / Travel-planning / Concierge / Operations / Corporate / Marketing agents | ❌ | No per-role prompt/logic implementation yet — can use the Operating Layer once built |
| LLM runtime for agents | 🔑 | Needs an LLM API account — unchanged from Phase 4A |

## 4. CRM and operations

| Capability | Status | Detail |
|---|---|---|
| Unified CRM/conversation inbox — data layer | ✅ | Phase 4A |
| Unified CRM/conversation inbox — staff-facing UI | ✅ | Phase 4B core + Phase 4C + Phase 4D — all 5 channels (Instagram×2/WhatsApp/website chat/voice), unread + SLA indicators, take-over/return-to-AI, full voice call detail panel |
| Customer identity linking (verified auto-link + AAL2 human-confirmed merge, reversible) | ✅ | Phase 4B |
| Automated follow-ups / operational workflows | ❌ | Needs a scheduler (e.g. Vercel Cron) + workflow rules; not started |
| Existing CRM pipeline (quote/payment/booking status) | ✅ | Phase 3 baseline, unrelated to conversations |

## 5. Payment-link workflow (Phase 4B)

| Capability | Status | Detail |
|---|---|---|
| Payment-link draft → AAL2-approve-by-hash → checkout → send-into-conversation → webhook → reconcile | ✅ | Full state machine, tested hermetically and against real PostgreSQL |
| All founder-locked fields (customer, brand, proposal version, supplier-contract reference, service description, transaction type, amount/currency, merchant authority, expiry, purpose, approver, content hash) | ✅ | Each its own column, not a blob |
| Unique order references, real concurrency proof | ✅ | Proven: 5 concurrent inserts → exactly 1 winner, 4 real `23505`s |
| Idempotent webhook receipts under concurrency | ✅ | Proven: 5 concurrent duplicate event ids → exactly 1 accepted receipt |
| Real payment provider connected | ❌ | 🔑 No provider approved — founder decision, unchanged from Phase 3C Part 3 |
| Recurring/subscription billing | ❌ | Contract supports the `SUBSCRIPTION` transaction type; no recurring-charge engine exists |

## 5. Subscriptions and entitlements

| Capability | Status | Detail |
|---|---|---|
| Pricing plans displayed (marketing) | ✅ | Landing page, corrected |
| Recurring billing / subscription lifecycle | ❌ | No Stripe-Billing-style subscription engine exists |
| Plan entitlement enforcement (what a plan unlocks) | ❌ | Not started |

## 6. Expanded inventory verticals

| Capability | Status | Detail |
|---|---|---|
| Hotels | 🟡 | Hotelbeds adapter, fixture-certified only |
| Tour operators / DMCs | ❌ | No adapter, no interface generalized for this vertical yet |
| Flights / ticketing | ❌ | 🔑 GDS or NDC access (Amadeus, Sabre, or similar) required |
| Transfers | ❌ | 🔑 Transfer-provider API required |
| Insurance | ❌ | 🔑 Insurance-provider/underwriter partnership required |
| Visa services | ❌ | 🔑 Visa-processing partner required |
| Activities | ❌ | 🔑 Activities/experiences provider (e.g. a Viator-style API) required |
| VIP services | ❌ | Undefined scope — needs founder specification before any build |

## 7. R-Travel migration

| Capability | Status | Detail |
|---|---|---|
| Partner/contract migration | ❌ | 🔑 R-Travel's actual contract documents |
| Supplier portal access transfer | ❌ | 🔑 R-Travel's existing supplier login credentials, per supplier |
| Customer data migration | ❌ | 🔑 R-Travel's customer database export + legal basis for transfer (consent/contract review) |
| Historical booking/financial records | ❌ | 🔑 R-Travel's accounting/booking system export |

This entire section requires real R-Travel business records this project has no access to — see the exact document list at the end of this report.

---

# Phase 4A — what was actually built

Delivered: the **Agent Operating Layer** (draft → human-approve → send, provider-neutral channel adapters, fail-closed registry), the **unified conversation/CRM data model** (`contacts`, `conversations`, `messages`), and the **COO Agent** (read-only Daily Digest, founder-approved scope, structurally incapable of the seven forbidden actions).

# Phase 4B — what was actually built this session

Delivered: **dual-brand customer identity** (verified auto-link + AAL2 human-confirmed reversible merge, never by name/username similarity), **dual-Instagram-ready conversation extensions** (brand, external ids, campaign attribution, handover status — no real Instagram adapter yet), the **real staff-facing unified CRM inbox** (`/staff/inbox`, AZ/RU/EN, filters, timeline, linked identities, payment-link status, assign/handover/escalate), and the **payment-link workflow** (draft → AAL2-approve-by-content-hash → hosted checkout → delivery only into the originating conversation, reusing the Phase 4A message pipeline → signed-webhook verification → reconciliation, with every founder-locked field its own column). See `VOYARA-PHASE-4B-FINAL-REPORT.md` for exact tables, tests, and counts.

Not built this phase: any real Instagram or payment-provider connection (both remain simulation-only, fail-closed for SANDBOX/LIVE), the six non-COO agent personalities, follow-up automation, subscriptions/entitlement enforcement, additional inventory verticals, or any R-Travel migration work.

# Phase 4C — what was actually built this session

Delivered: a **WhatsApp Cloud API adapter** (real webhook challenge + signature verification, inbound normalization, service-window/template awareness, multi-account-ready) plus its real webhook endpoint — fixture-certified 7/7, honestly NOT_CONFIGURED (no real WhatsApp number connected); a **real trilingual website AI chat** with cryptographically opaque, strictly isolated anonymous sessions and rate limiting; **message risk classification** with a founder-approved, versioned, hash-verified policy gating the only path that can auto-send without per-message human approval; **provider-neutral LLM routing** (simulation-only, fail-closed SANDBOX/LIVE, spending ceilings, a closed tool-permission set structurally incapable of an authoritative action); and **unified-inbox extensions** (unread/SLA indicators, take-over/return-to-AI) covering all four channels. A pre-release migration-history correction (Migration 19) was also completed and rigorously re-verified: 91 tables, 308 CHECK constraints, 222 indexes, 206 RLS policies, and 8 functions all byte-for-byte identical between a genuinely fresh migrations-1–19 database and the development sandbox.

Not built this phase: any real WhatsApp number, any real LLM call, spending-ceiling persistence/summing, template-message content management, or Instagram's real adapter (still Phase 4B's gap, unchanged).

# Phase 4D — what was actually built this session

Delivered: a **provider-neutral multilingual AI voice receptionist** — a `VoiceAdapter` interface covering both telephony/SIP (raw-body-first webhook signature verification, call control) and voice-provider (speak) concerns, its real webhook endpoint with reserve-first idempotent duplicate rejection and multi-number/brand resolution, and `voice-call-service.ts`, which deliberately *reuses rather than duplicates* Phase 4C's policy-gated low-risk auto-send discipline, LLM router, and WhatsApp follow-up path. Full call lifecycle (started/ringing/answered/transferred/completed/failed), five-dimension consent tracking with recording genuinely disabled unless explicitly granted, transfer, callback scheduling, and an append-only audit trail — fixture-certified 12/12, honestly NOT_CONFIGURED (no real telephony provider or number connected). Unified inbox extended with a full voice call detail panel and new filters (call status, urgency, callback required); Founder Command Center extended with read-only voice metrics as a deliberately standalone module, provider cost shown as explicitly unavailable rather than invented.

**A genuine defect found and fixed via real-sandbox verification**, the same class already caught once in Phase 4C: `call_events.actor_id` is a `uuid` column, but the voice layer's internal audit helper passed the literal string `'system'` for automated events. Hermetic tests didn't catch it (in-memory stores don't enforce column types); the real sandbox suite did. Fixed with a shared `SYSTEM_ACTOR_ID` constant, with a structural test now proving no voice-layer file can regress to a bare-string literal. A second, separate issue surfaced in the same test run — an incorrect test assumption about how PostgreSQL RLS handles UPDATE/DELETE with no matching write policy (it affects zero rows, not a thrown 42501) — was diagnosed as a test-code defect, not a security gap, and fixed with a more rigorous assertion that directly proves the row is byte-for-byte unchanged.

Not built this phase: any real voice/telephony provider connection, any real STT/TTS call, provider-specific webhook signature verification, or spending-ceiling persistence/summing across calls (same category of gap already documented for LLM routing in Phase 4C).

# Phase 4E — supplier/contract operations

| Capability | Status | Detail |
|---|---|---|
| Supplier/partner registry (17 supplier types) | ✅ | Phase 4E — `suppliers` table, append-only `supplier_events` |
| Contract authority (approval-by-content-hash, versioning) | ✅ | Phase 4E — `contracts`/`contract_versions`, active-contract requirement checked at every use, not just at approval |
| Secure document references | ✅ | Phase 4E — private object-storage references only; credential-shaped keys and public URLs both structurally refused |
| Portal-assisted operational workflow | ✅ | Phase 4E — closed 11-state machine, idempotent task creation, `confirmTask` the sole path to CONFIRMED, requiring a real human owner and supplier confirmation reference |
| Service bookings (hotel/tour/DMC/transfer/insurance/visa/activity/VIP) | ✅ | Phase 4E — active-contract required, human-controlled confirmation |
| Air-ticketing records | ✅ | Phase 4E — AI-preparable only at PNR_HELD; every status past that requires a named human ticketing owner |
| R-Travel data migration (dry-run, reversible, AAL2-approved) | ✅ | Phase 4E — CSV fully implemented; XLSX honestly NOT_CONFIGURED (see the migration runbook) |
| Supplier ranking | ✅ | Phase 4E — active-contract-only, transparent explanation, never fabricates price/availability |
| CRM/Founder supplier-ops reporting | ✅ | Phase 4E — read-only `SupplierOpsPanel` on the Founder Command Center |
| Real R-Travel supplier/contract/customer data | ❌ | 🔑 Requires founder-provided documents — see the Phase 4E migration runbook's founder checklist |
| Real supplier portal/API credentials | ❌ | 🔑 None exist anywhere in this project |
| XLSX import | ❌ | Deliberately not added — the available library version carries known high-severity vulnerabilities; needs a properly vetted replacement |

# Phase 4E — what was actually built this session

Delivered: a complete **supplier/contract operating layer** — canonical supplier registry, contract authority with approval-by-content-hash and full immutable version history (a contract's active-authority check is re-verified at the moment of every use, not just at approval time, so a later-suspended or stale-hashed contract correctly stops authorizing new operations), secure document references (structurally refusing both credential-shaped storage keys and public URLs), a portal-assisted workflow with a closed 11-state machine where `confirmTask` is the sole, structurally-enforced path to `CONFIRMED` and requires both a real human owner and a real supplier confirmation reference, human-controlled service-booking and air-ticketing records (every status past the AI-preparable starting point requires a named human actor, proven both by application logic and database CHECK constraints), a dry-run-first reversible data-migration system that never merges customers by name alone, transparent supplier ranking that excludes (not deprioritizes) any supplier without a genuinely active contract, and read-only CRM/Founder reporting.

**A genuine defect found and fixed via real-sandbox verification, the same class already caught twice before (Phase 4C, Phase 4D):** `portal_task_events.actor_id` is a `uuid` column, but `portal-task-service.ts`'s `prepareTask` and `markReadyForReview` functions wrote the literal string `'agent'` for AI-originated events. Hermetic tests didn't catch it — the in-memory store doesn't enforce column types — the real sandbox suite did, on the very first run (9/12 fell to 11/12, then 12/12 after the fix). Fixed by reusing the already-established shared `SYSTEM_ACTOR_ID` constant (not inventing a new one), with a new structural test proving no supplier-ops file can regress to a bare actor-kind-shaped string literal.

**A deliberate security decision, not a shortcut:** XLSX import was evaluated and NOT implemented, because the available `xlsx`/SheetJS library version carries known high-severity vulnerabilities (prototype pollution, ReDoS). CSV import is fully implemented and certified (10/10 real checks in the dry-run certification script); XLSX is honestly reported as NOT_CONFIGURED rather than shipping a known-vulnerable dependency.

Not built this phase: any real R-Travel supplier/contract/customer/booking data (all fixtures only), any real supplier portal or API credential, XLSX import, or Phase 4F/subscriptions/full automation.

---

# Phase 4F gap matrix — Subscriptions, Membership Entitlements & Recurring Billing

| Capability | Status | Notes |
|---|---|---|
| Locked personal/corporate pricing catalog | ✅ | `LOCKED_PLAN_PRICES` enforced in code — `draftPlanVersion` structurally refuses any non-matching price |
| Plan authority (approval-by-hash, versioning) | ✅ | Mirrors Phase 4E contract authority exactly; stale-hash and retired-plan rejection re-verified at every use |
| Enterprise pricing never published | ✅ | Schema refine + DB CHECK constraint both refuse ACTIVE + non-zero price for `CORPORATE_ENTERPRISE` |
| Deterministic entitlement engine | ✅ | Never grants from pricing-card text alone; every grant traces to a real, currently-active plan version |
| Subscription lifecycle (12-state machine) | ✅ | Initial activation only after a reconciled payment; closed transition table; no AI-agent-attributable status change |
| Duplicate-active-subscription prevention | ✅ | Both application-layer check and a real DB unique index |
| Recurring-payment layer | ✅ | Tokenized references only; exact amount/currency/plan-version matching; idempotent webhooks; no card/CVV storage |
| Corporate membership (seats, isolation) | ✅ | Seat limits enforced; strict no-cross-account leakage, proven both hermetically and against real PostgreSQL |
| Customer-facing membership screen (AZ/RU/EN) | ✅ | Plan comparison, current membership, billing status, payment history, entitlement usage — read-only; upgrade/downgrade/cancellation presented as support-mediated requests this phase |
| CRM/Founder subscription reporting | ✅ | Read-only `SubscriptionOpsPanel`; MRR/ARR computed only from real ACTIVE subscriptions × real approved plan price, explicitly marked partial when any price can't be resolved |
| Sandbox tests (all 10 Phase 4F tables) | ✅ | 14/14 — forced RLS, isolation, price/currency enforcement, stale-approval rejection, duplicate prevention, append-only history, concurrency |
| Subscription fixture certification | ✅ | 21/21 checks — every locked price, full lifecycle journey, entitlement calculation, duplicate-webhook rejection, corporate subscription |
| Real payment provider integration | ❌ | 🔑 None connected — SIMULATION-certified only; provider-specific webhook signature scheme not implemented |
| Customer self-service upgrade/downgrade/cancellation mutation | ❌ | Presented as support-mediated requests this phase, not a wired self-service API route |
| Dunning/retry scheduling automation | ❌ | The lifecycle functions are real and tested; no scheduled job calls them yet |
| Real Enterprise contracts | ❌ | 🔑 Requires founder-provided signed agreements |

## Phase 4F — what was actually built this session

Delivered: a complete **personal and corporate subscription system** — founder-locked plan pricing enforced in code (not just documented), a deterministic entitlement engine that structurally cannot grant access from marketing copy, a closed subscription lifecycle where activation is only ever a consequence of a reconciled payment, a provider-neutral recurring-payment layer reusing the existing payment-link HMAC discipline, corporate membership with proven seat-level isolation, AZ/RU/EN customer-facing membership pages, and read-only Founder/CRM reporting with honestly-partial MRR/ARR rather than fabricated figures.

**Two genuine test-code bugs found and fixed via real verification (not product defects):** (1) a subscription-lifecycle hermetic test skipped the `RENEWAL_PENDING` step before asserting `PAYMENT_FAILED`, and a structural regex assertion matched a type annotation instead of an actual call site — both diagnosed and corrected, with the underlying state machine and actor-kind discipline confirmed correct throughout; (2) the real-sandbox test file asserted a `bigint` column's value using a JS number literal, when the `pg` driver returns `bigint` columns as strings — fixed by comparing string representations; the actual locked prices in the real database were correct throughout.

Not built this phase: any real payment-provider connection, real subscription/customer billing data, dunning-job automation, or Phase 4G.

