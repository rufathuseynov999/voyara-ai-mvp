-- Phase 3A — Supplier search, quote revalidation, payment & booking-preparation
-- foundation. Additive only: no existing table, policy, function or type is
-- modified or dropped. All customer-owned tables enforce RLS with the same
-- owner-or-AAL2-staff pattern used across the repository, so one customer can
-- never read another customer's quotes, payments or booking preparations.

-- ------------------------------------------------------------------ --
-- Enumerated domains (kept in sync with the TypeScript contracts).
-- ------------------------------------------------------------------ --
create type public.supplier_integration_mode as enum ('SIMULATION', 'SANDBOX', 'LIVE');
create type public.commercial_source as enum ('SIMULATED', 'SANDBOX', 'LIVE', 'MANUAL');
create type public.supplier_operation as enum ('SEARCH', 'AVAILABILITY', 'REVALIDATION', 'BOOKING_PREPARATION');
create type public.quote_status as enum (
  'DRAFT', 'SEARCHED', 'NORMALIZED', 'PREPARED', 'PENDING_HUMAN_REVIEW',
  'APPROVED', 'PRESENTED', 'CUSTOMER_ACCEPTED', 'REVALIDATION_REQUIRED',
  'PAYMENT_PENDING', 'PAYMENT_DETECTED', 'PAYMENT_VERIFIED',
  'EXPIRED', 'REJECTED', 'PRICE_CHANGED', 'SUPPLIER_UNAVAILABLE',
  'PAYMENT_FAILED', 'PAYMENT_MISMATCH', 'CANCELLED'
);
create type public.payment_reconciliation_status as enum (
  'PENDING', 'MATCHED', 'PARTIAL', 'EXCESS', 'CURRENCY_MISMATCH', 'DUPLICATE',
  'MISSING_REFERENCE', 'STATUS_DISAGREEMENT', 'WRONG_QUOTE', 'AFTER_EXPIRY'
);

-- ------------------------------------------------------------------ --
-- Supplier requests & responses (audit of every adapter interaction).
-- Staff-only surfaces; not customer-owned, so restricted to AAL2 staff.
-- ------------------------------------------------------------------ --
create table public.supplier_requests (
  id uuid primary key default gen_random_uuid(),
  operation public.supplier_operation not null,
  mode public.supplier_integration_mode not null,
  supplier_id text not null,
  correlation_id text not null,
  actor_id uuid not null,
  requested_at timestamptz not null default now()
);

create table public.supplier_responses (
  id uuid primary key default gen_random_uuid(),
  supplier_request_id uuid not null references public.supplier_requests (id),
  ok boolean not null,
  error_kind text,
  supplier_trace_id text,
  source public.commercial_source not null,
  simulated boolean not null,
  received_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ --
-- Quotes, immutable versions, normalized offers, revalidation evidence.
-- Customer-owned (customer_id) with tenant ownership (account_id).
-- ------------------------------------------------------------------ --
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  customer_id uuid not null,
  status public.quote_status not null default 'DRAFT',
  supplier_offer_reference text not null,
  source public.commercial_source not null,
  correlation_id text not null,
  current_version_number integer not null default 1,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_revalidated_at timestamptz
);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id),
  account_id uuid not null,
  customer_id uuid not null,
  version_number integer not null,
  content_hash text not null,
  material jsonb not null,
  approval_reference uuid,
  approval_invalidated boolean not null default false,
  previous_version_number integer,
  superseded_reason text,
  created_at timestamptz not null default now(),
  unique (quote_id, version_number)
);

create table public.normalized_offers (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.quotes (id),
  account_id uuid not null,
  customer_id uuid not null,
  supplier_id text not null,
  supplier_property_id text not null,
  internal_property_id uuid,
  content_hash text not null,
  source public.commercial_source not null,
  simulated boolean not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.offer_revalidations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id),
  account_id uuid not null,
  customer_id uuid not null,
  outcome text not null,
  changed_fields text[] not null default '{}',
  correlation_id text not null,
  revalidated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ --
-- Payment intents, events, webhook receipts, reconciliation results.
-- ------------------------------------------------------------------ --
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id),
  account_id uuid not null,
  customer_id uuid not null,
  intent_reference text not null,
  expected_amount_minor bigint not null,
  currency text not null,
  detected_status text not null default 'NONE',
  verified_status text not null default 'UNVERIFIED',
  source public.commercial_source not null,
  simulated boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id),
  account_id uuid not null,
  customer_id uuid not null,
  event_type text not null,
  correlation_id text not null,
  occurred_at timestamptz not null default now()
);

-- Webhook receipts are immutable and staff/system scoped (no customer read).
create table public.payment_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  accepted boolean not null,
  reason_code text not null,
  correlation_id text not null,
  received_at timestamptz not null default now()
);

create table public.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id),
  account_id uuid not null,
  customer_id uuid not null,
  status public.payment_reconciliation_status not null,
  verified boolean not null default false,
  requires_human_review boolean not null default true,
  reason_code text not null,
  reconciled_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ --
-- Booking preparations & commercial exceptions.
-- Preparation is never confirmation; requires_human_verification stays true.
-- ------------------------------------------------------------------ --
create table public.booking_preparations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id),
  account_id uuid not null,
  customer_id uuid not null,
  approved_version_number integer not null,
  approved_content_hash text not null,
  hag_approval_reference uuid not null,
  source public.commercial_source not null,
  simulated boolean not null,
  requires_human_verification boolean not null default true,
  correlation_id text not null,
  prepared_at timestamptz not null default now()
);

create table public.commercial_exceptions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.quotes (id),
  account_id uuid not null,
  customer_id uuid,
  kind text not null,
  reason_code text not null,
  resolved boolean not null default false,
  resolved_by uuid,
  correlation_id text not null,
  raised_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ --
-- Row Level Security.
-- ------------------------------------------------------------------ --
alter table public.supplier_requests enable row level security;
alter table public.supplier_requests force row level security;
alter table public.supplier_responses enable row level security;
alter table public.supplier_responses force row level security;
alter table public.quotes enable row level security;
alter table public.quotes force row level security;
alter table public.quote_versions enable row level security;
alter table public.quote_versions force row level security;
alter table public.normalized_offers enable row level security;
alter table public.normalized_offers force row level security;
alter table public.offer_revalidations enable row level security;
alter table public.offer_revalidations force row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_intents force row level security;
alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;
alter table public.payment_webhook_receipts enable row level security;
alter table public.payment_webhook_receipts force row level security;
alter table public.payment_reconciliations enable row level security;
alter table public.payment_reconciliations force row level security;
alter table public.booking_preparations enable row level security;
alter table public.booking_preparations force row level security;
alter table public.commercial_exceptions enable row level security;
alter table public.commercial_exceptions force row level security;

-- Customer-owned tables: owner OR AAL2 staff may read. No customer may read
-- another customer's rows (owner check is on customer_id = auth.uid()).
create policy quotes_select_owner_or_aal2_staff on public.quotes
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy quote_versions_select_owner_or_aal2_staff on public.quote_versions
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy normalized_offers_select_owner_or_aal2_staff on public.normalized_offers
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy offer_revalidations_select_owner_or_aal2_staff on public.offer_revalidations
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy payment_intents_select_owner_or_aal2_staff on public.payment_intents
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy payment_events_select_owner_or_aal2_staff on public.payment_events
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy payment_reconciliations_select_owner_or_aal2_staff on public.payment_reconciliations
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy booking_preparations_select_owner_or_aal2_staff on public.booking_preparations
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

create policy commercial_exceptions_select_owner_or_aal2_staff on public.commercial_exceptions
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

-- Staff/system-only tables (no customer ownership column): AAL2 staff read only.
create policy supplier_requests_select_aal2_staff on public.supplier_requests
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'finance', 'admin', 'founder')
      and active
  )
);

create policy supplier_responses_select_aal2_staff on public.supplier_responses
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'finance', 'admin', 'founder')
      and active
  )
);

create policy payment_webhook_receipts_select_aal2_staff on public.payment_webhook_receipts
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('finance', 'admin', 'founder')
      and active
  )
);
