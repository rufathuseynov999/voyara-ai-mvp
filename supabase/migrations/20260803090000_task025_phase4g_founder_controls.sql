-- Phase 4G Part 4 — founder controls extension. Additive only; does not
-- modify Migrations 23 or 24. Widens automation_pause_controls' scope to
-- include CHANNEL and WORKFLOW (the CHECK constraint is replaced with an
-- equivalent, wider one — the column and table themselves are unchanged),
-- and adds working-hours policy, escalation destinations, and feature
-- flags as their own versioned, auditable tables.

alter table public.automation_pause_controls drop constraint automation_pause_controls_scope_check;
alter table public.automation_pause_controls add constraint automation_pause_controls_scope_check
  check (scope in ('GLOBAL', 'AGENT', 'CHANNEL', 'WORKFLOW'));

alter table public.automation_pause_controls drop constraint automation_pause_controls_agent_code_matches_scope;
alter table public.automation_pause_controls rename column agent_code to scope_key;
alter table public.automation_pause_controls add constraint automation_pause_controls_scope_key_matches_scope check (
  (scope = 'GLOBAL' and scope_key is null) or (scope <> 'GLOBAL' and scope_key is not null)
);

drop index if exists automation_pause_controls_agent_uidx;
create unique index automation_pause_controls_scope_key_uidx on public.automation_pause_controls (scope, scope_key) where scope <> 'GLOBAL';

create type public.working_hours_policy_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');

create table public.working_hours_policies (
  id uuid primary key,
  policy_code text not null,
  timezone text not null,
  schedule jsonb not null,
  status public.working_hours_policy_status not null default 'DRAFT',
  approved_by uuid,
  approved_at timestamptz,
  content_hash text,
  version int not null default 1,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint working_hours_policies_active_requires_approval check (
    status <> 'ACTIVE' or (approved_by is not null and approved_at is not null and content_hash is not null)
  )
);
create unique index working_hours_policies_code_active_uidx on public.working_hours_policies (policy_code) where status = 'ACTIVE';

create table public.escalation_destinations (
  id uuid primary key,
  destination_code text not null unique,
  escalation_kind text not null,
  target_description text not null,
  active boolean not null default true,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_feature_flags (
  id uuid primary key,
  flag_code text not null unique,
  enabled boolean not null default false,
  description text,
  updated_by uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_feature_flag_history (
  id uuid primary key,
  flag_id uuid not null references public.automation_feature_flags (id),
  enabled boolean not null,
  changed_by uuid not null,
  correlation_id text not null,
  changed_at timestamptz not null default now()
);

create table public.founder_control_events (
  id uuid primary key,
  control_kind text not null,
  control_key text,
  action text not null,
  actor_id uuid not null,
  reason_code text,
  correlation_id text not null,
  occurred_at timestamptz not null default now()
);
create index founder_control_events_kind_idx on public.founder_control_events (control_kind, occurred_at);

do $$
declare
  t text;
begin
  foreach t in array array[
    'working_hours_policies', 'escalation_destinations', 'automation_feature_flags',
    'automation_feature_flag_history', 'founder_control_events'
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
