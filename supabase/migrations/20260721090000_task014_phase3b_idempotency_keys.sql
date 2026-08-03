-- Phase 3B Part 2 — durable idempotency keys for orchestration commands.
-- Additive only. A unique constraint on the key guarantees that concurrent
-- duplicate commands cannot create duplicate records: the second insert fails
-- and the caller returns the existing result. Staff/system scoped (no customer
-- reads needed); RLS enabled and forced like every other Phase 3A table.

create table public.orchestration_idempotency_keys (
  key text primary key,
  result_id text not null,
  account_id uuid not null,
  customer_id uuid not null,
  actor_id uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

alter table public.orchestration_idempotency_keys enable row level security;
alter table public.orchestration_idempotency_keys force row level security;

create policy orchestration_idempotency_select_aal2_staff on public.orchestration_idempotency_keys
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
