-- Phase 4G Part 2 — durable workflow runtime state. Additive only; does not
-- modify Migration 23. Adds the persisted (not in-memory) state a durable
-- runtime needs: step leasing (so two workers can never execute the same
-- step concurrently), retry/backoff metadata, causation tracking, and a
-- transactional inbox for idempotent event consumption.

alter table public.workflow_steps
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column attempt_count int not null default 0,
  add column max_attempts int not null default 3,
  add column next_retry_at timestamptz,
  add column causation_id text,
  add column timeout_seconds int not null default 300;

alter table public.workflow_steps
  add constraint workflow_steps_lease_owner_requires_expiry check (
    (lease_owner is null and lease_expires_at is null) or (lease_owner is not null and lease_expires_at is not null)
  );

create index workflow_steps_lease_expiry_idx on public.workflow_steps (lease_expires_at) where lease_owner is not null;
create index workflow_steps_retry_due_idx on public.workflow_steps (next_retry_at) where status = 'FAILED' and next_retry_at is not null;

create table public.workflow_event_inbox (
  id uuid primary key,
  event_key text not null unique,
  workflow_run_id uuid references public.workflow_runs (id),
  event_kind text not null,
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  processed_at timestamptz,
  correlation_id text not null,
  causation_id text,
  received_at timestamptz not null default now(),
  constraint workflow_event_inbox_processed_requires_timestamp check (
    not processed or processed_at is not null
  )
);
create index workflow_event_inbox_run_idx on public.workflow_event_inbox (workflow_run_id);
create index workflow_event_inbox_unprocessed_idx on public.workflow_event_inbox (received_at) where not processed;

alter table public.workflow_event_inbox enable row level security;
alter table public.workflow_event_inbox force row level security;
create policy workflow_event_inbox_select_aal2_staff on public.workflow_event_inbox
  for select to authenticated
  using (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
  );
