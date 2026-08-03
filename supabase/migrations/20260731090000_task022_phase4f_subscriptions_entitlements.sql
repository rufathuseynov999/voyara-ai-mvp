-- Phase 4F — subscriptions, membership entitlements, and recurring billing.
-- Additive only. Extends the existing CRM/contacts/payment-link/approval/
-- RLS/audit architecture unchanged — no existing table, column, policy, or
-- function is dropped or altered destructively.
--
-- R-Travel remains the legal merchant until founder configuration and
-- merchant contracts change it. Nothing in this schema executes a payment,
-- activates a subscription, or issues a refund by itself — every table here
-- is a RECORD of a human-approved plan or a reconciled payment event, never
-- an authority the AI holds itself.

-- ============================================================================
-- 1. Plan authority and versioning
-- ============================================================================

create type public.plan_type as enum ('PERSONAL', 'CORPORATE');
create type public.billing_cycle as enum ('MONTHLY', 'ANNUAL');
create type public.plan_version_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');

-- Locked plan codes only — the founder's approved catalog. This is a CHECK,
-- not a free-text column, so a plan row can never silently introduce a code
-- outside the approved set.
create type public.plan_code as enum (
  'PERSONAL_SMART', 'PERSONAL_PLUS', 'PERSONAL_PREMIUM', 'PERSONAL_BLACK',
  'CORPORATE_STARTER', 'CORPORATE_STANDARD', 'CORPORATE_PROFESSIONAL', 'CORPORATE_ENTERPRISE'
);

-- The current, authoritative row per plan+cycle. Approval-by-content-hash,
-- identical discipline to contracts (Phase 4E) and message_send_policies
-- (Phase 4C): a plan can only grant entitlements once it is genuinely
-- ACTIVE, and ACTIVE always requires a real human approver and a matching
-- content hash.
create table public.plan_versions (
  id uuid primary key,
  plan_code public.plan_code not null,
  plan_type public.plan_type not null,
  billing_cycle public.billing_cycle not null,
  price_minor_units bigint not null,
  currency text not null default 'AZN',
  benefits jsonb not null default '[]'::jsonb,
  usage_limits jsonb not null default '{}'::jsonb,
  service_privileges jsonb not null default '[]'::jsonb,
  concierge_level text,
  seat_or_traveller_limit int,
  activation_date date,
  retirement_date date,
  status public.plan_version_status not null default 'DRAFT',
  approved_by uuid,
  approved_at timestamptz,
  content_hash text,
  version int not null default 1,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_versions_active_requires_approval check (
    status <> 'ACTIVE' or (approved_by is not null and approved_at is not null and content_hash is not null)
  ),
  -- Enterprise pricing/benefits must remain unpublished until
  -- founder-approved — structurally, an Enterprise plan can never be ACTIVE
  -- with a non-null public price; it is priced via a custom contract
  -- reference on the corporate account instead (see corporate_accounts).
  constraint plan_versions_enterprise_never_public_priced check (
    plan_code <> 'CORPORATE_ENTERPRISE' or status <> 'ACTIVE' or price_minor_units = 0
  )
);
create unique index plan_versions_code_cycle_active_uidx on public.plan_versions (plan_code, billing_cycle) where status = 'ACTIVE';
create index plan_versions_status_idx on public.plan_versions (status);

-- Append-only immutable version history, identical discipline to
-- contract_versions.
create table public.plan_version_history (
  id uuid primary key,
  plan_version_id uuid not null references public.plan_versions (id),
  version int not null,
  content_hash text not null,
  snapshot jsonb not null,
  created_by uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (plan_version_id, version)
);

-- ============================================================================
-- 2. Corporate accounts (needed before subscriptions, which may reference one)
-- ============================================================================

create table public.corporate_accounts (
  id uuid primary key,
  legal_entity_name text not null,
  billing_contact jsonb not null default '{}'::jsonb,
  account_owner_contact_id uuid not null references public.contacts (id),
  plan_version_id uuid references public.plan_versions (id),
  authorized_user_limit int,
  enterprise_contract_reference text,
  suspended boolean not null default false,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.corporate_seats (
  id uuid primary key,
  corporate_account_id uuid not null references public.corporate_accounts (id),
  traveller_contact_id uuid not null references public.contacts (id),
  role text not null default 'TRAVELLER',
  active boolean not null default true,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (corporate_account_id, traveller_contact_id)
);

-- ============================================================================
-- 3. Subscription lifecycle
-- ============================================================================

create type public.subscription_status as enum (
  'TRIAL', 'PENDING_PAYMENT', 'ACTIVE', 'GRACE_PERIOD', 'PAYMENT_FAILED', 'PAUSED',
  'CANCELLED', 'EXPIRED', 'SUSPENDED', 'SCHEDULED_UPGRADE', 'SCHEDULED_DOWNGRADE', 'RENEWAL_PENDING'
);

create table public.subscriptions (
  id uuid primary key,
  contact_id uuid references public.contacts (id),
  corporate_account_id uuid references public.corporate_accounts (id),
  plan_version_id uuid not null references public.plan_versions (id),
  scheduled_plan_version_id uuid references public.plan_versions (id),
  status public.subscription_status not null default 'PENDING_PAYMENT',
  billing_cycle public.billing_cycle not null,
  start_date date,
  current_period_end date,
  next_payment_date date,
  cancel_at_period_end boolean not null default false,
  grace_period_ends_at timestamptz,
  human_override_reason text,
  human_override_by uuid,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_exactly_one_owner check (
    (contact_id is not null and corporate_account_id is null) or (contact_id is null and corporate_account_id is not null)
  )
);
create index subscriptions_contact_idx on public.subscriptions (contact_id);
create index subscriptions_corporate_idx on public.subscriptions (corporate_account_id);
create index subscriptions_status_idx on public.subscriptions (status);
create unique index subscriptions_one_active_per_contact_uidx on public.subscriptions (contact_id) where status = 'ACTIVE' and contact_id is not null;

create table public.subscription_events (
  id uuid primary key,
  subscription_id uuid not null references public.subscriptions (id),
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  occurred_at timestamptz not null default now()
);
create index subscription_events_subscription_idx on public.subscription_events (subscription_id, occurred_at);

-- ============================================================================
-- 4. Entitlement engine
-- ============================================================================

create table public.entitlement_grants (
  id uuid primary key,
  subscription_id uuid not null references public.subscriptions (id),
  plan_version_id uuid not null references public.plan_versions (id),
  benefits_snapshot jsonb not null,
  usage_limits_snapshot jsonb not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  correlation_id text not null
);
create index entitlement_grants_subscription_idx on public.entitlement_grants (subscription_id);

create table public.entitlement_usage (
  id uuid primary key,
  subscription_id uuid not null references public.subscriptions (id),
  usage_key text not null,
  used_amount numeric not null default 0,
  period_start date not null,
  period_end date not null,
  correlation_id text not null,
  updated_at timestamptz not null default now(),
  unique (subscription_id, usage_key, period_start)
);

-- ============================================================================
-- 5. Recurring payments — provider-neutral, tokenized only
-- ============================================================================

create type public.recurring_payment_transaction_type as enum (
  'INITIAL_PAYMENT', 'RENEWAL', 'UPGRADE', 'DOWNGRADE_ADJUSTMENT', 'FAILED_PAYMENT_RETRY',
  'CORPORATE_SUBSCRIPTION', 'AUTHORISED_BALANCE_PAYMENT'
);

create table public.recurring_payment_tokens (
  id uuid primary key,
  contact_id uuid references public.contacts (id),
  corporate_account_id uuid references public.corporate_accounts (id),
  provider_token_reference text not null,
  masked_display text,
  status text not null default 'ACTIVE',
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint recurring_payment_tokens_no_raw_card_number check (
    provider_token_reference !~ '\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}'
  ),
  constraint recurring_payment_tokens_no_cvv_shaped_value check (
    provider_token_reference !~* 'cvv|cvc'
  ),
  constraint recurring_payment_tokens_exactly_one_owner check (
    (contact_id is not null and corporate_account_id is null) or (contact_id is null and corporate_account_id is not null)
  )
);

create table public.renewal_events (
  id uuid primary key,
  event_id text not null unique,
  subscription_id uuid references public.subscriptions (id),
  transaction_type public.recurring_payment_transaction_type not null,
  amount_minor_units bigint,
  currency text,
  plan_version_id uuid references public.plan_versions (id),
  accepted boolean not null,
  reason_code text,
  correlation_id text not null,
  received_at timestamptz not null default now()
);

-- ============================================================================
-- RLS: forced on every new table. AAL2 staff read; no direct authenticated
-- write policy anywhere (service-role store only) — identical discipline to
-- every prior migration in this project.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'plan_versions', 'plan_version_history', 'corporate_accounts', 'corporate_seats',
    'subscriptions', 'subscription_events', 'entitlement_grants', 'entitlement_usage',
    'recurring_payment_tokens', 'renewal_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      $policy$create policy %I_select_aal2_staff on public.%I
        for select to authenticated
        using (
          (select auth.jwt()->>'aal') = 'aal2'
          and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
        )$policy$,
      t, t
    );
  end loop;
end $$;
