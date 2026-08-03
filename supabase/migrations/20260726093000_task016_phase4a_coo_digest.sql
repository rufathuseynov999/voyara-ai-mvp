-- Phase 4A (COO Agent scope) — read-only Daily Digest and recommendation
-- capability. Additive only; no change to any existing table or policy.
--
-- Founder decision, verbatim: the COO agent stays in scope only as a
-- read-only Daily Digest and recommendation agent. It may summarize
-- operations, identify risks, rank priorities and propose actions. It must
-- NEVER approve prices, send customer messages, execute payments, create
-- bookings, cancel services, issue refunds, or modify authoritative records.
-- Every proposed operational action requires human approval.
--
-- This is enforced structurally, not just by convention:
--   - `coo_digests` has no FK relationship to any channel, payment, or
--     booking table that a write could cascade into;
--   - there is no `sent_at` / `executed_at` / `confirmed_at` column of any
--     kind on this table — a digest cannot transition into an action, ever,
--     from this table alone;
--   - `proposed_actions` is a jsonb array whose application-level schema
--     (src/server/agents/coo-agent-contract.ts) restricts `actionKind` to a
--     closed enum of advisory-only values — the forbidden action kinds
--     (approve price, send message, execute payment, create booking, cancel
--     service, issue refund, modify record) are not members of that enum at
--     the type level, so they cannot even be constructed, let alone stored.

create table public.coo_digests (
  id uuid primary key,
  account_id uuid not null,
  generated_at timestamptz not null,
  summary text not null,
  risks jsonb not null default '[]'::jsonb,
  priorities jsonb not null default '[]'::jsonb,
  proposed_actions jsonb not null default '[]'::jsonb,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create index coo_digests_account_idx on public.coo_digests (account_id, generated_at desc);

alter table public.coo_digests enable row level security;
alter table public.coo_digests force row level security;

create policy coo_digests_select_aal2_staff on public.coo_digests
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
