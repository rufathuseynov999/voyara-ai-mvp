-- Phase 4H, Migration 27 — Instagram dual-brand adapter foundation.
--
-- Additive only. No existing table is dropped, recreated, or has a column
-- removed. Mirrors migration 18's WhatsApp shape exactly (one account row
-- per connected number/page, one webhook-receipt table for reserve-first
-- idempotency), because Instagram Messaging is the same Meta Graph API
-- platform WhatsApp Cloud API is built on — same webhook delivery model,
-- same X-Hub-Signature-256 scheme, same at-least-once retry behaviour.
--
-- Applies migration 26's lesson directly: `instagram_webhook_receipts` has
-- no foreign key to any row created after it (same as
-- `whatsapp_webhook_receipts`) — its own PRIMARY KEY on `id` plus the
-- `unique (event_id)` constraint is what actually provides the
-- reserve-first concurrency guarantee, so this migration does not
-- reintroduce the ordering defect migration 26 fixed.
--
-- Brand isolation: `public.customer_facing_brand` ('RTRAVEL' | 'VOYARA')
-- already exists (migration 17) and is reused unchanged — a
-- `unique (brand)` constraint on `instagram_accounts` means at most one
-- connected Instagram account per brand can exist, structurally preventing
-- a caller from ever pointing both brands at the same account, and the
-- separate `unique (instagram_account_id)` / `unique (page_id)`
-- constraints prevent the same Meta account or Page being claimed by both
-- brand rows even under a race.

-- ============================================================================
-- 1. Instagram accounts — one row per connected brand (R-Travel, VOYARA)
-- ============================================================================

-- No secret lives in this table: the long-lived Page access token, the Meta
-- app secret, and the webhook verification token stay in environment
-- variables (see the Phase 4H activation runbook), exactly like every other
-- credential in this project. This table only stores the non-secret
-- identifiers needed to route an inbound webhook event to the correct
-- brand and to reject an event that claims an unknown account/page.
create table public.instagram_accounts (
  id uuid primary key,
  brand public.customer_facing_brand not null,
  instagram_account_id text not null,
  page_id text not null,
  display_username text not null,
  is_test_account boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (brand),
  unique (instagram_account_id),
  unique (page_id)
);

-- Reserve-first idempotency for inbound webhook deliveries. Meta retries
-- delivery on anything short of a fast 2xx response, so the SAME event can
-- arrive more than once — `unique (event_id)` is the actual concurrency
-- guarantee (see migration 26's note above); `accepted`/`reason_code`
-- record why an event was or was not processed, for audit, without ever
-- deleting or overwriting a prior receipt row (append-only).
create table public.instagram_webhook_receipts (
  id uuid primary key,
  event_id text not null unique,
  instagram_account_id text,
  page_id text,
  event_type text not null,
  accepted boolean not null,
  reason_code text,
  correlation_id text not null,
  received_at timestamptz not null default now()
);

-- Append-only enforcement at the database level, not just by application
-- convention. WhatsApp's equivalent table (migration 18) relies on
-- application discipline alone; Instagram's inbound events additionally
-- double as the audit trail proving what a webhook delivery actually
-- contained, so this migration goes further and makes rewriting or
-- deleting a receipt impossible for ANY role, including service_role —
-- exactly the same mechanism migration 11 already established for
-- membership/CRM/administration evidence records, applied here to
-- Instagram's inbound audit trail.
create or replace function private.reject_instagram_evidence_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception 'Instagram webhook receipt is append-only' using errcode = '55000';
end;
$$;

create trigger instagram_webhook_receipts_immutable before update or delete on public.instagram_webhook_receipts
for each row execute function private.reject_instagram_evidence_mutation();

-- ============================================================================
-- RLS: forced on every new table. AAL2 staff read; no direct authenticated
-- write policy anywhere (service-role store only) — identical discipline to
-- every prior migration, including migration 18's WhatsApp tables. An
-- anonymous (unauthenticated) role has no policy at all on either table, so
-- `force row level security` denies it by default — proven in the sandbox
-- test suite alongside the AAL2 staff-read policies below.
-- ============================================================================

alter table public.instagram_accounts enable row level security;
alter table public.instagram_accounts force row level security;
create policy instagram_accounts_select_aal2_staff on public.instagram_accounts
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.instagram_webhook_receipts enable row level security;
alter table public.instagram_webhook_receipts force row level security;
create policy instagram_webhook_receipts_select_aal2_staff on public.instagram_webhook_receipts
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);
