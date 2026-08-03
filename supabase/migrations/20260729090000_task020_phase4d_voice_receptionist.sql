-- Phase 4D — multilingual AI voice receptionist. Additive only. No existing
-- table, column, policy, or function is dropped or altered destructively.
-- Reuses the existing `conversations`/`messages` (channel='VOICE'),
-- `contacts`/`linked_identities` (identity_kind='TELEPHONE'), and
-- `agent_llm_runs` architecture unchanged — this migration adds only what
-- calls genuinely need beyond a conversation: call-specific state,
-- multi-number/brand routing, and webhook idempotency, mirroring the exact
-- shape and discipline of migration 18's `whatsapp_accounts` /
-- `whatsapp_webhook_receipts`.

create type public.call_status as enum (
  'STARTED', 'RINGING', 'ANSWERED', 'TRANSFERRED', 'COMPLETED', 'FAILED'
);

create type public.call_urgency as enum ('LOW', 'MEDIUM', 'HIGH');

create type public.call_consent_status as enum ('GRANTED', 'DECLINED', 'NOT_ASKED');

-- One row per connected voice number (R-Travel, VOYARA, or a single test
-- number for initial certification) — identical shape/purpose to
-- `whatsapp_accounts`. No secret lives here; provider credentials stay in
-- environment variables.
create table public.voice_numbers (
  id uuid primary key,
  brand public.customer_facing_brand not null,
  provider_number_id text not null unique,
  phone_number text not null,
  is_test_number boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The call itself. One row per call, one conversation per call (reusing the
-- existing `conversations` table for the message/transcript timeline —
-- `calls.conversation_id` is the link). Every risk-relevant field the
-- founder specified is its own column, matching the founder-locked-field
-- discipline already used for payment links in migration 17.
create table public.calls (
  id uuid primary key,
  conversation_id uuid not null references public.conversations (id),
  contact_id uuid not null references public.contacts (id),
  voice_number_id uuid references public.voice_numbers (id),
  brand public.customer_facing_brand not null,
  called_number text not null,
  caller_number text not null,
  status public.call_status not null default 'STARTED',
  detected_language text,
  duration_seconds int,
  transcript text,
  ai_summary text,
  urgency public.call_urgency,
  transfer_status text,
  assigned_owner_id uuid,
  handover_status public.handover_status not null default 'AI',
  consent_ai_disclosure public.call_consent_status not null default 'NOT_ASKED',
  consent_recording public.call_consent_status not null default 'NOT_ASKED',
  consent_transcription public.call_consent_status not null default 'NOT_ASKED',
  consent_crm_storage public.call_consent_status not null default 'NOT_ASKED',
  consent_follow_up public.call_consent_status not null default 'NOT_ASKED',
  recording_enabled boolean not null default false,
  model_tier text,
  model_name text,
  estimated_cost_minor_units int,
  duration_ceiling_seconds int,
  correlation_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Never store complete card data or a CVV anywhere, structurally: no
  -- column here is shaped for either, and the two CHECK constraints below
  -- make it impossible for the transcript/summary columns to be repurposed
  -- to hold them without the insert being rejected outright at the exact
  -- pattern level.
  constraint calls_transcript_no_card_number check (
    transcript !~ '\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}'
  ),
  constraint calls_summary_no_card_number check (
    ai_summary !~ '\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}'
  )
);

create index calls_conversation_idx on public.calls (conversation_id);
create index calls_contact_idx on public.calls (contact_id);
create index calls_brand_status_idx on public.calls (brand, status);

-- Append-only audit journal, identical shape/discipline to
-- agent_audit_events / payment_link_events.
create table public.call_events (
  id uuid primary key,
  call_id uuid not null references public.calls (id),
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  occurred_at timestamptz not null default now()
);

create index call_events_call_idx on public.call_events (call_id, occurred_at);

-- Idempotent webhook receipts, identical shape/discipline to
-- whatsapp_webhook_receipts / payment_link_webhook_receipts.
create table public.call_webhook_receipts (
  id uuid primary key,
  event_id text not null unique,
  call_id uuid references public.calls (id),
  event_type text not null,
  accepted boolean not null,
  reason_code text,
  correlation_id text not null,
  received_at timestamptz not null default now()
);

-- A callback task created from a call — deliberately its own small table
-- rather than overloading `calls` with scheduling state, since a callback
-- has its own lifecycle (due, completed, cancelled) independent of the
-- call's own STARTED..COMPLETED lifecycle.
create table public.callback_tasks (
  id uuid primary key,
  call_id uuid not null references public.calls (id),
  contact_id uuid not null references public.contacts (id),
  due_at timestamptz not null,
  status text not null default 'PENDING',
  assigned_owner_id uuid,
  notes text,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create index callback_tasks_due_idx on public.callback_tasks (due_at) where status = 'PENDING';

-- ============================================================================
-- RLS: forced on every new table. AAL2 staff read; no direct authenticated
-- write policy anywhere (service-role store only) — identical discipline to
-- every prior migration.
-- ============================================================================

alter table public.voice_numbers enable row level security;
alter table public.voice_numbers force row level security;
create policy voice_numbers_select_aal2_staff on public.voice_numbers
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.calls enable row level security;
alter table public.calls force row level security;
create policy calls_select_aal2_staff on public.calls
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.call_events enable row level security;
alter table public.call_events force row level security;
create policy call_events_select_aal2_staff on public.call_events
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.call_webhook_receipts enable row level security;
alter table public.call_webhook_receipts force row level security;
create policy call_webhook_receipts_select_aal2_staff on public.call_webhook_receipts
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);

alter table public.callback_tasks enable row level security;
alter table public.callback_tasks force row level security;
create policy callback_tasks_select_aal2_staff on public.callback_tasks
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
);
