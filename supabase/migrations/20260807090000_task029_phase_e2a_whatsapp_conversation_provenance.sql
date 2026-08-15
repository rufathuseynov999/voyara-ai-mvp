-- VOYARA AI Phase E.2A: WhatsApp conversation concurrency guarantee,
-- Intent channel provenance, and the staff-reviewed WhatsApp -> Travel
-- Request conversion command.
--
-- Additive only. Migrations 1-28 are not edited, renamed or reordered.
--
-- THREE INDEPENDENT PIECES:
--
-- A. Partial unique index guaranteeing at most one ACTIVE (OPEN or
--    PENDING_HUMAN) WhatsApp conversation per (account_id, contact_id,
--    customer_facing_brand). The application's findOpenConversation query
--    (supabase-conversation-store.ts) is a best-effort read; under a real
--    race (two webhook deliveries for a brand-new contact arriving within
--    milliseconds of each other) it cannot fully prevent two rows from
--    being created. This index makes that structurally impossible instead
--    of merely unlikely — the second insert receives Postgres error 23505,
--    which the application (whatsapp-inbound.ts) already re-reads and
--    reuses the winning row for, rather than losing the second inbound
--    message.
--
-- B. public.intent_channel_provenance: an append-only, audit-only record
--    of exactly which WhatsApp conversation and which inbound
--    acknowledgement message a channel-sourced Intent came from. This is
--    provenance ONLY — it duplicates no destination/dates/travellers/
--    budget/purpose/notes; that content lives exclusively in
--    travel_request_versions.canonical_payload, unchanged. A dedicated
--    table was chosen over adding columns directly to the mutable
--    `intents` pointer row because: (1) `intents` already has a distinct,
--    narrow purpose (pointer + lifecycle) and this is a different concern
--    (audit/provenance) with different access-pattern needs; (2) keeping
--    it separate means intents.source = 'WHATSAPP' stays valid and
--    meaningful even for a hypothetical future non-conversation-based
--    WhatsApp intent path, without ever making the FK columns nullable on
--    the pointer table itself; (3) it is naturally append-only/immutable
--    (no UPDATE grant at all), which is awkward to express as "some
--    columns on a row that otherwise legitimately gets updated".
--
-- C. public.whatsapp_conversion_command_receipts +
--    public.execute_whatsapp_conversion_command(...): a dedicated
--    transactional, idempotent, AAL2-staff-only command, mirroring the
--    exact security posture and session/role verification already proven
--    by public.execute_travel_request_command (security invoker, fixed
--    empty search_path, revoked from anon/authenticated/public, granted
--    only to service_role). A dedicated function was used instead of
--    extending execute_travel_request_command because this command
--    creates a NEW travel_requests row, a NEW travel_request_versions
--    row, a NEW intents row, and a NEW intent_channel_provenance row all
--    atomically for a customer who is not the calling actor (a staff
--    member converting on the customer's behalf) — a materially different
--    operation from that function's existing "act as the authenticated
--    customer on their own request" contract. Reusing that function's
--    command-name branching for this would mean impersonating the
--    customer through a customer-authority code path, which is exactly
--    what this checkpoint was told not to do.
--
-- This command creates NO proposal acceptance, payment request, booking,
-- supplier execution or operational authorization of any kind — it only
-- ever produces a DRAFT-status travel_requests row (the same starting
-- status the Wizard produces), an intents row, and a provenance row.

-- Section 1 correction: `messages` is genuinely multi-channel — Instagram's
-- own adapter (src/server/agents/instagram/instagram-adapter.ts) already
-- returns an externalMessageId (Meta's `mid`) in its ChannelResult, even
-- though instagram-inbound.ts does not yet persist it onto the message
-- row. A GLOBAL unique index on external_message_id alone is therefore
-- only safe by accident today, not by design, and would become a real
-- cross-channel collision risk the moment Instagram inbound is updated to
-- persist its own externalMessageId. `messages` has no channel column of
-- its own (channel lives on `conversations`); this denormalizes it onto
-- each message row specifically so the uniqueness scope can be expressed
-- without a cross-table index (Postgres unique indexes cannot reference
-- another table). It is backfilled from the owning conversation for every
-- existing row, so this is safe against current data by construction.
-- Section 2 correction: `channel` must never be a value a caller merely
-- asserts — it must be DERIVED from and validated against the owning
-- conversation's real channel, every time, so it can never drift or be
-- claimed incorrectly. A caller may now even omit `channel` entirely on
-- INSERT (it is derived automatically); if a caller supplies one anyway,
-- it must match or the insert is rejected outright — never silently
-- overwritten to look consistent.
alter table public.messages
  add column channel public.channel_kind;

update public.messages m
set channel = c.channel
from public.conversations c
where c.id = m.conversation_id;

-- Section 2 correction: `channel` must never be a value a caller merely
-- asserts — it must be DERIVED from and validated against the owning
-- conversation's real channel, every time, so it can never drift or be
-- claimed incorrectly. A caller may now even omit `channel` entirely on
-- INSERT (it is derived automatically); if a caller supplies one anyway,
-- it must match or the insert is rejected outright — never silently
-- overwritten to look consistent.
create or replace function private.derive_and_validate_message_channel()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_channel public.channel_kind;
begin
  select channel into v_conversation_channel from public.conversations where id = new.conversation_id;
  if v_conversation_channel is null then
    raise exception 'messages.conversation_id % does not reference an existing conversation.', new.conversation_id;
  end if;

  if new.channel is not null and new.channel <> v_conversation_channel then
    raise exception 'messages.channel (%) does not match the owning conversation''s real channel (%). channel is derived, never caller-asserted.', new.channel, v_conversation_channel;
  end if;

  new.channel := v_conversation_channel;
  return new;
end;
$$;

create trigger messages_derive_channel_trigger
  before insert on public.messages
  for each row execute function private.derive_and_validate_message_channel();

alter table public.messages
  alter column channel set not null;

-- E.2A Section 0 correction — RLS DOES NOT PROTECT THIS INVOCATION.
-- createAdminSupabaseClient() uses the service_role key, and service_role
-- has BYPASSRLS in every Supabase/Postgres project by design — RLS
-- policies (and the FORCE ROW LEVEL SECURITY on this migration's new
-- tables) are simply not evaluated for this role at all. Do not read the
-- "force row level security" statements elsewhere in this migration as
-- protecting the RPC call path itself — they protect against a
-- hypothetical DIRECT table read/write by `authenticated`/`anon`, which
-- have no grants on these tables regardless. The actual authority chain
-- protecting this function's invocation is layered differently:
--   1. cryptographic JWT verification (supabase.auth.getClaims()) in
--      trusted server code the network caller cannot reach or forge;
--   2. the server-derived Viewer object built entirely from that
--      verification, never from client input;
--   3. the service_role secret itself staying server-only (never shipped
--      to a browser, never in a NEXT_PUBLIC_ variable);
--   4. EXECUTE granted only to service_role (no other role can even
--      attempt to call this function, regardless of RLS);
--   5. this function's OWN internal session-revocation / AAL / staff-role
--      re-verification against the same source-of-truth tables step 1
--      already checked (defense in depth against a hypothetical
--      application bug, not the primary boundary);
--   6. cross-account/contact/customer/brand/evidence validation inside
--      the function body;
--   7. the immutable provenance and receipt records this function writes,
--      which make any successful conversion auditable after the fact.
-- RLS is real and enforced for `authenticated`/`anon` callers of the
-- underlying tables; it is simply not the mechanism protecting THIS
-- function, because service_role never evaluates it.

-- E.2A Section 1 — external-ID namespace scope, evidence-based decision.
-- (channel, external_message_id) was chosen, not a broader
-- (provider_account, channel, external_message_id) tuple, for two
-- independently sufficient reasons, both grounded in the actual current
-- system rather than assumed:
--   1. This project operates exactly ONE fixed WhatsApp business account
--      today — every WhatsApp conversation is created under the single
--      constant VOYARA_BUSINESS_ACCOUNT_ID
--      (src/server/agents/business-account.ts), not a per-WABA account.
--      There is no second business-account namespace in this codebase for
--      "same external ID, different account" to actually collide against.
--      Adding a provider-account column now, for an architecture that
--      does not exist yet, would be exactly the speculative
--      over-engineering this checkpoint was told to avoid.
--   2. Independently of point 1: Meta's own Cloud API documentation
--      guarantees WhatsApp message IDs (`wamid...`) are unique across
--      Meta's entire messaging infrastructure, not merely per WABA — so
--      even in a future multi-account architecture, channel-scoping alone
--      would already be sufficient for WhatsApp specifically, without
--      needing a narrower key.
-- If this project ever operates multiple independent WhatsApp Business
-- Accounts sharing this codebase, this specific decision — not the
-- general index design — is what should be revisited then, with real
-- evidence of that architecture, rather than now. This index is NOT
-- claimed permanently sufficient for every future provider architecture —
-- specifically, it should be revisited when ANY of the following becomes
-- true (none are true today):
--   - a second WhatsApp Business Account / phone_number_id namespace is
--     operated inside this same account_id;
--   - an additional provider is integrated whose external message IDs
--     are not guaranteed unique within that provider's own channel value
--     (e.g. a hypothetical second "WHATSAPP"-tagged provider with its own
--     independent ID space — not the case for Meta's Cloud API today);
--   - Instagram inbound is updated to persist externalMessageId onto
--     message rows in a way that could share an ID namespace with another
--     INSTAGRAM_DM-tagged provider.

------------------------------------------------------------------------------
-- A0. Message-level provider event time + webhook-replay deduplication
------------------------------------------------------------------------------

-- Section 2 correction: message.created_at is server/webhook-ingestion
-- time, not the customer's actual send time — a delayed or replayed old
-- Meta event could otherwise be received after a confirmation request and
-- falsely satisfy an ordering check based on created_at. This column
-- carries Meta's own message timestamp (its `timestamp` field, seconds
-- since epoch, converted to timestamptz), bound to the specific message
-- row it describes, not to the conversation as a whole
-- (conversations.last_inbound_at cannot bind a timestamp to one exact
-- message and is never used for this purpose).
alter table public.messages
  add column provider_occurred_at timestamptz;

-- Section 4/1: Meta webhooks are at-least-once/replayable. A unique index
-- (not merely an application SELECT-before-INSERT) is what actually
-- closes the race under concurrent/repeated delivery of the identical
-- external message id. Scoped to (channel, external_message_id) rather
-- than external_message_id alone — this is the narrowest defensible key
-- given the actual current schema: `messages` has no per-provider-account
-- column today (WhatsApp's account/brand context lives one hop away, on
-- `conversations`, and this single-tenant business account model does not
-- yet operate multiple WhatsApp Business Accounts against the same
-- Meta-assigned id namespace — if that changes, this index should be
-- revisited then, not speculatively over-scoped now). Real Meta `wamid`
-- values are documented as unique per WhatsApp Business Account, and this
-- project operates exactly one WABA per environment, so channel-scoping
-- is the correct, evidence-based boundary today. NULL external_message_id
-- values (outbound drafts pre-send, or messages with no provider id) are
-- correctly left unconstrained by the partial predicate.
create unique index messages_channel_external_message_id_uidx
  on public.messages (channel, external_message_id)
  where external_message_id is not null;

-- Section 1B correction: the evidence-immutability trigger below now also
-- protects the new `channel` column, and its exceptions are scoped to the
-- real canonical message lifecycle rather than blocking every UPDATE:
--   - an INBOUND message's evidence is immutable from the moment it is
--     inserted (a customer's message is never "drafted" — it always
--     arrives already SENT (see whatsapp-inbound.ts / instagram-inbound.ts);
--   - an OUTBOUND message's evidence (body/content_hash) remains editable
--     ONLY while status = 'DRAFTED' — the real, existing DRAFTED -> APPROVED
--     -> SENT lifecycle (approveMessage / approveAndSendMessage in
--     agent-operating-layer.ts) already treats DRAFTED as the sole
--     editable state; APPROVED and SENT are, by the database's own
--     pre-existing messages_sent_requires_approval constraint, meant to be
--     final;
--   - conversation_id, direction, sender_kind, channel, created_at and
--     message_type are identity fields and are immutable unconditionally,
--     at every status, for both directions — these describe WHAT a
--     message fundamentally is, never legitimately corrected in place;
--   - external_message_id and provider_occurred_at are immutable-once-SET
--     (same pattern as approved_by/approved_at/sent_at) — an outbound
--     message legitimately transitions these from NULL to a real value
--     exactly once, at the moment it is actually sent;
--   - delivery_status and webhook_status remain updatable always (the
--     real, expected PENDING -> DELIVERED -> READ reconciliation flow).
create or replace function private.protect_message_evidence_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.direction <> old.direction
    or new.sender_kind <> old.sender_kind
    or new.channel <> old.channel
    or new.conversation_id <> old.conversation_id
    or new.created_at <> old.created_at
    or new.message_type <> old.message_type
  then
    raise exception 'Message identity fields (direction, sender_kind, channel, conversation_id, created_at, message_type) are immutable once written.';
  end if;

  -- external_message_id / provider_occurred_at: immutable-once-SET, same
  -- pattern as approved_by/approved_at/sent_at below — the legitimate
  -- DRAFTED -> SENT transition sets these for the first time (they are
  -- NULL for an outbound draft), which must remain permitted; only a
  -- REASSIGNMENT of an already-set value is a real substitution attempt.
  if old.external_message_id is not null and new.external_message_id is distinct from old.external_message_id then
    raise exception 'external_message_id cannot be reassigned once set.';
  end if;
  if old.provider_occurred_at is not null and new.provider_occurred_at is distinct from old.provider_occurred_at then
    raise exception 'provider_occurred_at cannot be reassigned once set.';
  end if;

  -- body/content_hash: immutable for INBOUND (always was, at every
  -- status) and for OUTBOUND once past DRAFTED; still editable for an
  -- OUTBOUND message that is still DRAFTED (the real, existing review
  -- workflow).
  if new.body <> old.body or new.content_hash <> old.content_hash then
    if old.direction = 'INBOUND' or old.status <> 'DRAFTED' then
      raise exception 'Message body/content_hash are immutable once the message is INBOUND or has left DRAFTED status.';
    end if;
  end if;

  -- approval/send evidence: once genuinely set, never reassignable to a
  -- different value (correcting a null->value transition, i.e. the real
  -- approve/send action itself, is exactly what this must still permit).
  if old.approved_by is not null and new.approved_by is distinct from old.approved_by then
    raise exception 'approved_by cannot be reassigned once set.';
  end if;
  if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
    raise exception 'approved_at cannot be reassigned once set.';
  end if;
  if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
    raise exception 'sent_at cannot be reassigned once set.';
  end if;

  return new;
end;
$$;

create trigger messages_evidence_immutability_trigger
  before update on public.messages
  for each row execute function private.protect_message_evidence_immutability();

-- Section 3 correction: messages.channel is derived from
-- conversations.channel at message-insert time — but nothing previously
-- stopped conversations.channel itself from being changed afterward,
-- which would silently invalidate every already-derived message row's
-- channel without any of them being re-validated. No application code in
-- this repository ever updates conversations.channel today (confirmed by
-- inspection), but that absence was never database-enforced. This closes
-- it at the source: channel is fixed at creation, permanently, while
-- every other conversation field involved in ordinary progression
-- (status, assigned_agent_role, related_quote_id, last_message_at,
-- last_inbound_at, handover_status, customer_facing_brand) remains freely
-- updatable exactly as the real CRM/inbox/WhatsApp workflows require.
create or replace function private.protect_conversation_channel_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.channel <> old.channel then
    raise exception 'conversations.channel is immutable once set (was %, attempted %). A conversation''s channel never changes after creation.', old.channel, new.channel;
  end if;
  return new;
end;
$$;

create trigger conversations_channel_immutability_trigger
  before update on public.conversations
  for each row execute function private.protect_conversation_channel_immutability();

------------------------------------------------------------------------------
-- A. Active WhatsApp conversation uniqueness
------------------------------------------------------------------------------

do $$
declare
  v_duplicate_count integer;
begin
  select count(*) into v_duplicate_count
  from (
    select account_id, contact_id, customer_facing_brand
    from public.conversations
    where channel = 'WHATSAPP'
      and customer_facing_brand is not null
      and status in ('OPEN', 'PENDING_HUMAN')
    group by account_id, contact_id, customer_facing_brand
    having count(*) > 1
  ) duplicates;

  if v_duplicate_count > 0 then
    raise exception
      'Migration 29 aborted: % existing (account_id, contact_id, customer_facing_brand) group(s) already have more than one active WHATSAPP conversation. This migration never deletes or merges data automatically — resolve the duplicates manually, then re-run.',
      v_duplicate_count;
  end if;
end $$;

create unique index whatsapp_conversations_active_uidx
  on public.conversations (account_id, contact_id, customer_facing_brand)
  where channel = 'WHATSAPP'
    and customer_facing_brand is not null
    and status in ('OPEN', 'PENDING_HUMAN');

------------------------------------------------------------------------------
-- B. Intent channel provenance (append-only, audit-only)
------------------------------------------------------------------------------

create table public.intent_channel_provenance (
  intent_id uuid primary key references public.intents (id) on delete restrict,
  source_conversation_id uuid not null references public.conversations (id) on delete restrict,
  -- E.2A correction (Section 1): a conversion must be tied to BOTH the
  -- outbound confirmation/consent request the customer actually saw AND
  -- the inbound reply that followed it — an arbitrary inbound "yes" with
  -- no confirmation-request evidence is not proof of anything. Both
  -- message ids are stored so the exact conversation transcript segment
  -- that authorized this conversion can always be reconstructed; the
  -- function (below) additionally verifies both messages belong to this
  -- conversation, the confirmation request was actually approved and SENT
  -- through the canonical human-approved path (never a draft), and the
  -- acknowledgement's own timestamp is strictly after the confirmation
  -- request's — none of which a CHECK constraint alone can express
  -- (Postgres CHECK constraints cannot reference other tables), so it is
  -- enforced in execute_whatsapp_conversion_command before this row is
  -- ever inserted.
  confirmation_request_message_id uuid not null references public.messages (id) on delete restrict,
  acknowledgement_message_id uuid not null references public.messages (id) on delete restrict,
  acknowledgement_content_hash text not null,
  -- Identifies exactly which versioned AZ/RU/EN confirmation copy (the
  -- disclosure text shown to the customer) the confirmation request used —
  -- so a future audit or disclosure-wording change can tell precisely
  -- which language this specific customer actually saw and agreed to.
  disclosure_version text not null,
  converted_by_staff_id uuid not null references auth.users (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  customer_facing_brand public.customer_facing_brand not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint intent_channel_provenance_hash_check
    check (acknowledgement_content_hash ~ '^[0-9a-f]{64}$'),
  constraint intent_channel_provenance_disclosure_version_check
    check (char_length(disclosure_version) between 1 and 64),
  constraint intent_channel_provenance_distinct_messages_check
    check (confirmation_request_message_id <> acknowledgement_message_id)
);

create index intent_channel_provenance_conversation_idx
  on public.intent_channel_provenance (source_conversation_id);
create index intent_channel_provenance_ack_message_idx
  on public.intent_channel_provenance (acknowledgement_message_id);
create index intent_channel_provenance_confirmation_message_idx
  on public.intent_channel_provenance (confirmation_request_message_id);
create index intent_channel_provenance_customer_idx
  on public.intent_channel_provenance (customer_id);

alter table public.intent_channel_provenance enable row level security;
alter table public.intent_channel_provenance force row level security;

revoke all on table public.intent_channel_provenance from public;
revoke all on table public.intent_channel_provenance from anon;
revoke all on table public.intent_channel_provenance from authenticated;
-- Append-only from the trusted server path: service_role may insert and
-- read, but has no update/delete grant at all — there is no "amend"
-- operation for provenance, only new rows.
grant select, insert on table public.intent_channel_provenance to service_role;

------------------------------------------------------------------------------
-- C. Staff-reviewed WhatsApp -> Travel Request conversion command
------------------------------------------------------------------------------

create table public.whatsapp_conversion_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint whatsapp_conversion_receipts_key_length_check
    check (char_length(idempotency_key) between 12 and 160),
  constraint whatsapp_conversion_receipts_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_conversion_receipts_response_object_check
    check (jsonb_typeof(response) = 'object'),
  constraint whatsapp_conversion_receipts_expiry_check
    check (expires_at > created_at)
);

alter table public.whatsapp_conversion_command_receipts enable row level security;
alter table public.whatsapp_conversion_command_receipts force row level security;
revoke all on table public.whatsapp_conversion_command_receipts from public;
revoke all on table public.whatsapp_conversion_command_receipts from anon;
revoke all on table public.whatsapp_conversion_command_receipts from authenticated;
grant select, insert on table public.whatsapp_conversion_command_receipts to service_role;

-- E.2A Section 1 — PRODUCTION INVOCATION AUTHORITY MODEL (proven, not
-- assumed). This function is SECURITY INVOKER, EXECUTE granted only to
-- service_role. That is safe ONLY because of the exact call chain this
-- codebase already uses for execute_travel_request_command
-- (src/server/travel-request/command.ts), which this new command's
-- TypeScript wrapper (src/server/agents/whatsapp/whatsapp-conversion-command.ts)
-- follows unchanged:
--
--   1. Staff CRM route/server action calls requireViewerRole(...) — this
--      is the ONLY place identity enters the system. It builds a
--      createServerSupabaseClient() bound to the staff member's own
--      browser session cookies, then calls supabase.auth.getClaims(),
--      which CRYPTOGRAPHICALLY VERIFIES the JWT signature against
--      Supabase's own signing keys. This cannot be forged by an ordinary
--      caller — it requires Supabase's private key. The resulting Viewer
--      { id, sessionId, assuranceLevel, issuedAt } is a verified fact,
--      not a client-supplied claim.
--   2. That Viewer is passed, as a typed parameter, into
--      executeWhatsAppConversionCommand(viewer, ...) — there is no
--      code path where a caller can substitute an arbitrary actor id;
--      the function signature only accepts a Viewer object, never a bare
--      string id from request input.
--   3. That function calls createAdminSupabaseClient() (service_role) to
--      invoke this RPC, passing viewer.id/sessionId/assuranceLevel/
--      issuedAt as DATA parameters (p_actor_id etc.) — NOT as the
--      Postgres session's authenticated identity. Under this call, the
--      resulting Postgres role is `service_role`; auth.uid() returns
--      NULL (service_role JWTs carry no `sub` claim); this function does
--      NOT rely on auth.uid() at all, precisely because service_role
--      calls have no such per-user identity to rely on.
--   4. This function's own session_revocations / user_session_security /
--      role_assignments checks are DEFENSE IN DEPTH — a second,
--      independent re-verification against the same tables getViewer()
--      already checked, protecting against a hypothetical application
--      bug that constructs a stale/incorrect Viewer, not the primary
--      authentication boundary (that boundary is step 1's cryptographic
--      JWT verification, which happens in trusted server code the
--      network caller never touches).
--
-- CALLABILITY MATRIX (who can actually reach this function, and as whom):
--   authenticated AAL2 authorized staff  -> reaches step 1 successfully;
--     Viewer built with role 'staff'+; RPC call succeeds if session/role
--     checks also pass (defense-in-depth agrees with step 1).
--   authenticated AAL1 staff             -> requireViewerRole/staff route
--     guard already denies AAL1 for staff areas before this function is
--     ever called; if somehow reached anyway, AAL2_REQUIRED denies it.
--   authenticated non-staff              -> requireViewerRole denies at
--     step 1; STAFF_REQUIRED denies if somehow reached anyway.
--   revoked staff session                -> getClaims() may still parse
--     a not-yet-expired JWT, but SESSION_REVOKED denies at the DB layer
--     (this is exactly the case the defense-in-depth check exists for).
--   anon (no JWT at all)                 -> createServerSupabaseClient()
--     yields no session; getViewer() returns null; the CRM route never
--     even attempts the RPC call. Separately, anon has no EXECUTE grant
--     on this function at all, so even a direct RPC call attempt is
--     refused by Postgres itself before this function's body runs.
--   backend service-role call, no user JWT -> this is exactly how the
--     trusted server calls it (step 3) — auth.uid() is null by design;
--     authority comes from the p_actor_* parameters the trusted server
--     already verified in step 1, not from the database session's own
--     identity.
--   service key + a user Authorization JWT attached -> not a pattern
--     this codebase's Supabase client helpers construct; a service-role
--     client (createAdminSupabaseClient) never attaches a user JWT.
--
-- CHOICE: SECURITY INVOKER is retained (not SECURITY DEFINER) — the only
-- role that can execute this function is service_role, which already has
-- full table access via its grants; there is no RLS-bypass reason to
-- need SECURITY DEFINER, and INVOKER keeps this function's effective
-- privileges exactly equal to the calling role's, the safer default.
create or replace function public.execute_whatsapp_conversion_command(
  p_command_id uuid,
  p_idempotency_key text,
  p_actor_id uuid,
  p_actor_session_id uuid,
  p_actor_aal text,
  p_actor_issued_at timestamptz,
  p_conversation_id uuid,
  p_confirmation_request_message_id uuid,
  p_acknowledgement_message_id uuid,
  p_acknowledgement_content_hash text,
  p_disclosure_version text,
  p_content jsonb,
  p_content_hash text,
  p_idempotency_payload_hash text,
  p_correlation_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.whatsapp_conversion_command_receipts%rowtype;
  v_conversation public.conversations%rowtype;
  v_contact public.contacts%rowtype;
  v_confirmation_message public.messages%rowtype;
  v_ack_message public.messages%rowtype;
  v_customer_id uuid;
  v_revoked_before timestamptz;
  v_request_id uuid;
  v_intent_id uuid;
  v_result jsonb;
begin
  -- 1. idempotent replay check, first, before any other verification.
  --    Keyed on a composite hash covering every authority-relevant input
  --    (conversation, confirmation message, acknowledgement message,
  --    both evidence hashes, disclosure version, and the Travel Request
  --    content itself) — computed by the trusted caller, the same
  --    established pattern already used for execute_travel_request_command's
  --    p_payload_hash (sha256 computed in TypeScript, never inside
  --    Postgres, since pgcrypto is not assumed available). Reusing only
  --    the narrower travel-request content hash here would let two
  --    requests with identical trip content but DIFFERENT evidence
  --    collide under the same idempotency key.
  select * into v_existing
  from public.whatsapp_conversion_command_receipts
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.payload_hash <> p_idempotency_payload_hash then
      return jsonb_build_object('status', 'denied', 'reasonCode', 'IDEMPOTENCY_CONFLICT');
    end if;
    return v_existing.response;
  end if;

  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_content) <> 'object' then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_PAYLOAD');
  end if;
  if p_idempotency_payload_hash is null or p_idempotency_payload_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_PAYLOAD');
  end if;

  -- 2. real, non-revoked AAL2 staff session evidence — identical checks to
  --    execute_travel_request_command's staff-command branch.
  if p_actor_session_id is null or p_actor_issued_at is null or p_actor_aal <> 'aal2' then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'AAL2_REQUIRED');
  end if;

  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_REVOKED');
  end if;

  select revoked_before into v_revoked_before
  from public.user_session_security
  where user_id = p_actor_id;

  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_REVOKED');
  end if;

  if not exists (
    select 1 from public.role_assignments
    where user_id = p_actor_id
      and role in ('staff', 'manager', 'admin', 'founder')
      and active
  ) then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'STAFF_REQUIRED');
  end if;

  if (
    select count(*) from public.whatsapp_conversion_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
  ) >= 60 then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'RATE_LIMITED');
  end if;

  -- 3. conversation must be a real, WHATSAPP-channel, brand-resolved
  --    conversation.
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'CONVERSATION_NOT_FOUND');
  end if;
  if v_conversation.channel <> 'WHATSAPP' then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'CONVERSATION_NOT_WHATSAPP');
  end if;
  if v_conversation.customer_facing_brand is null then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'MISSING_BRAND');
  end if;

  -- 4. contact must link unambiguously to exactly one real customer.
  select * into v_contact from public.contacts where id = v_conversation.contact_id;
  if not found or v_contact.linked_customer_id is null then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'UNLINKED_CONTACT');
  end if;
  v_customer_id := v_contact.linked_customer_id;

  -- 5. confirmation-request evidence: a real message, belonging to THIS
  --    conversation, OUTBOUND, sent by STAFF, and actually SENT through
  --    the canonical human-approved path (approved_by/approved_at set —
  --    never a draft, and never possible to fabricate since the database
  --    itself already enforces messages_sent_requires_approval).
  select * into v_confirmation_message from public.messages where id = p_confirmation_request_message_id;
  if not found then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'CONFIRMATION_REQUEST_NOT_FOUND');
  end if;
  if v_confirmation_message.conversation_id <> p_conversation_id then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'CONFIRMATION_REQUEST_WRONG_CONVERSATION');
  end if;
  if v_confirmation_message.direction <> 'OUTBOUND' or v_confirmation_message.sender_kind <> 'STAFF' then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'CONFIRMATION_REQUEST_NOT_STAFF_OUTBOUND');
  end if;
  if v_confirmation_message.status <> 'SENT' or v_confirmation_message.approved_by is null or v_confirmation_message.approved_at is null or v_confirmation_message.sent_at is null then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'CONFIRMATION_REQUEST_NOT_SENT');
  end if;

  -- 6. acknowledgement evidence: a real, INBOUND, CONTACT-sent message,
  --    belonging to THIS conversation, whose exact stored content_hash
  --    matches what was recorded at conversion time — never a
  --    caller-asserted hash accepted on faith.
  select * into v_ack_message from public.messages where id = p_acknowledgement_message_id;
  if not found then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'ACKNOWLEDGEMENT_NOT_FOUND');
  end if;
  if v_ack_message.conversation_id <> p_conversation_id then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'ACKNOWLEDGEMENT_WRONG_CONVERSATION');
  end if;
  if v_ack_message.direction <> 'INBOUND' or v_ack_message.sender_kind <> 'CONTACT' then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'ACKNOWLEDGEMENT_NOT_CUSTOMER_INBOUND');
  end if;
  if v_ack_message.content_hash <> p_acknowledgement_content_hash then
    -- The acknowledgement message's own stored hash must match exactly
    -- what the caller asserts — a stale/altered evidence reference is
    -- refused. This is deliberately a dedicated parameter, never read out
    -- of p_content: the canonical Travel Request payload must never carry
    -- provenance/evidence data mixed into trip content.
    return jsonb_build_object('status', 'denied', 'reasonCode', 'STALE_ACKNOWLEDGEMENT_EVIDENCE');
  end if;

  -- 7. temporal ordering: uses the ACKNOWLEDGEMENT MESSAGE's own
  --    provider_occurred_at (Meta's real timestamp for that exact
  --    message), never message.created_at (webhook-ingestion/server
  --    time) and never conversation.last_inbound_at (conversation-level,
  --    cannot bind to one specific message). Missing/null
  --    provider_occurred_at fails closed rather than falling back to a
  --    weaker timestamp.
  if v_ack_message.provider_occurred_at is null then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'ACKNOWLEDGEMENT_MISSING_PROVIDER_TIMESTAMP');
  end if;
  if v_ack_message.provider_occurred_at <= v_confirmation_message.sent_at then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'ACKNOWLEDGEMENT_BEFORE_CONFIRMATION');
  end if;

  -- Section 3: disclosure_version is validated against a known, closed
  -- set of real published confirmation-copy versions — never accepted as
  -- an arbitrary caller-supplied string. Extend this list only when a new
  -- confirmation-copy version is genuinely published.
  if p_disclosure_version not in ('E2A_AZ_V1', 'E2A_RU_V1', 'E2A_EN_V1') then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'UNKNOWN_DISCLOSURE_VERSION');
  end if;

  -- 6. no conflicting existing conversion for this exact conversation +
  --    acknowledgement message pair (distinct from the idempotency-key
  --    replay check above, which only catches an identical retry — this
  --    catches a DIFFERENT idempotency key pointed at the same evidence).
  if exists (
    select 1 from public.intent_channel_provenance
    where source_conversation_id = p_conversation_id
      and acknowledgement_message_id = p_acknowledgement_message_id
  ) then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'ALREADY_CONVERTED');
  end if;

  -- 7. structured content validation — reuses the exact same canonical
  --    Travel Request validator the Wizard's own submit path uses, with
  --    require_acknowledgement = true (this is, by definition, a
  --    submission-grade conversion, not a draft).
  if not private.is_valid_travel_request_content(p_content, true) then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_TRAVEL_REQUEST');
  end if;

  -- 8. atomic creation: travel_requests -> travel_request_versions ->
  --    intents -> intent_channel_provenance -> receipt. Any failure from
  --    here rolls the whole transaction back (this function runs inside
  --    the caller's implicit transaction; a plpgsql exception propagates
  --    and the whole statement is rolled back by Postgres).
  v_request_id := gen_random_uuid();
  insert into public.travel_requests (id, customer_id, status, current_version, created_at, updated_at)
  values (v_request_id, v_customer_id, 'DRAFT', 1, now(), now());

  insert into public.travel_request_versions (
    travel_request_id, version_number, customer_id, locale, canonical_payload, payload_hash, created_by, created_at
  ) values (
    v_request_id, 1, v_customer_id, p_content->>'locale', p_content, p_content_hash, p_actor_id, now()
  );

  v_intent_id := gen_random_uuid();
  insert into public.intents (
    id, customer_id, travel_request_id, travel_request_version_number, travel_request_payload_hash,
    source, locale, status, created_at, updated_at
  ) values (
    v_intent_id, v_customer_id, v_request_id, 1, p_content_hash,
    'WHATSAPP', p_content->>'locale', 'unresolved', now(), now()
  );

  insert into public.intent_channel_provenance (
    intent_id, source_conversation_id, confirmation_request_message_id, acknowledgement_message_id,
    acknowledgement_content_hash, disclosure_version, converted_by_staff_id, customer_id,
    customer_facing_brand, correlation_id, created_at
  ) values (
    v_intent_id, p_conversation_id, p_confirmation_request_message_id, p_acknowledgement_message_id,
    v_ack_message.content_hash, p_disclosure_version, p_actor_id, v_customer_id,
    v_conversation.customer_facing_brand, p_correlation_id, now()
  );

  v_result := jsonb_build_object(
    'status', 'accepted',
    'travelRequestId', v_request_id,
    'versionNumber', 1,
    'payloadHash', p_content_hash,
    'intentId', v_intent_id
  );

  insert into public.whatsapp_conversion_command_receipts (
    idempotency_key, command_id, actor_id, payload_hash, response, created_at, expires_at
  ) values (
    p_idempotency_key, p_command_id, p_actor_id, p_idempotency_payload_hash, v_result, now(), now() + interval '30 days'
  );

  return v_result;
end;
$$;

revoke all on function public.execute_whatsapp_conversion_command(
  uuid, text, uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, text, jsonb, text, text, text
) from public;
revoke all on function public.execute_whatsapp_conversion_command(
  uuid, text, uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, text, jsonb, text, text, text
) from anon;
revoke all on function public.execute_whatsapp_conversion_command(
  uuid, text, uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, text, jsonb, text, text, text
) from authenticated;
grant execute on function public.execute_whatsapp_conversion_command(
  uuid, text, uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, text, jsonb, text, text, text
) to service_role;
