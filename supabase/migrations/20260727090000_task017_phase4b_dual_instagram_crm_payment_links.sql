-- Phase 4B — dual Instagram accounts, unified CRM identity, payment-link
-- workflow. Additive only. No change to any existing table, column, policy,
-- or function from Phase 3A–3C or Phase 4A. Every new table forces RLS,
-- AAL2-staff-only read, service-role-only write — identical discipline to
-- every prior migration in this project.

-- ============================================================================
-- 1. Customer identity extensions
-- ============================================================================

create type public.identity_kind as enum (
  'INSTAGRAM_RTRAVEL', 'INSTAGRAM_VOYARA', 'WHATSAPP', 'TELEPHONE', 'EMAIL', 'WEBSITE_ACCOUNT'
);

create type public.identity_link_method as enum (
  'AUTO_VERIFIED_PHONE', 'AUTO_VERIFIED_EMAIL', 'AUTO_AUTHENTICATED_WEBSITE', 'HUMAN_CONFIRMED'
);

-- A linked identity ties one external identifier (an Instagram user id, a
-- phone number, an email, a website auth.users id) to exactly one contact.
-- Automatic linking is only ever recorded with method
-- AUTO_VERIFIED_PHONE / AUTO_VERIFIED_EMAIL / AUTO_AUTHENTICATED_WEBSITE —
-- application code (src/server/agents/identity-linking.ts) is the only thing
-- that can insert a HUMAN_CONFIRMED row, and only when the acting viewer is
-- AAL2. The unique constraint on (identity_kind, external_id) makes it
-- structurally impossible for one external identity to point at two
-- contacts at once — a re-link must go through explicit merge (below), never
-- a silent second insert.
create table public.linked_identities (
  id uuid primary key,
  contact_id uuid not null references public.contacts (id),
  identity_kind public.identity_kind not null,
  external_id text not null,
  verified boolean not null default false,
  linked_via public.identity_link_method not null,
  linked_by uuid,
  correlation_id text not null,
  linked_at timestamptz not null default now(),
  constraint linked_identities_human_confirmed_has_actor check (
    linked_via <> 'HUMAN_CONFIRMED' or linked_by is not null
  ),
  unique (identity_kind, external_id)
);

create index linked_identities_contact_idx on public.linked_identities (contact_id);

-- Every merge is an immutable, append-only record. A "reversal" is a NEW row
-- (reversed_at/reversed_by set on the ORIGINAL row, which is the only
-- mutation ever permitted on this table, and only by the service-role store)
-- pointing back — the merge history itself is never deleted or rewritten.
create table public.identity_merge_events (
  id uuid primary key,
  from_contact_id uuid not null,
  to_contact_id uuid not null,
  reason text not null,
  performed_by uuid not null,
  correlation_id text not null,
  performed_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid,
  constraint identity_merge_distinct_contacts check (from_contact_id <> to_contact_id)
);

create index identity_merge_events_to_contact_idx on public.identity_merge_events (to_contact_id);

-- ============================================================================
-- 2. Dual-account conversation/message extensions
-- ============================================================================

create type public.customer_facing_brand as enum ('RTRAVEL', 'VOYARA');
create type public.handover_status as enum ('AI', 'HUMAN');
create type public.delivery_status as enum ('PENDING', 'DELIVERED', 'FAILED', 'READ');

alter table public.conversations
  add column customer_facing_brand public.customer_facing_brand,
  add column external_conversation_id text,
  add column campaign_attribution text,
  add column assigned_owner_id uuid,
  add column handover_status public.handover_status not null default 'AI';

alter table public.messages
  add column external_message_id text,
  add column delivery_status public.delivery_status,
  add column webhook_status text;

-- ============================================================================
-- 3. Payment-link workflow
-- ============================================================================

create type public.payment_link_transaction_type as enum (
  'SUBSCRIPTION', 'HOTEL', 'TOUR_PACKAGE', 'AIR_TICKET', 'TRANSFER',
  'INSURANCE', 'VISA', 'CONCIERGE', 'BALANCE_PAYMENT'
);

create type public.payment_link_status as enum (
  'DRAFTED', 'APPROVED', 'LINK_CREATED', 'SENT', 'EXPIRED', 'CANCELLED', 'INVALIDATED', 'VERIFIED', 'MISMATCHED'
);

-- Every locked field the founder specified is its own column — not folded
-- into a jsonb blob — so each one is independently constrainable, indexable,
-- and auditable. `merchant_authority` defaults to the configured R-Travel
-- legal identity (read from the same integration config pattern as every
-- other merchant-facing value in this project — see
-- src/server/payment/payment-link-contract.ts) but is stored explicitly per
-- request so a later configuration change never silently rewrites history.
create table public.payment_link_requests (
  id uuid primary key,
  order_reference text not null unique,
  correlation_id text not null,
  contact_id uuid not null references public.contacts (id),
  originating_conversation_id uuid not null references public.conversations (id),
  originating_brand public.customer_facing_brand not null,
  proposal_version_id uuid,
  supplier_contract_reference text,
  service_description text not null,
  transaction_type public.payment_link_transaction_type not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  merchant_authority text not null,
  expires_at timestamptz not null,
  payment_purpose text not null,
  content_hash text not null,
  status public.payment_link_status not null default 'DRAFTED',
  approved_by uuid,
  approved_at timestamptz,
  hosted_url text,
  created_at timestamptz not null default now(),
  constraint payment_link_sent_requires_approval check (
    status not in ('LINK_CREATED', 'SENT') or (approved_by is not null and approved_at is not null)
  )
);

create index payment_link_requests_contact_idx on public.payment_link_requests (contact_id);
create index payment_link_requests_conversation_idx on public.payment_link_requests (originating_conversation_id);

-- Append-only audit journal, identical shape/discipline to
-- orchestration_audit_events and agent_audit_events.
create table public.payment_link_events (
  id uuid primary key,
  payment_link_id uuid not null references public.payment_link_requests (id),
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  content_hash text,
  occurred_at timestamptz not null default now()
);

create index payment_link_events_link_idx on public.payment_link_events (payment_link_id, occurred_at);

-- Idempotent webhook receipts, dedicated to payment links (kept separate
-- from Phase 3A's quote-bound payment_webhook_receipts, since a payment link
-- may back a subscription or another non-quote-bound transaction type).
-- Unique event_id gives the exact same real-23505 duplicate-webhook proof
-- already established for the quote-bound payment flow.
create table public.payment_link_webhook_receipts (
  id uuid primary key,
  event_id text not null unique,
  payment_link_id uuid references public.payment_link_requests (id),
  event_type text not null,
  accepted boolean not null,
  reason_code text,
  correlation_id text not null,
  received_at timestamptz not null default now()
);

-- ============================================================================
-- RLS: forced on every new/altered table. AAL2 staff read; no direct
-- authenticated write policy anywhere (service-role store only).
-- ============================================================================

alter table public.linked_identities enable row level security;
alter table public.linked_identities force row level security;
create policy linked_identities_select_aal2_staff on public.linked_identities
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.identity_merge_events enable row level security;
alter table public.identity_merge_events force row level security;
create policy identity_merge_events_select_aal2_staff on public.identity_merge_events
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.payment_link_requests enable row level security;
alter table public.payment_link_requests force row level security;
create policy payment_link_requests_select_aal2_staff on public.payment_link_requests
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.payment_link_events enable row level security;
alter table public.payment_link_events force row level security;
create policy payment_link_events_select_aal2_staff on public.payment_link_events
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.payment_link_webhook_receipts enable row level security;
alter table public.payment_link_webhook_receipts force row level security;
create policy payment_link_webhook_receipts_select_aal2_staff on public.payment_link_webhook_receipts
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);
