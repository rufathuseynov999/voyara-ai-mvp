-- Phase 4G — durable automation foundation: workflow definitions/runs,
-- automation policies, dead-letter records, scheduled actions, pause
-- controls, and emergency-stop authority.
--
-- Additive only. Extends the existing agent-operating-layer, approval,
-- audit, and RLS architecture unchanged — no existing table, column,
-- policy, or function is dropped or altered destructively.
--
-- VOYARA is a single-business system (see business-account.ts) — there is
-- no multi-tenant concept to introduce here; "isolation" in this schema
-- means no cross-customer leakage of workflow-run data, the same
-- discipline already proven for every prior phase's RLS.
--
-- The central safety principle of this migration: a Level 2 action can
-- never be marked COMPLETED without a real human approver and content hash
-- (CHECK constraint, not just application logic), and a Level 3 action can
-- never be marked COMPLETED at all — the database itself refuses it,
-- structurally, regardless of what the application layer does or doesn't
-- check.

-- ============================================================================
-- 1. Workflow definitions and versioned, approved workflow graphs
-- ============================================================================

create type public.workflow_version_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');

create table public.workflow_definitions (
  id uuid primary key,
  workflow_code text not null unique,
  description text,
  correlation_id text not null,
  created_at timestamptz not null default now()
);

create table public.workflow_versions (
  id uuid primary key,
  workflow_definition_id uuid not null references public.workflow_definitions (id),
  version int not null default 1,
  step_graph jsonb not null,
  status public.workflow_version_status not null default 'DRAFT',
  approved_by uuid,
  approved_at timestamptz,
  content_hash text,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_versions_active_requires_approval check (
    status <> 'ACTIVE' or (approved_by is not null and approved_at is not null and content_hash is not null)
  )
);
create unique index workflow_versions_definition_active_uidx on public.workflow_versions (workflow_definition_id) where status = 'ACTIVE';
create index workflow_versions_status_idx on public.workflow_versions (status);

create table public.workflow_version_history (
  id uuid primary key,
  workflow_version_id uuid not null references public.workflow_versions (id),
  version int not null,
  content_hash text not null,
  snapshot jsonb not null,
  created_by uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (workflow_version_id, version)
);

-- ============================================================================
-- 2. Workflow runs and steps
-- ============================================================================

create type public.workflow_run_status as enum (
  'PENDING', 'RUNNING', 'PAUSED', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'
);
create type public.workflow_step_status as enum ('PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'SKIPPED');
create type public.workflow_action_level as enum ('LEVEL_1', 'LEVEL_2', 'LEVEL_3');

create table public.workflow_runs (
  id uuid primary key,
  workflow_version_id uuid not null references public.workflow_versions (id),
  subject_type text not null,
  subject_id uuid,
  status public.workflow_run_status not null default 'PENDING',
  current_step_index int not null default 0,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workflow_runs_version_idx on public.workflow_runs (workflow_version_id);
create index workflow_runs_status_idx on public.workflow_runs (status);
create index workflow_runs_subject_idx on public.workflow_runs (subject_type, subject_id);

create table public.workflow_steps (
  id uuid primary key,
  workflow_run_id uuid not null references public.workflow_runs (id),
  step_index int not null,
  step_code text not null,
  action_level public.workflow_action_level not null,
  status public.workflow_step_status not null default 'PENDING',
  approved_by uuid,
  approved_at timestamptz,
  approval_content_hash text,
  started_at timestamptz,
  completed_at timestamptz,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (workflow_run_id, step_index),
  constraint workflow_steps_level2_requires_approval_to_complete check (
    action_level <> 'LEVEL_2' or status <> 'COMPLETED' or (approved_by is not null and approved_at is not null and approval_content_hash is not null)
  ),
  constraint workflow_steps_level3_never_completes check (
    action_level <> 'LEVEL_3' or status <> 'COMPLETED'
  )
);
create index workflow_steps_run_idx on public.workflow_steps (workflow_run_id, step_index);
create index workflow_steps_status_idx on public.workflow_steps (status);

create table public.workflow_execution_events (
  id uuid primary key,
  workflow_run_id uuid not null references public.workflow_runs (id),
  workflow_step_id uuid references public.workflow_steps (id),
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  occurred_at timestamptz not null default now()
);
create index workflow_execution_events_run_idx on public.workflow_execution_events (workflow_run_id, occurred_at);

-- ============================================================================
-- 3. Automation policies (versioned, approval-by-hash — same discipline)
-- ============================================================================

create type public.automation_policy_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');

create table public.automation_policies (
  id uuid primary key,
  policy_code text not null,
  scope text not null,
  rules jsonb not null default '{}'::jsonb,
  status public.automation_policy_status not null default 'DRAFT',
  approved_by uuid,
  approved_at timestamptz,
  content_hash text,
  version int not null default 1,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_policies_active_requires_approval check (
    status <> 'ACTIVE' or (approved_by is not null and approved_at is not null and content_hash is not null)
  )
);
create unique index automation_policies_code_active_uidx on public.automation_policies (policy_code) where status = 'ACTIVE';

create table public.automation_policy_history (
  id uuid primary key,
  automation_policy_id uuid not null references public.automation_policies (id),
  version int not null,
  content_hash text not null,
  snapshot jsonb not null,
  created_by uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (automation_policy_id, version)
);

-- ============================================================================
-- 4. Dead-letter records and scheduled/delayed actions
-- ============================================================================

create table public.dead_letter_records (
  id uuid primary key,
  workflow_run_id uuid references public.workflow_runs (id),
  workflow_step_id uuid references public.workflow_steps (id),
  reason_code text not null,
  payload_snapshot jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_by uuid,
  resolved_at timestamptz,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint dead_letter_resolved_requires_resolver check (
    not resolved or (resolved_by is not null and resolved_at is not null)
  )
);
create index dead_letter_records_run_idx on public.dead_letter_records (workflow_run_id);
create index dead_letter_records_unresolved_idx on public.dead_letter_records (resolved) where not resolved;

create type public.scheduled_action_status as enum ('PENDING', 'EXECUTED', 'CANCELLED', 'FAILED');

create table public.scheduled_actions (
  id uuid primary key,
  action_code text not null,
  scheduled_for timestamptz not null,
  workflow_run_id uuid references public.workflow_runs (id),
  status public.scheduled_action_status not null default 'PENDING',
  executed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint scheduled_actions_cancelled_requires_actor check (
    status <> 'CANCELLED' or (cancelled_by is not null and cancelled_at is not null)
  )
);
create index scheduled_actions_pending_due_idx on public.scheduled_actions (scheduled_for) where status = 'PENDING';

-- ============================================================================
-- 5. Automation pause controls (global and per-agent)
-- ============================================================================

create table public.automation_pause_controls (
  id uuid primary key,
  scope text not null,
  agent_code text,
  paused boolean not null default false,
  paused_by uuid,
  paused_at timestamptz,
  reason text,
  resumed_by uuid,
  resumed_at timestamptz,
  correlation_id text not null,
  updated_at timestamptz not null default now(),
  constraint automation_pause_controls_scope_check check (scope in ('GLOBAL', 'AGENT')),
  constraint automation_pause_controls_agent_code_matches_scope check (
    (scope = 'GLOBAL' and agent_code is null) or (scope = 'AGENT' and agent_code is not null)
  ),
  constraint automation_pause_controls_paused_requires_actor check (
    not paused or (paused_by is not null and paused_at is not null)
  )
);
create unique index automation_pause_controls_global_uidx on public.automation_pause_controls ((true)) where scope = 'GLOBAL';
create unique index automation_pause_controls_agent_uidx on public.automation_pause_controls (agent_code) where scope = 'AGENT';

create table public.automation_pause_events (
  id uuid primary key,
  scope text not null,
  agent_code text,
  kind text not null,
  actor_id uuid not null,
  reason_code text,
  correlation_id text not null,
  occurred_at timestamptz not null default now()
);
create index automation_pause_events_scope_idx on public.automation_pause_events (scope, occurred_at);

-- ============================================================================
-- 6. Emergency-stop authority — current state (singleton) + append-only log
-- ============================================================================

create table public.emergency_stop_state (
  id smallint primary key,
  active boolean not null default false,
  activated_by uuid,
  activated_at timestamptz,
  reason text,
  correlation_id text not null,
  updated_at timestamptz not null default now(),
  constraint emergency_stop_state_singleton check (id = 1),
  constraint emergency_stop_state_active_requires_actor check (
    not active or (activated_by is not null and activated_at is not null)
  )
);
insert into public.emergency_stop_state (id, active, correlation_id) values (1, false, 'seed-emergency-stop-state');

create table public.emergency_stop_events (
  id uuid primary key,
  kind text not null,
  actor_id uuid not null,
  reason_code text,
  correlation_id text not null,
  occurred_at timestamptz not null default now(),
  constraint emergency_stop_events_kind_check check (kind in ('ACTIVATED', 'DEACTIVATED'))
);

-- ============================================================================
-- 7. Idempotent workflow-run creation
-- ============================================================================

create table public.workflow_idempotency_keys (
  idempotency_key text primary key,
  workflow_run_id uuid not null references public.workflow_runs (id),
  correlation_id text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- RLS: forced on every new table. AAL2 staff read; no direct authenticated
-- write policy anywhere (service-role store only) — identical discipline to
-- every prior migration in this project. No table in this migration has any
-- column shaped like a credential or secret.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'workflow_definitions', 'workflow_versions', 'workflow_version_history',
    'workflow_runs', 'workflow_steps', 'workflow_execution_events',
    'automation_policies', 'automation_policy_history',
    'dead_letter_records', 'scheduled_actions',
    'automation_pause_controls', 'automation_pause_events',
    'emergency_stop_state', 'emergency_stop_events',
    'workflow_idempotency_keys'
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
