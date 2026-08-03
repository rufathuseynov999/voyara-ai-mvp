# VOYARA AI — Phase 4A Final Report: AI Agent Operating Layer & Unified CRM Model

**The project is not complete.** This phase delivers a real, tested foundation for multi-channel AI agents and a unified conversation/CRM model — not a working voice receptionist, WhatsApp bot, or the six remaining agent personalities. See `VOYARA-PHASE-4A-GAP-MATRIX.md` for the complete picture.

---

## 1. Exact implemented capabilities

**Agent Operating Layer** (`src/server/agents/agent-operating-layer.ts`):
- `startConversation` — opens a conversation for a contact on a channel.
- `draftAgentMessage` — an AI agent proposes outbound message content. Can only ever produce `status: 'DRAFTED'`.
- `approveMessage` / `rejectMessage` — human-only (enforced at runtime, `actor.kind !== 'human'` throws), by exact content hash (stale-hash rejection, identical discipline to quote approval).
- `approveAndSendMessage` — the **only** function in the entire layer that calls a `ChannelAdapter`. Refuses anything not already `status: 'APPROVED'`.
- `escalateConversation` — hands a conversation to a human.

**Unified conversation/CRM data model** — 5 new tables (migration 15): `contacts`, `conversations`, `messages`, `agent_idempotency_keys`, `agent_audit_events`.

**Provider-neutral channel layer** (`channel-adapter.ts`, `channel-registry.ts`, `simulation-channel-adapter.ts`): same fail-closed registry pattern as the Hotelbeds/payment registries. `SIMULATION` channel works; `WHATSAPP`/`INSTAGRAM_DM`/`VOICE`/`WEB_CHAT`/`EMAIL` all correctly throw `UNSUPPORTED_CHANNEL` in every mode (no credentials exist for any of them); `LIVE` is never available for any channel.

**COO Agent** (`coo-agent.ts`, `coo-agent-contract.ts`) — founder-approved scope, read-only Daily Digest: `generateCooDigest()` reads five operational counts (pending approvals, payment mismatches, expiring offers, escalated conversations, conversations pending human review) through a read-only `OperationalSignalsSource` interface and produces risks/priorities/proposed actions via fixed, auditable thresholds. New table (migration 16): `coo_digests`.

---

## 2. Security and HAG controls

Every control below is enforced **structurally** (types, database constraints, or both), not by convention alone:

| Control | Mechanism |
|---|---|
| An agent can never send directly | `draftAgentMessage` has no reference to `ChannelAdapter`; only `approveAndSendMessage` does (verified by a structural test that scans every other function in the file) |
| A message can't reach SENT without human approval | Database CHECK constraint `messages_sent_requires_approval` (`status <> 'SENT' or (approved_by is not null and approved_at is not null)`) — refuses the write even if application code were bypassed; proven directly against real PostgreSQL |
| Every AI-agent-authored message requires approval | Database CHECK constraint `messages_agent_drafts_require_approval` + `agentDraftSchema`'s `requiresHumanApproval: z.literal(true)` (compiler-enforced, not a boolean default) |
| Stale-hash rejection on approval | `approveMessage` compares the exact content hash, identical to quote approval's `STALE_APPROVAL_HASH` discipline |
| Only a human can approve/reject | Runtime check on `actor.kind`, tested |
| COO agent cannot approve prices / send messages / execute payments / create bookings / cancel services / issue refunds / modify records | `coo_digests` has no `sent_at`/`executed_at`/`confirmed_at` column (schema-level); `CooProposedAction.kind` is a closed 7-member advisory-only enum (type-level); `generateCooDigest` never receives a `ConversationStore` or `ChannelAdapter` (structural, verified by a source-scanning test) |
| Forced RLS on every new table | `contacts`, `conversations`, `messages`, `agent_idempotency_keys`, `agent_audit_events`, `coo_digests` — all `force row level security`, proven against real PostgreSQL |
| AAL2-staff-only read | Same policy shape as `orchestration_audit_events` (Phase 3B); AAL1 staff and customers proven blocked against real PostgreSQL |
| No direct authenticated write | No INSERT/UPDATE policy exists on any new table for any authenticated role, including AAL2 founder — writes go through the service-role store only, proven against real PostgreSQL |
| Reserve-first idempotency | `agent_idempotency_keys` — identical PRIMARY KEY-decides guarantee as `orchestration_idempotency_keys`; a real 5-way concurrent race proven to produce exactly one winner and four real `23505`s against real PostgreSQL |
| Append-only audit journal | `agent_audit_events` — every lifecycle step (start, draft, approve, reject, send, escalate) writes an event; select-only policy |

---

## 3. Database tables and migrations

| Migration | Adds |
|---|---|
| `20260726090000_task015_phase4a_agent_operating_layer.sql` | `contacts`, `conversations`, `messages`, `agent_idempotency_keys`, `agent_audit_events`, plus 5 new enum types |
| `20260726093000_task016_phase4a_coo_digest.sql` | `coo_digests` |

**Migration count: 16/16** (14 from Phase 3A–3C + 2 new this phase — the instruction referencing "15/15" predates the founder's COO-agent decision within this same turn, which added migration 16; reported honestly as 16/16 here). Both migrations applied directly to a real PostgreSQL 16 sandbox with zero errors; manifest regenerated and verified.

---

## 4. Tests and exact counts

| Suite | Result |
|---|---|
| `tests/phase-4a/agent-operating-layer.test.ts` (hermetic) | **17/17 pass** |
| `tests/phase-4a/coo-agent.test.ts` (hermetic) | **10/10 pass** |
| `tests/phase-4a/agent-rls.test.ts` (sandbox-gated, real PostgreSQL) | **4/4 pass** |
| `tests/phase-4a/coo-digest-rls.test.ts` (sandbox-gated, real PostgreSQL) | **1/1 pass** |
| **Full hermetic suite (`npm test`)** | **317 defined, 304 pass, 13 skipped (sandbox-gated, expected), 0 fail** |
| **Sandbox suite (`npm run test:db`)** | **18/18 pass** against real PostgreSQL |

### Exact commands and exit codes (this session's final run)

| Command | Exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm run db:migrations:verify` | 0 — 16/16 |
| `npm test` | 0 — 304/317 pass, 13 skipped |
| `npm run test:db` (real sandbox) | 0 — 18/18 |
| `npm run security:scan` | 0 — PASS |
| `npm run build` | 0 — compiled successfully |
| `npm run test:runtime` | 0 — PASS |
| `npm run verify:full` | 0 — 304 pass/13 skipped, browser readiness PASS |

No genuine Phase 4A defects were found during this pipeline run requiring a fix (two self-referential test-assertion bugs — my own explanatory code comments containing the exact strings the test was checking were *absent* from real code — were caught and fixed during development, the same class of issue encountered and fixed in Phase 3C Part 2).

---

## 5. Known limitations

- No channel is actually connected. `SimulationChannelAdapter` is the only adapter that exists; sending a real WhatsApp/Instagram/voice/web-chat message is not possible in this build under any configuration.
- No LLM is wired in anywhere. The COO agent's digest content is deterministic and rule-based, not natural-language-generated; the six remaining agent roles have no logic at all yet — `draftAgentMessage` accepts hand-written or externally-generated content, it does not generate content itself.
- No CRM inbox UI exists — this phase is the data/service layer only.
- `account_id` scoping on the new tables follows the exact same pattern as every existing Phase 3 table (a single-business-context field, not genuine multi-tenant isolation between separate businesses) — consistent with the rest of the codebase, not a new gap.
- No follow-up/workflow scheduler exists.

---

## 6. Gap matrix status

See `VOYARA-PHASE-4A-GAP-MATRIX.md` (updated this session) for the complete category-by-category picture. Headline change from the prior version: §2 (channels — data model row), §3 (Agent Operating Layer row + new §3a COO agent), and §4 (CRM data-layer row) moved from partial/missing to ✅ implemented and tested. Every other row is unchanged.

---

## 7. Exact Phase 4B prerequisites

Before any further agent/channel work should start:
1. **Founder decision on LLM provider** (Anthropic, OpenAI, or other) and a funded API account — every one of the six remaining agent roles needs this to produce real content; `draftAgentMessage` is ready to receive whatever they produce.
2. **Founder decision + design pass on the CRM inbox UI** — who sees it, what actions are available from it (approve/reject/escalate at minimum), and how it fits alongside the existing staff CRM screen.
3. **Founder decision on which channel to build first** — recommend starting with **Web Chat** (no external account required beyond the LLM provider, fastest to build and test end-to-end) before WhatsApp/Instagram/voice, each of which needs its own external account (see §8).
4. **Follow-up/workflow scheduler decision** — Vercel Cron is the natural fit given the existing Vercel deployment; needs a design pass on what workflows actually run (e.g. "digest generated daily at 08:00").

---

## 8. Exact R-Travel documents, partner data and credentials required

Nothing in this list is available to this project. All of it must come from the founder / R-Travel directly before any migration work can begin:

**Partner and contract migration:**
- Full list of R-Travel's current hotel, tour operator, DMC, transfer, insurance, visa, and activity partners, with contract documents (or at minimum contract terms: commission/net rates, cancellation policies, payment terms) for each.
- Any exclusivity or minimum-volume clauses that would affect how VOYARA can route bookings.

**Supplier portal access:**
- Login credentials (or a formal request process) for each individual supplier's existing portal — these are typically non-transferable without the supplier's own re-registration process, so this is likely "a list of suppliers to re-onboard," not literally handed-over passwords.

**Customer data:**
- R-Travel's customer database export (contact details, booking history) **and** a documented legal basis for migrating it (consent already obtained, or a fresh consent process) — this is a compliance question, not just a technical one, and should involve whoever handles R-Travel's data protection obligations.

**Financial/historical records:**
- Historical booking and accounting records, to the extent they need to remain accessible post-migration (e.g. for tax, dispute resolution, or reporting continuity).

**Channel credentials (for Phase 4B, listed here for planning):**
- WhatsApp Business Platform access (via a Meta Business-verified account).
- Instagram Graph API access (via the same Meta Business account, plus a professional Instagram account).
- A telephony provider account (e.g. Twilio or similar) plus an STT/TTS provider, if the voice receptionist is prioritized.
- An LLM API account and key (§7).

None of the above can be fabricated, assumed, or worked around — every item requires a real action by the founder or a real document from R-Travel.
