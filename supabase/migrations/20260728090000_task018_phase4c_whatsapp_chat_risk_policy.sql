-- Phase 4C — message risk classes + policy-gated auto-send, WhatsApp Cloud
-- API multi-account model, website chat sessions, LLM run audit. Additive
-- only. No existing table is dropped or recreated; the one existing
-- constraint that must change (`messages_sent_requires_approval`,
-- `messages_agent_drafts_require_approval` from migration 15) is DROPPED and
-- RECREATED here, widened with an OR-branch for policy-gated low-risk
-- auto-send — the human-approval branch is completely unchanged, so no
-- existing guarantee is weakened, only a second, narrower, independently
-- audited path is added alongside it.

-- ============================================================================
-- 1. Message risk classification + versioned, founder-approved send policy
-- ============================================================================

create type public.message_risk_class as enum ('LOW_RISK_INFORMATIONAL', 'HUMAN_APPROVAL_REQUIRED');

-- A versioned, founder-approved policy authorizing autonomous AI sending for
-- LOW_RISK_INFORMATIONAL messages only. `policy_hash` is the sha256 of the
-- policy's own content (allowed intents + knowledge version + model), so any
-- message that claims policy authorization can be checked against the exact
-- policy content that was active when it was sent — the same stale-hash
-- discipline used everywhere else in this project, applied to a policy
-- instead of a single quote/message.
create table public.message_send_policies (
  id uuid primary key,
  policy_name text not null,
  version int not null,
  policy_hash text not null,
  knowledge_version text not null,
  allowed_intents text[] not null,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  active boolean not null default true,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (policy_name, version)
);

create index message_send_policies_active_idx on public.message_send_policies (active) where active;

-- Extend messages with risk-classification + policy-authorization evidence.
-- Every column here is nullable because HUMAN_APPROVAL_REQUIRED messages
-- (the majority, and the only kind that existed before this migration) never
-- populate them — they continue to rely exclusively on
-- approved_by/approved_at, unchanged.
alter table public.messages
  add column risk_class public.message_risk_class not null default 'HUMAN_APPROVAL_REQUIRED',
  add column policy_id uuid references public.message_send_policies (id),
  add column policy_hash text,
  add column knowledge_version text,
  add column model text,
  add column agent_run_id uuid,
  add column message_type text not null default 'TEXT';

-- Safely widen the existing constraints: DROP + RECREATE under new names,
-- adding an OR-branch for policy-gated low-risk auto-send. The
-- human-approval branch is byte-for-byte the same condition that shipped in
-- migration 15 — nothing about it changed.
alter table public.messages drop constraint messages_sent_requires_approval;
alter table public.messages add constraint messages_sent_requires_approval_or_policy check (
  status <> 'SENT' or
  (approved_by is not null and approved_at is not null) or
  (
    risk_class = 'LOW_RISK_INFORMATIONAL'
    and policy_id is not null
    and policy_hash is not null
    and knowledge_version is not null
    and model is not null
    and agent_run_id is not null
  )
);

alter table public.messages drop constraint messages_agent_drafts_require_approval;
alter table public.messages add constraint messages_agent_drafts_require_approval_or_policy check (
  sender_kind <> 'AI_AGENT' or requires_human_approval = true or
  (
    risk_class = 'LOW_RISK_INFORMATIONAL'
    and policy_id is not null
    and policy_hash is not null
    and knowledge_version is not null
    and model is not null
    and agent_run_id is not null
  )
);

-- HUMAN_APPROVAL_REQUIRED can never carry policy authorization fields — this
-- prevents ever using a policy to bypass approval for a sensitive message,
-- structurally, not just by service-layer discipline.
alter table public.messages add constraint messages_sensitive_never_policy_authorized check (
  risk_class <> 'HUMAN_APPROVAL_REQUIRED' or policy_id is null
);

-- ============================================================================
-- 2. WhatsApp Cloud API — multi-account-ready
-- ============================================================================

-- One row per connected WhatsApp number (R-Travel, VOYARA, or a single Meta
-- test number for initial certification — all three fit this same shape).
-- No secret lives in this table: access tokens/app secrets stay in
-- environment variables (see the Phase 4C activation runbook), exactly like
-- every other credential in this project.
create table public.whatsapp_accounts (
  id uuid primary key,
  brand public.customer_facing_brand not null,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text not null,
  is_test_number boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.whatsapp_webhook_receipts (
  id uuid primary key,
  event_id text not null unique,
  phone_number_id text,
  event_type text not null,
  accepted boolean not null,
  reason_code text,
  correlation_id text not null,
  received_at timestamptz not null default now()
);

-- ============================================================================
-- 3. Website chat sessions
-- ============================================================================

-- An anonymous visitor session, upgradeable to an authenticated one once
-- linked. `session_token_hash` stores only a hash of the session token the
-- browser holds — never the raw token — mirroring how no other secret is
-- ever stored in this schema. `ip_hash` is a hash, not a raw IP, used only
-- for rate-limiting/abuse-prevention lookups.
create table public.chat_sessions (
  id uuid primary key,
  account_id uuid not null,
  contact_id uuid references public.contacts (id),
  conversation_id uuid not null references public.conversations (id),
  session_token_hash text not null unique,
  is_anonymous boolean not null default true,
  ip_hash text,
  preferred_locale text,
  consent_given_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create index chat_sessions_conversation_idx on public.chat_sessions (conversation_id);

-- ============================================================================
-- 4. LLM run audit + conversation SLA/service-window tracking
-- ============================================================================

create table public.agent_llm_runs (
  id uuid primary key,
  conversation_id uuid not null references public.conversations (id),
  message_id uuid references public.messages (id),
  model_tier text not null,
  model_name text not null,
  simulated boolean not null,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create index agent_llm_runs_conversation_idx on public.agent_llm_runs (conversation_id);

-- SLA due time and WhatsApp's 24h free-form service window both hang off the
-- same "when did the customer last write to us" fact — one column serves
-- both; the service layer computes the two different deadlines from it
-- rather than storing two redundant timestamps that could drift apart.
alter table public.conversations
  add column last_inbound_at timestamptz,
  add column last_read_at timestamptz;

-- ============================================================================
-- RLS: forced on every new table. AAL2 staff read; no direct authenticated
-- write policy anywhere (service-role store only) — identical discipline to
-- every prior migration.
-- ============================================================================

alter table public.message_send_policies enable row level security;
alter table public.message_send_policies force row level security;
create policy message_send_policies_select_aal2_staff on public.message_send_policies
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.whatsapp_accounts enable row level security;
alter table public.whatsapp_accounts force row level security;
create policy whatsapp_accounts_select_aal2_staff on public.whatsapp_accounts
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.whatsapp_webhook_receipts enable row level security;
alter table public.whatsapp_webhook_receipts force row level security;
create policy whatsapp_webhook_receipts_select_aal2_staff on public.whatsapp_webhook_receipts
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.chat_sessions enable row level security;
alter table public.chat_sessions force row level security;
create policy chat_sessions_select_aal2_staff on public.chat_sessions
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.agent_llm_runs enable row level security;
alter table public.agent_llm_runs force row level security;
create policy agent_llm_runs_select_aal2_staff on public.agent_llm_runs
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);
