-- VOYARA AI Task 002: minimal identity, Role and immutable command foundation.
-- This migration intentionally does not implement Travel Request or commercial tables.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'az',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length_check
    check (display_name is null or char_length(display_name) between 1 and 120),
  constraint profiles_locale_check check (locale in ('az', 'ru', 'en'))
);

create table public.role_assignments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  assigned_by uuid references auth.users (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint role_assignments_role_check
    check (role in ('customer', 'staff', 'manager', 'finance', 'admin', 'founder')),
  constraint role_assignments_active_state_check
    check ((active and revoked_at is null) or (not active and revoked_at is not null))
);

create unique index role_assignments_user_role_active_uidx
  on public.role_assignments (user_id, role)
  where active;

create index role_assignments_assigned_by_idx
  on public.role_assignments (assigned_by)
  where assigned_by is not null;

create table private.command_idempotency (
  idempotency_key text primary key,
  command_name text not null,
  actor_id uuid not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint command_idempotency_key_length_check
    check (char_length(idempotency_key) between 12 and 160),
  constraint command_idempotency_request_hash_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint command_idempotency_expiry_check check (expires_at > created_at)
);

create index command_idempotency_expires_at_idx
  on private.command_idempotency (expires_at);

create table private.audit_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  correlation_id uuid not null,
  actor_id uuid,
  actor_kind text not null,
  event_type text not null,
  entity_type text,
  entity_id text,
  payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_events_actor_kind_check check (actor_kind in ('human', 'ai_agent', 'system')),
  constraint audit_events_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_events_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_correlation_id_idx on private.audit_events (correlation_id);
create index audit_events_actor_id_occurred_at_idx
  on private.audit_events (actor_id, occurred_at desc)
  where actor_id is not null;
create index audit_events_entity_idx
  on private.audit_events (entity_type, entity_id, occurred_at desc)
  where entity_type is not null and entity_id is not null;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, locale)
  values (new.id, 'az');

  insert into public.role_assignments (user_id, role, assigned_by)
  values (new.id, 'customer', null);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

revoke execute on function private.set_updated_at() from public;
revoke execute on function private.set_updated_at() from anon;
revoke execute on function private.set_updated_at() from authenticated;
revoke execute on function private.handle_new_auth_user() from public;
revoke execute on function private.handle_new_auth_user() from anon;
revoke execute on function private.handle_new_auth_user() from authenticated;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.role_assignments enable row level security;
alter table public.role_assignments force row level security;
alter table private.command_idempotency enable row level security;
alter table private.command_idempotency force row level security;
alter table private.audit_events enable row level security;
alter table private.audit_events force row level security;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy role_assignments_select_own
on public.role_assignments
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, locale) on table public.profiles to authenticated;

revoke all on table public.role_assignments from anon;
revoke all on table public.role_assignments from authenticated;
grant select on table public.role_assignments to authenticated;

grant usage on schema private to service_role;
grant select, insert, update on table private.command_idempotency to service_role;
grant select, insert on table private.audit_events to service_role;
grant usage, select on all sequences in schema private to service_role;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema private revoke all on tables from public;
alter default privileges in schema private revoke all on functions from public;

comment on table public.role_assignments is
  'Role records are readable by their subject but writable only through a future Founder-authorised BOS command.';
comment on table private.audit_events is
  'Append-only material event metadata. Raw sensitive payloads must not be logged; payload_hash binds exact content.';
