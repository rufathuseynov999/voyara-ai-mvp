-- Phase 4A — AI Agent Operating Layer + unified conversation/CRM model.
-- Additive only. No changes to any Phase 3A/3B/3C table, policy, or function.
--
-- Design mirrors the existing orchestration/payment pattern exactly:
--   - every table forces RLS;
--   - only a service-role store writes (no direct authenticated INSERT/UPDATE
--     policy exists anywhere here — matching "customers cannot write quotes
--     directly");
--   - AAL2 staff read (this is an internal CRM/agent inbox, not yet a
--     customer-facing conversation history feature);
--   - append-only audit journal, same shape as orchestration_audit_events;
--   - a durable idempotency table, same shape and guarantee as
--     orchestration_idempotency_keys (reserve-first, PRIMARY KEY decides
--     under real concurrency).
--
-- Nothing here sends a message, calls a channel provider, or executes an
-- agent action autonomously. `messages.status` can only reach 'SENT' through
-- application code that requires a human `approved_by` actor first — see
-- src/server/agents/agent-operating-layer.ts.

create type public.channel_kind as enum (
  'VOICE', 'WEB_CHAT', 'WHATSAPP', 'INSTAGRAM_DM', 'EMAIL', 'SIMULATION'
);

create type public.agent_role as enum (
  'sales', 'travel_planning', 'concierge', 'operations',
  'corporate', 'marketing', 'coo', 'human_staff'
);

create type public.conversation_status as enum (
  'OPEN', 'PENDING_HUMAN', 'RESOLVED', 'ESCALATED'
);

create type public.message_status as enum (
  'DRAFTED', 'APPROVED', 'REJECTED', 'SENT'
);

create type public.message_direction as enum ('INBOUND', 'OUTBOUND');
create type public.message_sender_kind as enum ('CONTACT', 'AI_AGENT', 'STAFF');

-- A contact is a person known through a channel, before or without being an
-- authenticated customer (e.g. someone messaging on WhatsApp who has never
-- signed in). `linked_customer_id` connects to a real auth.users row once
-- identity is established; it stays null otherwise. No FK to auth.users is
-- declared (mirrors role_assignments' own pattern) so a contact can exist
-- independently of any authentication event.
create table public.contacts (
  id uuid primary key,
  account_id uuid not null,
  linked_customer_id uuid,
  display_name text,
  phone text,
  email text,
  instagram_handle text,
  preferred_locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_account_idx on public.contacts (account_id);
create index contacts_linked_customer_idx on public.contacts (linked_customer_id) where linked_customer_id is not null;

create table public.conversations (
  id uuid primary key,
  account_id uuid not null,
  contact_id uuid not null references public.contacts (id),
  channel public.channel_kind not null,
  status public.conversation_status not null default 'OPEN',
  assigned_agent_role public.agent_role,
  related_quote_id uuid,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create index conversations_account_idx on public.conversations (account_id, status);
create index conversations_contact_idx on public.conversations (contact_id);

create table public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations (id),
  direction public.message_direction not null,
  sender_kind public.message_sender_kind not null,
  agent_role public.agent_role,
  body text not null,
  content_hash text not null,
  status public.message_status not null default 'DRAFTED',
  requires_human_approval boolean not null default true,
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint messages_sent_requires_approval check (
    status <> 'SENT' or (approved_by is not null and approved_at is not null)
  ),
  constraint messages_agent_drafts_require_approval check (
    sender_kind <> 'AI_AGENT' or requires_human_approval = true
  )
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.agent_idempotency_keys (
  key text primary key,
  result_id text not null,
  account_id uuid not null,
  actor_id uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create table public.agent_audit_events (
  id uuid primary key,
  conversation_id uuid,
  message_id uuid,
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  content_hash text,
  occurred_at timestamptz not null default now()
);

create index agent_audit_events_conversation_idx on public.agent_audit_events (conversation_id, occurred_at);

-- RLS: forced on every table. AAL2 staff read; no direct authenticated
-- write policy anywhere (service-role store only, matching every other
-- Phase 3 table). Append-only on the audit journal (select-only policy,
-- no update/delete policy exists).

alter table public.contacts enable row level security;
alter table public.contacts force row level security;
create policy contacts_select_aal2_staff on public.contacts
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

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
create policy conversations_select_aal2_staff on public.conversations
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

alter table public.messages enable row level security;
alter table public.messages force row level security;
create policy messages_select_aal2_staff on public.messages
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

alter table public.agent_idempotency_keys enable row level security;
alter table public.agent_idempotency_keys force row level security;
create policy agent_idempotency_select_aal2_staff on public.agent_idempotency_keys
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

alter table public.agent_audit_events enable row level security;
alter table public.agent_audit_events force row level security;
create policy agent_audit_select_aal2_staff on public.agent_audit_events
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
