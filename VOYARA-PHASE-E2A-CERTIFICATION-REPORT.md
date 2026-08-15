# VOYARA — Phase E.2A WhatsApp Activation Readiness — Certification Report

**Status: E.2A is frozen.** All certification gates below ran fresh, in this repository, and passed. WhatsApp remains inactive; no real Meta credentials exist anywhere in this repository.

---

## 1. Scope

Phase E.2A brings WhatsApp Business API conversations into the same accountable pipeline every other VOYARA channel already uses: **AI prepares -> Human approves -> VOYARA executes.** No message reaches a customer, and no Travel Request is created from a WhatsApp conversation, without an explicit human action running through the canonical authority paths described below.

E.2A covers: real Meta webhook envelope handling, account/brand/contact/verified-identity binding, active-conversation concurrency safety, external-message replay idempotency, provider-event-time safety for the WhatsApp customer-service window, the canonical `approveAndSendMessage` outbound authority path, the Conversation -> Intent -> Travel Request staff conversion command, immutable confirmation/acknowledgement provenance, a staff CRM workflow inside the existing Unified Inbox, and a safe internal visual preview mechanism.

E.2A does not include: live WhatsApp activation, real Meta credentials, a live WABA/phone-number/webhook registration, or any booking/payment/supplier authority derived from a WhatsApp conversation.

---

## 2. Founder Activation Gate and Credential State

- VOYARA_WHATSAPP_ACTIVATION_ENABLED defaults to false. With the flag disabled, inbound webhook receipts are still recorded (audit/idempotency) but never processed into a conversation, and approveAndSendMessage refuses any WhatsApp send with WHATSAPP_ACTIVATION_DISABLED before any network call.
- Credential state is read via readWhatsAppCredentialsState(): ABSENT / INVALID (partial, placeholder, or malformed) / VALID. No code path silently substitutes a default credential.
- No real Meta access token, app secret, webhook verify token, or phone-number ID is present anywhere in this repository. Every fixture/test credential is a synthetic string, never a real Meta value.

---

## 3. Real Meta Envelope Handling

- normalizeMetaWebhookEnvelope() parses the real object/entry/changes/value shape, across multiple entries and phone numbers per delivery, safely acknowledging unsupported field types rather than crashing on them.
- Raw-body signature verification runs before any parsing or write.
- Meta's message timestamp (seconds since epoch) is parsed by parseMetaMessageTimestamp() -- fail-closed (returns null) on malformed, negative, non-finite, missing, or implausibly far-future values. Milliseconds-mistaken-for-seconds fails closed via the far-future check rather than silently producing a wrong date.

---

## 4. Account / Brand / Contact / Verified-Identity Binding

- Every WhatsApp inbound message resolves its business account via a real whatsapp_accounts row lookup keyed on phone_number_id; an unknown or inactive number fails closed with no RTRAVEL default fallback.
- WhatsAppInboundContext.brand is typed as the non-nullable 'RTRAVEL' | 'VOYARA' union -- structurally distinct from the nullable Conversation['customerFacingBrand'] used by other channels -- so a WhatsApp conversation can never be created without a real resolved brand.
- Outbound sends resolve the recipient through resolveVerifiedWhatsAppRecipient(): requires a real LinkedIdentity row (identityKind: 'WHATSAPP', verified: true, matching contactId). Refuses on: no verified identity, an identity belonging to a different contact, ambiguous multiple verified identities, or a contacts.phone / verified-identity disagreement. A caller-supplied contactExternalId is structurally ignored for WhatsApp sends.

---

## 5. Active-Conversation Concurrency Safety

- Migration 29 adds a partial unique index (whatsapp_conversations_active_uidx) on conversations(account_id, contact_id, customer_facing_brand), scoped to channel = 'WHATSAPP' AND customer_facing_brand IS NOT NULL AND status IN ('OPEN','PENDING_HUMAN'), preceded by an explicit duplicate-preflight check that aborts the migration (never silently deletes/merges) if pre-existing duplicates are found.
- Application recovery (ActiveConversationConflictError, classified via classifyUniqueViolation()) re-reads the exact winning conversation by the identical (account, contact, channel, brand) scope on a real 23505 race and reuses it -- never fabricating a conversation ID, never losing the inbound message, and rethrowing untouched if no real winner can be found or if the conflict is unrelated.
- Verified structural/sequential correctness under a real Postgres-compatible engine (PGlite) -- not independent-connection concurrent-worker proof (see Limitations).

---

## 6. External-Message Replay Idempotency

- Migration 29 adds messages_channel_external_message_id_uidx, scoped by (channel, external_message_id) -- evidence-based scoping, documented in the migration itself, with the exact three conditions that would require revisiting it (a second WhatsApp Business Account namespace, a second provider sharing the WHATSAPP channel tag, or Instagram beginning to persist colliding IDs).
- Two-layer idempotency: (A) a pre-check via loadMessageByExternalId() before any mutation; (B) a race-catch on MessageReplayConflictError that reloads and re-verifies. Both apply the same full-evidence comparison (isGenuineWhatsAppReplay): account, contact, brand, direction, sender kind, content hash, and provider time must all match, or the replay fails closed rather than silently overwriting.
- A genuine replay never re-extends lastInboundAt, never creates a second conversation or message, and never re-runs downstream side effects.

---

## 7. Provider-Event-Time and Service-Window Safety

- messages.provider_occurred_at is a message-specific column, distinct from created_at (server/webhook-ingestion time) and from conversations.last_inbound_at (conversation-level activity).
- recordInboundActivity's inboundAt parameter is string | null: an untrusted/missing provider timestamp advances the conversation to PENDING_HUMAN/HUMAN handover (a human still needs to see the message) but never touches lastInboundAt -- the WhatsApp customer-service window is never opened or extended by a guess.
- A real database trigger (messages_evidence_immutability_trigger) protects body/content_hash for INBOUND messages unconditionally and for OUTBOUND messages once past DRAFTED, while delivery_status/webhook_status remain freely updatable for legitimate reconciliation. provider_occurred_at and external_message_id are immutable-once-set (not unconditionally frozen -- the real DRAFTED -> SENT transition legitimately sets them for the first time).

---

## 8. Canonical Outbound Authority Path

- approveAndSendMessage in agent-operating-layer.ts remains the single function anywhere in this codebase that calls a ChannelAdapter.sendOutbound -- including for WhatsApp. WhatsApp-specific logic (sendApprovedWhatsAppMessageInternal) is a private, non-exported helper reachable only from that one canonical path.
- WhatsApp low-risk auto-send is explicitly disabled for this checkpoint (sendLowRiskMessage refuses any WhatsApp conversation with WHATSAPP_AUTOSEND_NOT_ACTIVATED, audited, before any message is even drafted) -- proven to have no bypass, including through the pre-existing Phase 4D voice-call WhatsApp follow-up path.

---

## 9. Conversation -> Intent -> Travel Request Conversion

- execute_whatsapp_conversion_command (migration 29): SECURITY INVOKER, search_path='', EXECUTE granted only to service_role. Authority model is Model B, matching the already-proven execute_travel_request_command pattern: getViewer() cryptographically verifies the real staff JWT (supabase.auth.getClaims()) in trusted server code; the resulting Viewer is passed as data into a service_role RPC call. service_role has BYPASSRLS -- RLS does not protect this invocation; the documented seven-layer chain does (see migration 29's own header comment).
- The canonical server-only wrapper (executeWhatsAppConversionCommand) derives actorId/sessionId/assuranceLevel exclusively from the verified Viewer -- its input schema has no field through which a browser could supply any of those, or account/customer/brand/message-hash/provider-timestamp/idempotency-hash values.
- The command performs 15+ ordered server-side checks before atomically creating exactly one Travel Request, one version, one Intent (source = 'WHATSAPP'), one provenance record, and one idempotency receipt. Creates no proposal acceptance, payment request, booking, or supplier authority.

---

## 10. Immutable Confirmation/Acknowledgement Provenance

- public.intent_channel_provenance: append-only (RLS enabled and forced; service_role has SELECT/INSERT only -- verified with real pg_catalog privilege queries, no UPDATE/DELETE grant exists at all).
- Stores both the outbound confirmation-request message ID and the inbound acknowledgement message ID -- the command verifies the confirmation was genuinely OUTBOUND/STAFF/approved-and-SENT, the acknowledgement is genuinely INBOUND/CONTACT, and the acknowledgement's own provider_occurred_at is strictly later than the confirmation's sent_at.
- disclosure_version is validated against a closed, known set (E2A_AZ_V1/RU/EN), not an arbitrary caller string.

---

## 11. Staff CRM Workflow

- Extends the existing, already-authenticated /[locale]/staff/inbox (CrmInbox) rather than introducing a disconnected dashboard. A WhatsAppConversionPanel is mounted only for WHATSAPP-channel conversations, lets staff select the exact confirmation/acknowledgement messages from the real timeline, and submits through a new convertWhatsApp action on the existing /api/v1/inbox route -- gated by the same requireAal2Staff() check every other inbox action already uses.
- Denial reason codes are always mapped to staff-readable recovery guidance (denialGuidance()) -- never a raw RPC/SQL/enum string, including a generic fallback for any future unmapped code.

---

## 12. Internal Preview Safety

- /[locale]/internal-preview/e2a-whatsapp/[state]: notFound() unless process.env.VOYARA_INTERNAL_PREVIEW_ENABLED === 'true' (server-only variable, never NEXT_PUBLIC_), force-dynamic, noindex/nofollow, absent from navigation and the sitemap. Performs zero Supabase queries and constructs no admin client. The real WhatsAppConversionPanel is mounted in previewMode, where submit() is a hard no-op before any fetch call.

---

## 12a. Store Parity — Missing-Conversation Authority

`InMemoryConversationStore.saveMessage` and `SupabaseConversationStore.saveMessage` share the exact same missing-conversation authority invariant: a message can never be saved against a conversation that does not already exist. `SupabaseConversationStore` enforces this via a real foreign key; `InMemoryConversationStore` enforces it by throwing `CONVERSATION_NOT_FOUND` and never fabricating a conversation. An earlier draft of this store auto-vivified a placeholder conversation (`accountId: 'auto-vivified'`, `contactId: 'auto-vivified'`) when one was missing — this was a real correctness defect, not an acceptable lenient-test-double behavior, and has been removed entirely. No test fixture anywhere in this repository relies on that behavior; every fixture that saves a message now creates its real conversation first via `createConversation`. Six permanent tests in `tests/e2a/whatsapp-persistence.test.ts` prove the invariant holds and prevent this defect from being reintroduced.

---

## 13. Migration 29 Scope

One additive migration, three independent pieces, fully documented inline: (A) the active-conversation partial unique index plus duplicate preflight; (B) intent_channel_provenance, append-only, RLS-forced; (C) whatsapp_conversion_command_receipts + execute_whatsapp_conversion_command. Plus, added while still provisional: messages.channel (database-derived via messages_derive_channel_trigger, never caller-authoritative), messages.provider_occurred_at, the channel-scoped external-message unique index, the evidence-immutability trigger, and the conversation-channel immutability trigger. Migrations 1-28 remain byte-identical (verified via sha256sum -c).

---

## 14. Certification Results (this run)

| Gate | Result |
|---|---|
| TypeScript | Clean |
| AZ/RU/EN dictionary parity | 1285/1285 keys identical across all three locales |
| WhatsApp persistence/replay suite | 56/56 |
| Unique-violation classifier suite | 16/16 |
| Conversion-wrapper authority suite | 16/16 |
| CRM preview UI/API suite | 16/16 |
| Existing WhatsApp adapter/webhook suite | 17/17 |
| Agent-operating-layer suite | 17/17 |
| Low-risk-auto-send suite | 11/11 |
| Permanent database suite (npm run test:e2a:db) | 86/86 |
| Full repository suite (npm test) | 1336 total / 1314 pass / 0 fail / 22 skip |
| Security scan (npm run security:scan) | PASS |
| Production build | Succeeds |
| Runtime smoke (self-terminating harness) | 4/4 checks pass; no leftover server process |
| Browser certification (npm run test:e2a:browser) | 48/48 (4 viewports x 3 locales x 4 states, single invocation) |
| Migration count/immutability | 29/29 verify against manifest.sha256; migrations 1-28 byte-identical |

---

## 15. Honest Limitations

- No real Meta credentials exist in this repository. WhatsApp remains fully inactive.
- No live WABA, phone number, or webhook registration has been performed. Real activation requires separate, explicit founder approval and real credentials supplied outside this repository.
- PGlite proves real Postgres-compatible structure and sequential/transactional behavior -- it is not independent-connection production concurrency proof. The active-conversation and message-replay race-recovery paths are proven correct under sequential simulation of a race (a losing insert followed by a re-read), not genuine simultaneous multi-connection contention. A local multi-connection PostgreSQL cluster was not available in this environment.
- The browser certification matrix's 48 combinations were verified for the documented set of checks (overflow, chrome, console/page errors, raw-text leakage, state semantics); it is not a substitute for a full accessibility or performance audit.
- This is an internal, sandboxed development environment. Live activation, a production Supabase project's actual RLS/session behavior under real user traffic, and Meta's real webhook delivery characteristics should be re-validated against the real production environment before activation, not assumed identical to this certification.
