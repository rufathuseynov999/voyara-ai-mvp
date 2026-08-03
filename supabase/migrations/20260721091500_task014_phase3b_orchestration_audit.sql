-- Phase 3B Part 2 — dedicated orchestration audit journal.
-- Additive only. Immutable append-only audit records for every authoritative
-- orchestration transition (quote lifecycle, payment, booking preparation).
-- AAL2-staff read; no update/delete policies exist (append-only by policy).

create table public.orchestration_audit_events (
  id uuid primary key,
  quote_id uuid not null,
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  content_hash text,
  occurred_at timestamptz not null default now()
);

create index orchestration_audit_events_quote_idx
  on public.orchestration_audit_events (quote_id, occurred_at);

alter table public.orchestration_audit_events enable row level security;
alter table public.orchestration_audit_events force row level security;

create policy orchestration_audit_select_aal2_staff on public.orchestration_audit_events
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
