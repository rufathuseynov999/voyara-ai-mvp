# VOYARA AI — Phase 4B Final Report: Dual Instagram, Unified CRM & Payment Links

**The project is not complete.** No real Instagram or payment activation has occurred — everything below is simulation-only, fail-closed for SANDBOX/LIVE. See `VOYARA-PHASE-4B-ACTIVATION-RUNBOOK.md` for exactly what real activation requires.

---

## 1. Exact implemented capabilities

**Customer identity** (`src/server/agents/identity-*.ts`): `autoLinkIdentity` (verified phone/email/website-auth only, idempotent, refuses silent re-pointing of an identity already linked elsewhere), `humanConfirmMerge` (AAL2-gated, immutable event), `reverseMerge` (AAL2-gated, never deletes the original record).

**Dual-brand conversations** (migration 17, additive to Phase 4A's `conversations`/`messages`): `customer_facing_brand`, `external_conversation_id`, `campaign_attribution`, `assigned_owner_id`, `handover_status`, `external_message_id`, `delivery_status`, `webhook_status`.

**CRM Inbox** (`/staff/inbox`, AAL2-staff-gated): brand/channel/language/status filters, conversation list, detail panel (timeline, linked identities, payment-link status, customer profile), assign/handover/escalate actions — escalation reuses Phase 4A's `escalateConversation` unchanged. AZ/RU/EN, 26 matching keys per locale, verified identical.

**Payment-link workflow** (`src/server/payment/payment-link-*.ts`): `draftPaymentLink` → `approvePaymentLink` (AAL2, exact content hash) → `createAndSendPaymentLink` (creates a fixture hosted checkout, delivers the URL only into the originating conversation via the existing message pipeline) → `processPaymentLinkWebhook` (reuses Phase 3's `processWebhook` unchanged) → `reconcilePaymentLink` (sibling to `reconcilePayment`, same exact-match-only discipline). Every founder-locked field is its own column.

---

## 2. Security and HAG controls

| Control | Mechanism |
|---|---|
| No auto-linking by name/username/similarity | Not a field on any linking/merge schema — verified by a structural test scanning both files |
| Merges require AAL2 | Runtime check in `humanConfirmMerge`/`reverseMerge`, tested both ways |
| One external identity → at most one contact | `unique (identity_kind, external_id)`, proven with a real `23505` against PostgreSQL |
| `HUMAN_CONFIRMED` link always has an actor | DB CHECK `linked_identities_human_confirmed_has_actor`, proven directly |
| Merges are immutable + reversible, never destructive | Reversal sets `reversed_at`/`reversed_by` on the original row; nothing is ever deleted |
| Payment link can't reach `LINK_CREATED`/`SENT` without a human approver | DB CHECK `payment_link_sent_requires_approval`, proven directly against PostgreSQL |
| Stale-hash rejection on payment-link approval | Identical discipline to quote/message approval, tested |
| Link delivered only into its originating conversation | `createAndSendPaymentLink` writes to `link.originatingConversationId` exclusively — proven by test |
| No refund/booking execution anywhere in the payment-link service | Structural source-scan test |
| Unique order references under real concurrency | Proven: 5 concurrent inserts → 1 winner, 4 real `23505`s |
| Idempotent webhook receipts under real concurrency | Proven: 5 concurrent duplicate event ids → 1 accepted receipt |
| Forced RLS on every new table (`linked_identities`, `identity_merge_events`, `payment_link_requests`, `payment_link_events`, `payment_link_webhook_receipts`) | Proven against real PostgreSQL |
| AAL1 staff and customers blocked; AAL2 staff read; no direct authenticated write anywhere | Proven against real PostgreSQL, including for AAL2 founder |
| Cross-customer isolation | Proven: customer B cannot see customer A's conversation or linked identities |
| CRM inbox authorization | Same `staffAreaRoles` + AAL2 gate as every other staff screen, enforced both at the page (`requireAssuranceLevel`) and the API route |

---

## 3. Database tables and migration

**Migration 17** (`20260727090000_task017_phase4b_dual_instagram_crm_payment_links.sql`): 5 new tables (`linked_identities`, `identity_merge_events`, `payment_link_requests`, `payment_link_events`, `payment_link_webhook_receipts`), 2 tables extended via `ALTER TABLE` (`conversations`, `messages`), 8 new enum types. Applied directly to a real PostgreSQL 16 sandbox with zero errors.

**Migration count: 17/17**, manifest regenerated and verified.

---

## 4. Tests and exact counts

| Suite | Result |
|---|---|
| `tests/phase-4b/identity-linking.test.ts` (hermetic) | **12/12 pass** |
| `tests/phase-4b/payment-link-service.test.ts` (hermetic) | **18/18 pass** |
| `tests/phase-4b/crm-inbox.test.ts` (hermetic) | **10/10 pass** |
| `tests/phase-4b/inbox-rls.test.ts` (sandbox-gated, real PostgreSQL) | **9/9 pass** |
| **Full hermetic suite (`npm test`)** | **357 defined, 344 pass, 13 skipped (sandbox-gated, expected), 0 fail** |
| **Sandbox suite (`npm run test:db`)** | **27/27 pass** against real PostgreSQL |

### Exact commands and exit codes

| Command | Exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npm run db:migrations:verify` | 0 — 17/17 |
| `npm test` | 0 — 344/357 pass, 13 skipped |
| `npm run test:db` (real sandbox) | 0 — 27/27 |
| `npm run security:scan` | 0 — PASS |
| `npm run build` | 0 — compiled successfully |
| `npm run test:runtime` | 0 — PASS |
| `npm run verify:full` | 0 — 344 pass/13 skipped, browser readiness PASS |

**One genuine defect found and fixed:** the initial sandbox RLS test ran two `assert.rejects` calls inside a single transaction; the first rejection aborted the transaction, causing the second check to fail with `25P02` instead of proving its own table's policy — the exact same class of bug encountered and fixed in Phase 3B's `db-integration.test.ts`. Fixed by splitting into separate transactions. This was a test-code defect, not a product defect — no application or schema code changed as a result.

---

## 5. Known limitations

- No real Instagram, WhatsApp, or payment-provider connection exists — `channel-registry.ts` still only permits `SIMULATION`; requesting any real channel in `SANDBOX`/`LIVE` mode fails closed.
- The CRM inbox's filters query PostgREST/Supabase directly (no dependency-injected port), matching the precedent already set by `loadAdministrationSnapshot` — this means full filter behavior is proven against real PostgreSQL (sandbox tests), not hermetically; the hermetic suite instead proves the authorization gate, fail-safe behavior, and contract consistency, which are the parts genuinely independent of a database.
- Delivering a payment link reuses a single approval (the link's own) rather than requiring a second, separate approval specifically for the outbound message — a deliberate reading of the founder's stated sequence (one approval event, not two), documented explicitly in `payment-link-service.ts`.
- No recurring/subscription billing engine exists yet, despite the `SUBSCRIPTION` transaction type being modeled.
- No real Meta webhook-receiving endpoint exists yet (a genuinely new route needed once a real Instagram adapter is built).

---

## 6. Gap matrix status

See `VOYARA-PHASE-4B-GAP-MATRIX.md` (updated this session) for the complete picture. Headline changes: dual-Instagram data model, CRM inbox UI, customer identity linking, and the full payment-link workflow moved from missing/partial to ✅ implemented and tested. Every external-credential row (real Instagram, real payment provider) remains 🔑, unchanged.

---

## 7. Immediate next steps (Phase 4C candidates, not started)

1. Real Instagram `ChannelAdapter` + Meta webhook-receiving endpoint (needs §1 of the activation runbook completed first).
2. Real payment-link adapter once a provider is chosen (needs §2 of the activation runbook).
3. CRM inbox: message composition/reply from the UI (currently read + assign/handover/escalate only — sending a reply still goes through the existing `agent-operating-layer.ts` functions directly, not yet wired into this specific UI).
4. Follow-up/workflow scheduler.

Nothing above has been started beyond the code shipped in this phase.
