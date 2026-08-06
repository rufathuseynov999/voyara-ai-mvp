# VOYARA AI — Agent Runtime Readiness Audit

**Audit date:** derived from the live workspace state as of this session.
**Method:** every claim below is backed by a direct source-path citation and an explicit grep/read performed during this audit. No claim is inferred from architecture, naming, or intent alone. Where a module exists but has zero callers outside its own test file, this document says so explicitly — file existence is never treated as evidence that a service runs.

---

## Executive answers (read this first)

| Question | Answer |
|---|---|
| Does an OpenAI client exist? | **No.** No import of an OpenAI SDK anywhere in `src`. |
| Does an Anthropic client exist? | **No.** No import of `@anthropic-ai/sdk` or equivalent anywhere in `src`. |
| Does any other real LLM client exist? | **No.** `src/server/agents/llm-routing.ts` states in its own header comment: *"no LLM API credentials exist anywhere in this project."* |
| Are real LLM credentials expected/configured? | **No.** `.env.example` files show provider mode flags (`VOYARA_SUPPLIER_MODE=SIMULATION`, `VOYARA_PAYMENT_MODE=SIMULATION`, `VOYARA_LIVE_BOOKING_ENABLED=false`, `VOYARA_INSTAGRAM_ACTIVATION_ENABLED=false`) — no LLM API key variable is present at all. |
| Is simulation the only available LLM route today? | **Yes.** `llm-routing.ts`: *"SimulationLlmRouter is the only router that can be constructed today."* A real router is structurally possible (same interface) but does not exist in this codebase. |
| Does a continuously running production worker exist? | **No.** `workflow-runtime.ts` implements `leaseNextStep()` — lease-based step-claiming infrastructure a worker *would* call — but no deployed worker process, daemon, `setInterval` loop, or entrypoint script that calls it in a loop exists in this repository. |
| Are there cron jobs or scheduled jobs invoking agents? | **No.** `vercel.json` contains no `crons` key. No `node-cron` or equivalent dependency exists in `package.json`. Grep for cron/scheduler/polling infrastructure repo-wide returned no matches outside the lease-based data model itself. |
| Are workflows invoked only through user/staff/API actions? | **Yes**, for the paths that are wired at all (see per-agent table below) — invocation is request-driven (a webhook fires, or a staff/customer action calls a service function), never time-driven. |
| Does the standalone HTML connect to any backend? | **No.** `scripts/build-final-interactive-demo.mjs` and its companion files contain no `fetch`, `XMLHttpRequest`, or `WebSocket` calls to any backend — it is a fully self-contained, static, in-browser-state demo. |
| Which agents have real workflow implementations? | Voice Reception, Sales, Operations, SMM & Content (via `marketing-governance.ts`), COO — all have real, tested TypeScript modules. |
| Which agents are presentation-only / unwired concepts? | Concierge and Corporate Desk have **no dedicated backing module at all** — see below. Marketing Strategist likewise has no dedicated module (its territory is partly covered by `marketing-governance.ts`'s drafting functions, but there is no separate "strategist" implementation). |

---

## Per-agent audit

### 1. Voice Reception Agent

- **Intended function:** receive customer calls 24/7, capture intent, draft low-risk responses, escalate anything risk-sensitive to a human.
- **Source modules:** `src/server/agents/voice/voice-call-service.ts`, `voice-adapter.ts`, `voice-contract.ts`, `voice-webhook-processing.ts`, `supabase-call-store.ts`.
- **Deterministic / LLM-powered / presentation-only:** **LLM-dependent** — `voice-call-service.ts` imports `LlmRouter` from `llm-routing.ts`.
- **Dedicated module exists:** Yes, and it is genuinely wired: `src/app/api/v1/voice/webhook/route.ts` imports `processCallWebhookEvent` from `voice-webhook-processing.ts` and instantiates `SimulationVoiceAdapter` (confirmed by direct read of the route file) — not a real telephony provider adapter.
- **Provider dependency:** A real voice/telephony provider adapter is architecturally possible (`VoiceAdapter` interface) but not implemented; the LLM side has no real credentials (see executive table).
- **Database dependency:** `SupabaseCallStore`, `SupabaseConversationStore`, `SupabaseIdentityStore` — real Supabase tables.
- **Invocation mechanism:** Inbound webhook only (`POST /api/v1/voice/webhook`), signature-verified before any processing.
- **API-route involvement:** Yes — `src/app/api/v1/voice/webhook/route.ts`.
- **Scheduled-job/cron involvement:** None.
- **Continuously polling worker:** None.
- **Human-approval boundary:** Any call requiring booking, payment, or a risk-sensitive action is routed to a human; low-risk auto-send still passes through `sendLowRiskMessage` under an active founder-approved policy.
- **Live-activation dependency:** A real `VoiceAdapter` implementation and real LLM provider credentials.
- **Missing for production:** Real telephony provider integration, real LLM provider credentials, and end-to-end activation testing against a live call.

### 2. Sales Agent

- **Intended function:** research destination/hotel/flight options, prepare a proposal draft, assign lead ownership, draft follow-up messages.
- **Source module:** `src/server/agents/automation/sales-automation.ts`.
- **Deterministic / LLM-powered / presentation-only:** **Deterministic.** Does not import `LlmRouter`. Lead ownership assignment and drafting logic are rule-based, not model-generated.
- **Dedicated module exists:** Yes.
- **Provider dependency:** None (no external API calls in this file).
- **Database dependency:** Not directly in this file; downstream consumers would use the existing `scheduled_actions`-style pattern.
- **Invocation mechanism:** **None found.** Repo-wide grep for imports of `sales-automation` outside its own test file returned zero results. This module is implemented and unit/sandbox-tested but is **not currently called from any API route, staff action, or other application code path.**
- **API-route involvement:** None.
- **Scheduled-job/cron involvement:** None.
- **Continuously polling worker:** None.
- **Human-approval boundary (as designed):** Any customer-facing message send or commercial commitment must go through the existing Level 2 (`completeLevel2Step`) or channel-coordination send paths — this module only ever produces a draft or a scheduled-action record.
- **Missing for production:** Wiring this module into an actual invocation point (a staff console action, a scheduled job, or a triggered workflow step) — today it is library code, proven correct in isolation, not yet connected to anything that runs.

### 3. Concierge Agent

- **Intended function:** ongoing trip coordination, restaurant/activity/special-request handling for Premium and Black members.
- **Source module:** **None dedicated.** "Concierge" appears only as a referenced concept inside `journey-stage-executor.ts`, `production-journey-ports.ts`, `customer-journey-workflow.ts`, `agent-contract.ts`, `supplier-contract.ts`, `risk-policy-contract.ts`, and `plan-authority.ts` (as a service-privilege/tier label), never as its own implementation file.
- **Deterministic / LLM-powered / presentation-only:** **Presentation-only / conceptual.** No executable agent logic exists.
- **Provider/database/invocation:** Not applicable — nothing to invoke.
- **Human-approval boundary:** All concierge work today is carried out entirely by the human team; there is no automation to approve.
- **Missing for production:** The entire implementation — this is genuinely a planned role, not a partially-built one.

### 4. Operations Agent

- **Intended function:** track supplier response deadlines, ticketing deadlines, document checklists, and escalate disruptions.
- **Source module:** `src/server/agents/automation/operations-automation.ts`.
- **Deterministic / LLM-powered / presentation-only:** **Deterministic.** No `LlmRouter` import. The module's own header states a structural test scans the file to prove no function can confirm bookings, issue tickets, or execute cancellations/refunds.
- **Dedicated module exists:** Yes.
- **Invocation mechanism:** **None found** — same finding as Sales Agent: zero callers outside its own test file anywhere in `src`.
- **API-route involvement:** None.
- **Scheduled-job/cron involvement:** None (this module's alert/reminder functions are exactly the kind of thing a cron job would call, but no such job exists).
- **Human-approval boundary (as designed):** Alerts/reminders/escalations only ever create an attributable internal record; disruptions, cancellations, and emergencies are handled by the human team.
- **Missing for production:** Same as Sales Agent — an actual invocation path (most plausibly a scheduled job, since none currently exists in this repo).

### 5. SMM & Content Agent

- **Intended function:** prepare content-calendar entries and AZ/RU/EN content drafts; publish only after human approval.
- **Source module:** `src/server/agents/automation/marketing-governance.ts`.
- **Deterministic / LLM-powered / presentation-only:** **Deterministic.** No `LlmRouter` import. Header confirms every workflow produces a DRAFT; `approvePublication` requires a real AAL2 human approver and only marks a draft APPROVED — **no function anywhere in this codebase actually publishes content.**
- **Dedicated module exists:** Yes.
- **Invocation mechanism:** **None found** — zero callers outside its own test file.
- **API-route involvement:** None.
- **Human-approval boundary:** Explicit and structural — publication is architecturally impossible without a human approval step, and even after approval, no publish function exists at all.
- **Missing for production:** An invocation path, and — separately, deliberately out of scope of this module by design — an actual publish integration with Instagram/the relevant channel, which does not exist anywhere in this codebase today.

### 6. Marketing Strategist Agent

- **Intended function:** campaign strategy and budget recommendations.
- **Source module:** **None dedicated.** No file matching "strategist" exists anywhere in `src`. Strategy-adjacent drafting lives in `marketing-governance.ts`, but that module is about content governance, not budget/strategy recommendation.
- **Deterministic / LLM-powered / presentation-only:** **Presentation-only / conceptual.**
- **Missing for production:** The entire implementation.

### 7. COO Agent

- **Intended function:** produce a daily operations digest and advisory (non-executed) proposals.
- **Source modules:** `src/server/agents/coo-agent.ts`, `coo-agent-contract.ts`, `coo-digest-store.ts`, `in-memory-coo-digest-store.ts`, `supabase-coo-digest-store.ts`.
- **Deterministic / LLM-powered / presentation-only:** **Deterministic.** No `LlmRouter` import.
- **Dedicated module exists:** Yes, with a real Supabase-backed store implementation.
- **Invocation mechanism:** **None found** — zero callers of `coo-agent.ts` outside its own test file anywhere in `src`.
- **API-route involvement:** None.
- **Scheduled-job/cron involvement:** None (a "daily digest" is the canonical use case for a cron job, and none exists).
- **Human-approval boundary:** Every proposal is advisory; no function executes an operational change.
- **Missing for production:** An invocation path — most plausibly a daily scheduled job, which does not exist in this repository.

### 8. Corporate Desk Agent

- **Intended function:** centralized corporate travel-request intake and manager-approval workflow coordination.
- **Source module:** **None dedicated.** Repo-wide search for "corporate desk" / "corporateDesk" in any form returned zero matches.
- **Deterministic / LLM-powered / presentation-only:** **Presentation-only / conceptual.**
- **Missing for production:** The entire implementation. (Note: real corporate-subscription billing/entitlement logic *does* exist — see `plan-authority.ts` `CORPORATE_*` plan codes and `recurring-payment-service.ts`'s `CORPORATE_SUBSCRIPTION` transaction type — but that is subscription billing infrastructure, not a corporate-desk *agent*.)

---

## Cross-cutting findings

1. **A consistent pattern across the "Phase 4G automation" modules** (Sales, Operations, Marketing/SMM, COO, and `channel-coordination.ts`): each is a real, deterministic, unit-and-sandbox-tested TypeScript module — but **none of them is currently called from anywhere in the running application** (no API route, no staff-console action, no scheduled job). `channel-coordination.ts` has exactly one caller, `channel-adapter-wiring.ts`, which itself has zero callers. This means these modules are correctly described as **implemented library code awaiting integration**, not as active running functionality, and the AI-agent membership section and this document label them accordingly (mostly "deterministic," meaning "the logic is real and tested," explicitly not "this runs automatically today").
2. **Voice Reception is the one agent with a genuine end-to-end wired path** (webhook → processing → store), but it is simulation-mode by construction, since the LLM router has no real provider credentials and the webhook route explicitly instantiates `SimulationVoiceAdapter`.
3. **No agent anywhere in this codebase runs continuously or autonomously.** Every wired path is request/webhook-triggered; every unwired module requires a human/application action to invoke once it is connected; none is scheduled.
4. **The standalone HTML is fully disconnected from any backend** — it cannot invoke any of the above, wired or not.

---

*This document should be regenerated whenever agent wiring changes materially — its value is entirely in being current and source-verified, not in being comprehensive once and stale forever.*
