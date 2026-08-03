# VOYARA AI — Phase 4C Final Report: WhatsApp, Website Chat, Risk-Gated Automation & LLM Routing

**The project is not complete.** No real WhatsApp number or LLM provider is connected. Everything below is simulation/fixture-only. See `VOYARA-PHASE-4C-ACTIVATION-RUNBOOK.md` for exactly what real activation requires.

---

## 1. Migration history correction and convergence proof

Migration 18 was restored byte-for-byte to its originally-applied form (no INBOUND exemption). Migration 19 was created containing **only** the drop-and-recreate correction, documented as a pre-release corrective migration.

**Convergence proof (comprehensive, not a narrow fragment check):** built a genuinely fresh PostgreSQL database, recreated the minimal Supabase auth shim (`auth.users`, `auth.uid()`, `auth.jwt()` — exact same function bodies as the development sandbox), and applied all 19 migration files **verbatim, in order**, with zero errors. Compared against the existing sandbox across every dimension:

| Dimension | Result |
|---|---|
| Tables | **91/91 identical** |
| CHECK constraints | **308/308 byte-for-byte identical** (confirmed the exact corrected `messages_sent_requires_approval_or_policy` text matches on both sides) |
| Indexes | **222/222 byte-for-byte identical** |
| RLS policies | **206/206 byte-for-byte identical** |
| RLS enabled/forced flags | **91/91 tables identical** |
| Public-schema functions | **8/8 identical** |

**Zero drift found.**

---

## 2. Exact implemented capabilities

**WhatsApp** (`src/server/agents/whatsapp/`): Meta's real webhook challenge (`hub.mode`/`hub.verify_token`/`hub.challenge`) and `X-Hub-Signature-256` HMAC verification (both stable, documented, implemented with full confidence), inbound text/button normalization into the existing `contacts`/`conversations`/`messages`/identity-linking infrastructure, the 24h service-window check, multi-account-ready construction. Real endpoint: `GET`/`POST /api/v1/whatsapp/webhook`.

**Website chat** (`src/server/agents/chat/`, `src/components/website-chat-widget.tsx`): cryptographically opaque session tokens (32 random bytes; only the SHA-256 hash is ever persisted), a store port whose *only* lookup method is by exact token hash, consent gating, rate limiting (20 messages / 10 minutes, rolling window), authenticated-customer linking. Real AZ/RU/EN widget mounted site-wide: consent notice, language control, typing/sending states, error/rate-limit messaging, accessible roles/labels, mobile-responsive.

**Message risk classification** (`src/server/agents/risk-policy-contract.ts`, `low-risk-auto-send.ts`): a founder-approved, versioned `message_send_policies` row whose own content hash is recomputed and checked at send time (not draft time). The only function in the codebase that can produce a `SENT` message without human approval — gated by an active policy, an allowed intent, and a hash match, all three checked every time.

**LLM routing** (`src/server/agents/llm-routing.ts`): `SimulationLlmRouter` is the only router that can be constructed; tiered selection (CHEAP for FAQ/qualification, STRONG for complex planning) with explicit reasons; spending-ceiling enforcement; a closed 5-member tool-permission set with no member resembling a write/payment/booking/cancel/refund capability.

**Unified inbox extension**: `unread` and `slaOverdue` computed fields, `markConversationRead`, visual badges; take-over/return-to-AI controls (from Phase 4B) confirmed working unchanged; channel filters already covered WhatsApp/website chat.

---

## 3. Security and HAG controls

| Control | Mechanism |
|---|---|
| No message processed before signature validation | `POST /api/v1/whatsapp/webhook` reads the raw body and calls `verifyAndParseWebhook` before any database access |
| Duplicate WhatsApp webhooks rejected | Reserve-first insert into `whatsapp_webhook_receipts`, proven with a real 5-way concurrent `23505` race → exactly 1 winner |
| Anonymous chat sessions strictly isolated | `resolveSession` is the only path to a session's data, always by exact token hash; proven both hermetically (wrong token → `SESSION_NOT_FOUND`) and against real PostgreSQL (customer B cannot see customer A's session row) |
| Session tokens never stored raw | Only `sha256(token)` persisted; proven by a structural test and a direct assertion that the stored hash never equals the token |
| Low-risk auto-send requires an active, hash-verified, intent-matching policy | Checked at send time; proven for missing policy, wrong intent, deactivated policy, and a policy whose stored hash no longer matches its own content |
| Sensitive messages can never be policy-authorized | DB CHECK `messages_sensitive_never_policy_authorized`, proven directly against PostgreSQL |
| Inbound customer messages don't need VOYARA approval | The migration 19 correction, proven directly against PostgreSQL and re-confirmed in the full convergence proof |
| LLM tool permissions are structurally non-authoritative | Closed enum, proven by a test scanning for forbidden terms (WRITE/PAYMENT/BOOK/CANCEL/REFUND/EXECUTE/CONFIRM) |
| No card data or raw credential stored anywhere | A sandbox test scans `information_schema.columns` across the entire public schema for suspicious column names — zero found |
| Forced RLS on every new table | `message_send_policies`, `whatsapp_accounts`, `whatsapp_webhook_receipts`, `chat_sessions`, `agent_llm_runs` — proven against real PostgreSQL, including AAL2-founder blocked from direct writes |

---

## 4. Database and migrations

**Migration 18** (`20260728090000_...`): restored to its originally-applied form. **Migration 19** (`20260728093000_...`): the single, narrow, documented correction. **Migration count: 19/19**, manifest verified, and — per §1 — comprehensively proven to converge identically from a genuinely fresh database.

---

## 5. Tests and exact counts

| Suite | Result |
|---|---|
| `low-risk-auto-send.test.ts` (hermetic) | 9/9 |
| `whatsapp.test.ts` (hermetic) | 17/17 |
| `chat-session.test.ts` (hermetic) | 10/10 |
| `llm-routing.test.ts` (hermetic) | 9/9 |
| `migration-history-correction.test.ts` (hermetic) | 3/3 |
| `phase4c-sandbox.test.ts` (sandbox-gated, real PostgreSQL) | **8/8** |
| **Full hermetic suite (`npm test`)** | **405 defined, 392 pass, 13 skipped, 0 fail** |
| **Sandbox suite (`npm run test:db`)** | **35/35 pass** against real PostgreSQL (27 Phase 4B + 8 new Phase 4C) |
| `npm run certify:whatsapp` | **7/7**, correctly reports NOT_CONFIGURED |

### Exact commands and exit codes

| Command | Exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm run db:migrations:verify` | 0 — 19/19 |
| `npm test` | 0 — 392/405 pass, 13 skipped |
| `npm run test:db` (real sandbox) | 0 — 35/35 |
| `npm run certify:whatsapp` | 0 — 7/7, NOT_CONFIGURED |
| `npm run security:scan` | 0 — PASS |
| `npm run build` | 0 — compiled successfully |
| `npm run test:runtime` | 0 — PASS |
| `npm run verify:full` | 0 — 392 pass/13 skipped, browser readiness PASS |

**Two genuine test-code bugs found and fixed during this phase** (neither a product defect): a foreign-key cleanup-ordering bug, and an overly narrow constraint-name assertion that didn't account for a sibling constraint firing first. Both fixed; full suite reconfirmed green afterward.

---

## 6. Known limitations

- No real WhatsApp, Instagram, or LLM connection exists anywhere in this build.
- Website chat sessions live only in the widget's React state (a page refresh starts a fresh session) — a deliberate, documented simplification for this phase, not a bug.
- Spending-ceiling enforcement works per-call but nothing yet sums real accumulated spend from `agent_llm_runs`.
- No template-message content library exists for WhatsApp's outside-service-window case.
- CRM inbox "reply" composition still goes through existing `agent-operating-layer.ts` functions directly, not a dedicated UI compose box (unchanged limitation from Phase 4B).

---

## 7. Gap matrix status

See `VOYARA-PHASE-4C-GAP-MATRIX.md` for the complete picture. WhatsApp architecture, website chat, risk-gated automation, and LLM routing all moved from missing to ✅ implemented-and-tested; every external-credential row (real WhatsApp number, real LLM provider) remains 🔑.

---

## 8. Exact external credentials and configuration still required

See `VOYARA-PHASE-4C-ACTIVATION-RUNBOOK.md` §1–3 for the complete list: Meta Business verification, WhatsApp Business Account ID, phone number ID, App ID/App Secret, access token, webhook verification token, callback URL, required permissions, message templates, App Review, and an LLM provider decision with API key and spending ceiling. None of this exists in the project today.
