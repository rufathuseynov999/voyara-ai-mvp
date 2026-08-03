# VOYARA AI — Phase 4D Final Report: Multilingual AI Voice Receptionist & Call Operations

**The project is not complete.** No real telephony, SIP, or voice-provider connection exists. Everything below is simulation/fixture-only. See `VOYARA-PHASE-4D-ACTIVATION-RUNBOOK.md` for exactly what real activation requires.

---

## 1. Database — Migration 20 and the five voice tables

**Migration 20** (`20260729090000_task020_phase4d_voice_receptionist.sql`) is additive only — no existing table, column, policy, or function was dropped or altered destructively. It reuses the existing `conversations`/`messages` (channel `'VOICE'`), `contacts`/`linked_identities` (identity kind `'TELEPHONE'`), and `agent_llm_runs` architecture unchanged, and adds exactly five new tables:

- **`voice_numbers`** — one row per connected voice number (R-Travel, VOYARA, or a test number), multi-number/brand-ready, mirroring `whatsapp_accounts`'s shape and purpose exactly.
- **`calls`** — one row per call, linked to its own `conversations` row for the message/transcript timeline. Every founder-listed risk-relevant field is its own column: brand, called/caller numbers, status, detected language, duration, transcript, AI summary, urgency, transfer status, assigned owner, handover status, five independent consent columns, recording-enabled flag, model tier/name, estimated cost, and duration ceiling. Two CHECK constraints (`calls_transcript_no_card_number`, `calls_summary_no_card_number`) structurally reject any transcript or summary containing a card-number-shaped digit pattern.
- **`call_events`** — an append-only audit journal, identical shape/discipline to `agent_audit_events`/`payment_link_events`.
- **`call_webhook_receipts`** — idempotent webhook receipts, identical shape/discipline to `whatsapp_webhook_receipts`/`payment_link_webhook_receipts`.
- **`callback_tasks`** — a callback's own lifecycle (due, completed, cancelled), independent of the call's own state machine.

**Migration count: 20/20**, manifest verified, applied to the real sandbox with zero errors.

---

## 2. Voice adapter, registry, stores, and simulation implementation

**`VoiceAdapter`** (`voice-adapter.ts`): a single cohesive interface covering both the SIP/PSTN telephony layer (webhook verification, call control: transfer/end) and the voice-provider layer (speak) — matching how `ChannelAdapter` already covers both messaging and webhooks for WhatsApp, and how real managed voice platforms typically present one unified API for both concerns. Only `SimulationVoiceAdapter` exists; no real provider is implemented.

**`voice-registry.ts`**: fail-closed, credential-gated, identical discipline to `channel-registry.ts`/`payment-registry.ts`. `SIMULATION` works today; `SANDBOX` reports `CREDENTIALS_MISSING` — honestly, even when credentials happen to be present, since no real Sandbox adapter implementation exists yet; `LIVE` is never available.

**`call-store.ts`** (port) + `InMemoryCallStore` (hermetic tests) + `SupabaseCallStore` (real persistence) — the standard three-layer store pattern used throughout this project.

---

## 3. Voice call service and webhook route

**`voice-call-service.ts`** is deliberately built to *reuse, not duplicate*, three pieces of Phase 4C infrastructure:
1. The exact same `PolicyStore`/hash-verification (`message_send_policies`, `policyHashInput`) gates low-risk voice speech — not a separate, less-controlled voice policy.
2. The exact same `LlmRouter` — voice content generation goes through the same provider-neutral, spending-ceiling-enforced router as chat/WhatsApp.
3. `sendLowRiskMessage` (Phase 4C) unchanged — the optional WhatsApp follow-up a call can trigger goes through the existing, already-approved send path.

Every founder-listed sensitive action — final price/discount, proposal approval, supplier availability commitment, payment link, booking, ticket issuance, change, cancellation, refund, liability complaint, medical/legal/emergency claim, exceptional promise — has no function anywhere in the voice layer that can execute it, proven by structural source-scan tests.

**`/api/v1/voice/webhook`**: `POST` handler. **Raw-body signature verification happens before any JSON parsing** — `verifyAndParseWebhookRaw` reads the raw request body, verifies HMAC-SHA256 against it, and only parses on success. There is no code path in this route that processes a call event before that check returns `valid: true`. Reserve-first idempotent duplicate rejection via `call_webhook_receipts`. **Dual-brand routing**: the provider's own number id is looked up against `voice_numbers` to resolve R-Travel vs. VOYARA — never guessed, never silently defaulted.

**AZ/RU/EN support**: `callLanguages = ['az', 'ru', 'en']` is a closed enum threaded through the call record (`detectedLanguage`), the adapter's `speak()` method (which takes a language parameter), and verified in both the hermetic suite and the fixture certification script, which explicitly exercises all three languages end to end.

---

## 4. Consent, recording, transcription, and sensitive-action escalation

Five independent consent dimensions (`aiDisclosure`, `recording`, `transcription`, `crmStorage`, `followUp`), each defaulting to `NOT_ASKED`. `recordingEnabled` only becomes `true` on explicit `GRANTED` consent for recording — proven both hermetically and against real PostgreSQL. Declining consent still preserves a minimal operational call record (brand, numbers, status, duration, timestamps) — the record itself is never withheld, only the recording/transcription content.

Sensitive-action escalation (`escalateCallToHuman`) sets `handoverStatus` to `HUMAN` and records an audit event with the specific sensitive-action reason code — it does not, and cannot, perform the sensitive action itself; that always requires the existing HAG-gated services used directly by a human.

---

## 5. Unified inbox voice extension and Founder Command Center

**Inbox**: `loadVoiceCallForConversation()` returns the full call detail (numbers, brand, status, duration, language, transcript, AI summary, urgency, transfer status, consent, recording state, callback tasks, complete audit timeline). New filters: call status, urgency, callback required (via `resolveVoiceFilteredConversationIds`). The client component renders a dedicated voice-call detail panel with urgency badges, transcript/summary sections, callback task list, and audit timeline. AAL2 staff authority and cross-customer isolation are unchanged — enforced by the same page-level and API-level checks every other inbox channel already uses.

**Founder Command Center voice metrics** (`voice-metrics-queries.ts` + `voice-metrics-panel.tsx`): a deliberately standalone, read-only module — not folded into the existing `FounderCommandCenterSnapshot` contract, to avoid widening that already-tested surface. Every number (calls received, answered, missed, completed, AI-resolved, transferred, callbacks required, qualified leads, average duration, language distribution, unresolved/high-risk calls) is a real count read directly from `calls`/`callback_tasks`. **Provider cost is displayed as explicitly unavailable** — not zero-by-omission, not estimated, not guessed — because no real voice-provider connection or cost model exists. **This panel is read-only by construction**: it contains no button, form, or interactive control of any kind, so it is structurally incapable of execution authority, not merely policy-restricted. The Founder/COO Digest agent that may summarize this data retains only its existing advisory authority (Phase 4A) — nothing in this phase grants it, or any digest agent, any new execution capability.

---

## 6. The real PostgreSQL UUID defect — full account

**What happened:** `call_events.actor_id` is a PostgreSQL `uuid` column. The voice layer's internal `audit()` helper in `voice-call-service.ts`, and two event-writing call sites in `voice-webhook-processing.ts`, wrote the literal string `'system'` as `actorId` for automated, system-originated audit events.

**Why in-memory hermetic tests did not detect the UUID type mismatch:** every hermetic test in this phase uses `InMemoryCallStore`, a `Map`-backed test double that stores whatever JavaScript value it receives as an ordinary object property — it has no concept of a SQL column type and cannot enforce that `actorId` must be a syntactically valid UUID. The string `'system'` is a perfectly valid JavaScript string, so it flowed through every hermetic assertion cleanly. Only a real PostgreSQL `uuid` column — which parses and rejects any input that isn't a valid UUID — can expose this class of defect, and it did: the very first real-sandbox test run failed with `invalid input syntax for type uuid: "system"` (error code `22P02`). This is the identical class of gap already documented for the Phase 4C `VOYARA_BUSINESS_ACCOUNT_ID` defect (a non-UUID string written into a `uuid`-typed `account_id` column) — real-sandbox verification exists precisely because it catches what an in-memory test double structurally cannot.

**The `SYSTEM_ACTOR_ID` correction:** a single shared constant, `SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000000'`, added to the same shared identity module (`business-account.ts`) that already holds `VOYARA_BUSINESS_ACCOUNT_ID`. It deliberately reuses the exact UUID value already established as VOYARA's system-actor identity in the supplier registry (`registry.ts`) — one canonical system identity across the whole project, never a freshly generated value per event (which would make it impossible to query "which events were system-originated" as a coherent group), and never a customer, founder, or staff UUID. All three voice-layer construction sites, plus both sandbox-test seed helpers, now use this constant. A new structural test (`system-actor-id.test.ts`, 4/4 pass) proves: the constant is a well-formed, stable UUID; no voice-layer source file contains the bare string literal `'system'` anywhere an `actorId`/`actor_id` is constructed; exactly three system-actor event-construction sites exist project-wide, all using the shared constant; and the constant never collides with any customer/founder/staff test fixture UUID used elsewhere in this project.

## 6a. The separate append-only test-assumption correction

A second failure in the same real-sandbox test run was investigated separately and found **not** to share the same root cause. Inspection of the actual policies and grants on `call_events` showed `authenticated` held table-level UPDATE/DELETE grants (from an earlier broad `grant all` statement) with only a `SELECT` RLS policy defined for that table. Real PostgreSQL RLS semantics for exactly this configuration: with `FORCE ROW LEVEL SECURITY` and no matching write policy, an UPDATE or DELETE statement **affects zero rows** — it does not raise a `42501` permission error. The original test asserted the wrong outcome (`assert.rejects`); the underlying security guarantee was never actually broken, since no row was ever modified either way. The test was rewritten to assert the true, correct PostgreSQL behavior directly — zero rows affected, no exception thrown — and then to independently confirm via a service-role read that the event row still exists and is byte-for-byte unchanged (`kind` still exactly `'CALL_STARTED'`).

---

## 7. Test results — exact, after both fixes

| Suite | Result |
|---|---|
| `voice-call-service.test.ts` (hermetic) | 19/19 |
| `voice-webhook.test.ts` (hermetic) | 11/11 |
| `system-actor-id.test.ts` (hermetic, structural) | 4/4 |
| `voice-sandbox.test.ts` (sandbox-gated, real PostgreSQL) | **11/11** |
| **Full hermetic suite (`npm test`)** | **439 defined, 426 pass, 13 skipped, 0 fail** |
| **Full real sandbox suite (`npm run test:db`)** | **46/46 pass** (35 from Phase 4C + 11 new Phase 4D) |
| `npm run certify:voice` | **12/12**, correctly reports NOT_CONFIGURED |
| Responsive AZ/RU/EN inbox/voice-detail verification | **15/15** |

### Exact commands and exit codes

| Command | Exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm run db:migrations:verify` | 0 — 20/20 |
| `npm test` | 0 — 426/439 pass, 13 skipped |
| `npm run test:db` (real sandbox) | 0 — 46/46 |
| `npm run certify:voice` | 0 — 12/12, NOT_CONFIGURED |
| `npm run security:scan` | 0 — PASS |
| `npm run build` | 0 — compiled successfully |
| `npm run test:runtime` | 0 — PASS |
| `npm run verify:full` | 0 — 426 pass/13 skipped, browser readiness PASS |

---

## 8. No live credentials used

**No live Meta, WhatsApp, LLM, or telephony/SIP/voice-provider credentials were used anywhere in this phase** — including during the real-sandbox defect discovery and fix verification. All verification ran against this project's own local sandbox infrastructure (`/tmp/services.sh`: local PostgreSQL 16, PostgREST, and an auth shim), never an external provider. Telephony remains honestly reported as **NOT_CONFIGURED** everywhere it is checked.

---

## 9. Known limitations and remaining activation requirements

- No real voice/telephony provider is connected anywhere in this build; `createVoiceAdapter('SANDBOX', ...)` reports `CREDENTIALS_MISSING` even if credentials were present, because no real adapter implementation exists yet.
- No provider-specific webhook signature verification exists — only VOYARA's own fixture/reference HMAC scheme (raw body, `sha256=` prefix), explicitly not validated against any real provider's actual scheme.
- No spending-ceiling persistence/summing across calls exists yet — the same category of gap already documented for LLM routing in the Phase 4C runbook.
- Consent and recording legal wording requires founder-approved legal review per operating jurisdiction before any live use; this is explicitly not assumed anywhere in this codebase.
- See `VOYARA-PHASE-4D-ACTIVATION-RUNBOOK.md` for the complete, exact list of what a real provider integration requires: provider selection, test/production numbers, Azerbaijan number or SIP-forwarding setup, API key and webhook secret, provider-specific signature verification, SIP trunk credentials where required, transfer destinations, AZ/RU/EN STT/TTS configuration, recording/retention policy, concurrency/duration/spending limits, escalation and business-hours routing, WhatsApp follow-up configuration (already reuses Phase 4C unchanged), and monitoring/incident procedures.
