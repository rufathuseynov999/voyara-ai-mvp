-- VOYARA AI Task 003: authentication activation, authoritative Roles,
-- staff invitation, AAL2 enforcement evidence and strict application logout.
-- Travel Request and commercial lifecycle tables remain intentionally out of scope.

alter table public.role_assignments
  add column revoked_by uuid references auth.users (id) on delete set null,
  add column reason text;

alter table public.role_assignments
  add constraint role_assignments_reason_length_check
  check (reason is null or char_length(reason) between 1 and 240);

create table public.user_session_security (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revoked_before timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.session_revocations (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  revoked_by uuid references auth.users (id) on delete set null,
  reason text not null,
  revoked_at timestamptz not null default now(),
  constraint session_revocations_reason_check
    check (reason in ('user_logout', 'security_logout', 'founder_revocation', 'account_lock'))
);

create index session_revocations_user_id_revoked_at_idx
  on public.session_revocations (user_id, revoked_at desc);

create table public.staff_invitations (
  id uuid primary key,
  email_normalized text not null,
  email_hash text not null,
  role text not null,
  locale text not null default 'az',
  invited_by uuid not null references auth.users (id) on delete restrict,
  status text not null default 'pending',
  expires_at timestamptz not null,
  delivered_at timestamptz,
  delivery_attempts integer not null default 0,
  delivery_error_code text,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_invitations_email_length_check
    check (char_length(email_normalized) between 3 and 254 and email_normalized = lower(btrim(email_normalized))),
  constraint staff_invitations_email_hash_check check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_invitations_role_check check (role in ('staff', 'manager', 'finance', 'admin')),
  constraint staff_invitations_locale_check check (locale in ('az', 'ru', 'en')),
  constraint staff_invitations_status_check
    check (status in ('pending', 'claimed', 'revoked', 'expired')),
  constraint staff_invitations_expiry_check check (expires_at > created_at),
  constraint staff_invitations_delivery_attempts_check check (delivery_attempts >= 0),
  constraint staff_invitations_claim_state_check check (
    (status = 'claimed' and claimed_by is not null and claimed_at is not null)
    or (status <> 'claimed' and claimed_by is null and claimed_at is null)
  )
);

create unique index staff_invitations_pending_email_uidx
  on public.staff_invitations (email_normalized)
  where status = 'pending';

create index staff_invitations_expires_at_idx
  on public.staff_invitations (expires_at)
  where status = 'pending';

create table public.command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint command_receipts_key_length_check check (char_length(idempotency_key) between 12 and 160),
  constraint command_receipts_name_check check (command_name in ('staff.invite', 'role.assign', 'role.revoke')),
  constraint command_receipts_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint command_receipts_response_object_check check (jsonb_typeof(response) = 'object'),
  constraint command_receipts_expiry_check check (expires_at > created_at)
);

create index command_receipts_expires_at_idx on public.command_receipts (expires_at);

create table public.authority_audit_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  correlation_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  actor_session_id uuid,
  actor_aal text,
  event_type text not null,
  outcome text not null,
  reason_code text,
  entity_type text,
  entity_id text,
  payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint authority_audit_events_aal_check check (actor_aal is null or actor_aal in ('aal1', 'aal2')),
  constraint authority_audit_events_outcome_check check (outcome in ('accepted', 'denied')),
  constraint authority_audit_events_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint authority_audit_events_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index authority_audit_events_actor_idx
  on public.authority_audit_events (actor_id, occurred_at desc)
  where actor_id is not null;

create index authority_audit_events_entity_idx
  on public.authority_audit_events (entity_type, entity_id, occurred_at desc)
  where entity_type is not null and entity_id is not null;

create or replace function private.reject_authority_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'authority audit events are append-only' using errcode = '55000';
end;
$$;

create trigger authority_audit_events_immutable
before update or delete on public.authority_audit_events
for each row execute function private.reject_authority_event_mutation();

create or replace function private.append_authority_event(
  p_correlation_id uuid,
  p_actor_id uuid,
  p_actor_session_id uuid,
  p_actor_aal text,
  p_event_type text,
  p_outcome text,
  p_reason_code text,
  p_entity_type text,
  p_entity_id text,
  p_payload_hash text,
  p_metadata jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.authority_audit_events (
    event_id,
    correlation_id,
    actor_id,
    actor_session_id,
    actor_aal,
    event_type,
    outcome,
    reason_code,
    entity_type,
    entity_id,
    payload_hash,
    metadata
  ) values (
    gen_random_uuid(),
    p_correlation_id,
    p_actor_id,
    p_actor_session_id,
    p_actor_aal,
    p_event_type,
    p_outcome,
    p_reason_code,
    p_entity_type,
    p_entity_id,
    p_payload_hash,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.execute_access_command(
  p_command_id uuid,
  p_idempotency_key text,
  p_command_name text,
  p_actor_id uuid,
  p_actor_session_id uuid,
  p_actor_aal text,
  p_actor_issued_at timestamptz,
  p_payload jsonb,
  p_payload_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.command_receipts%rowtype;
  v_result jsonb;
  v_target_user_id uuid;
  v_role text;
  v_email text;
  v_email_hash text;
  v_locale text;
  v_reason text;
  v_changed integer := 0;
  v_active_founders integer := 0;
  v_revoked_before timestamptz;
begin
  select * into v_existing
  from public.command_receipts
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.command_name <> p_command_name or v_existing.payload_hash <> p_payload_hash then
      perform private.append_authority_event(
        p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
        'denied', 'IDEMPOTENCY_CONFLICT', 'command', p_command_id::text,
        p_payload_hash, '{}'::jsonb
      );
      return jsonb_build_object('status', 'denied', 'reasonCode', 'IDEMPOTENCY_CONFLICT');
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in ('staff.invite', 'role.assign', 'role.revoke') then
    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'denied', 'UNREGISTERED_COMMAND', 'command', p_command_id::text,
      p_payload_hash, '{}'::jsonb
    );
    return jsonb_build_object('status', 'denied', 'reasonCode', 'UNREGISTERED_COMMAND');
  end if;

  if p_actor_session_id is null or p_actor_issued_at is null then
    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'denied', 'SESSION_EVIDENCE_REQUIRED', 'actor', p_actor_id::text,
      p_payload_hash, '{}'::jsonb
    );
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_EVIDENCE_REQUIRED');
  end if;

  if p_actor_aal <> 'aal2' then
    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'denied', 'AAL2_REQUIRED', 'actor', p_actor_id::text,
      p_payload_hash, '{}'::jsonb
    );
    return jsonb_build_object('status', 'denied', 'reasonCode', 'AAL2_REQUIRED');
  end if;

  if not exists (
    select 1 from public.role_assignments
    where user_id = p_actor_id and role = 'founder' and active
  ) then
    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'denied', 'FOUNDER_REQUIRED', 'actor', p_actor_id::text,
      p_payload_hash, '{}'::jsonb
    );
    return jsonb_build_object('status', 'denied', 'reasonCode', 'FOUNDER_REQUIRED');
  end if;

  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'denied', 'SESSION_REVOKED', 'actor', p_actor_id::text,
      p_payload_hash, '{}'::jsonb
    );
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_REVOKED');
  end if;

  select revoked_before into v_revoked_before
  from public.user_session_security
  where user_id = p_actor_id;

  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'denied', 'SESSION_REVOKED', 'actor', p_actor_id::text,
      p_payload_hash, '{}'::jsonb
    );
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_REVOKED');
  end if;

  if p_command_name = 'staff.invite' then
    v_email := lower(btrim(p_payload->>'email'));
    v_email_hash := p_payload->>'emailHash';
    v_role := p_payload->>'role';
    v_locale := coalesce(p_payload->>'locale', 'az');

    if v_email is null
      or char_length(v_email) not between 3 and 254
      or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or v_email_hash is null
      or v_email_hash !~ '^[0-9a-f]{64}$'
      or v_role not in ('staff', 'manager', 'finance', 'admin')
      or v_locale not in ('az', 'ru', 'en') then
      perform private.append_authority_event(
        p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
        'denied', 'INVALID_INVITATION', 'staff_invitation', p_command_id::text,
        p_payload_hash, jsonb_build_object('emailHash', v_email_hash)
      );
      return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_INVITATION');
    end if;

    insert into public.staff_invitations (
      id, email_normalized, email_hash, role, locale, invited_by, expires_at
    ) values (
      p_command_id, v_email, v_email_hash, v_role, v_locale, p_actor_id, now() + interval '72 hours'
    )
    on conflict (email_normalized) where status = 'pending'
    do update set
      role = excluded.role,
      locale = excluded.locale,
      invited_by = excluded.invited_by,
      expires_at = excluded.expires_at,
      delivery_error_code = null;

    select id into v_target_user_id
    from public.staff_invitations
    where email_normalized = v_email and status = 'pending';

    v_result := jsonb_build_object(
      'status', 'accepted',
      'commandName', p_command_name,
      'invitationId', v_target_user_id,
      'role', v_role,
      'expiresInHours', 72
    );

    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'accepted', null, 'staff_invitation', v_target_user_id::text,
      p_payload_hash, jsonb_build_object('emailHash', v_email_hash, 'role', v_role)
    );

  elsif p_command_name = 'role.assign' then
    v_target_user_id := (p_payload->>'userId')::uuid;
    v_role := p_payload->>'role';
    v_reason := nullif(btrim(p_payload->>'reason'), '');

    if v_role not in ('customer', 'staff', 'manager', 'finance', 'admin', 'founder') then
      perform private.append_authority_event(
        p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
        'denied', 'INVALID_ROLE', 'profile', v_target_user_id::text,
        p_payload_hash, '{}'::jsonb
      );
      return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_ROLE');
    end if;

    if not exists (select 1 from public.profiles where id = v_target_user_id) then
      perform private.append_authority_event(
        p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
        'denied', 'TARGET_NOT_FOUND', 'profile', v_target_user_id::text,
        p_payload_hash, '{}'::jsonb
      );
      return jsonb_build_object('status', 'denied', 'reasonCode', 'TARGET_NOT_FOUND');
    end if;

    insert into public.role_assignments (user_id, role, assigned_by, reason)
    values (v_target_user_id, v_role, p_actor_id, v_reason)
    on conflict (user_id, role) where active do nothing;
    get diagnostics v_changed = row_count;

    v_result := jsonb_build_object(
      'status', 'accepted',
      'commandName', p_command_name,
      'userId', v_target_user_id,
      'role', v_role,
      'changed', v_changed = 1
    );

    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'accepted', null, 'role_assignment', v_target_user_id::text,
      p_payload_hash, jsonb_build_object('role', v_role, 'changed', v_changed = 1)
    );

  else
    v_target_user_id := (p_payload->>'userId')::uuid;
    v_role := p_payload->>'role';
    v_reason := nullif(btrim(p_payload->>'reason'), '');

    if v_role not in ('customer', 'staff', 'manager', 'finance', 'admin', 'founder') then
      perform private.append_authority_event(
        p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
        'denied', 'INVALID_ROLE', 'profile', v_target_user_id::text,
        p_payload_hash, '{}'::jsonb
      );
      return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_ROLE');
    end if;

    if v_role = 'founder' then
      select count(*) into v_active_founders
      from public.role_assignments
      where role = 'founder' and active;

      if v_target_user_id = p_actor_id or v_active_founders <= 1 then
        perform private.append_authority_event(
          p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
          'denied', 'LAST_OR_CURRENT_FOUNDER', 'role_assignment', v_target_user_id::text,
          p_payload_hash, jsonb_build_object('role', v_role)
        );
        return jsonb_build_object('status', 'denied', 'reasonCode', 'LAST_OR_CURRENT_FOUNDER');
      end if;
    end if;

    update public.role_assignments
    set active = false,
        revoked_at = now(),
        revoked_by = p_actor_id,
        reason = coalesce(v_reason, reason)
    where user_id = v_target_user_id and role = v_role and active;
    get diagnostics v_changed = row_count;

    v_result := jsonb_build_object(
      'status', 'accepted',
      'commandName', p_command_name,
      'userId', v_target_user_id,
      'role', v_role,
      'changed', v_changed = 1
    );

    perform private.append_authority_event(
      p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
      'accepted', null, 'role_assignment', v_target_user_id::text,
      p_payload_hash, jsonb_build_object('role', v_role, 'changed', v_changed = 1)
    );
  end if;

  insert into public.command_receipts (
    idempotency_key, command_id, command_name, actor_id, payload_hash, response, expires_at
  ) values (
    p_idempotency_key, p_command_id, p_command_name, p_actor_id, p_payload_hash,
    v_result, now() + interval '24 hours'
  );

  return v_result;
exception
  when unique_violation then
    select response into v_result
    from public.command_receipts
    where idempotency_key = p_idempotency_key
      and command_name = p_command_name
      and payload_hash = p_payload_hash;
    if found then
      return v_result;
    end if;
    raise;
end;
$$;

-- Replace the Task 002 auth trigger. Staff authority comes only from a pending,
-- Founder-created invitation; every other new account receives Customer only.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.staff_invitations%rowtype;
begin
  insert into public.profiles (id, locale)
  values (new.id, 'az')
  on conflict (id) do nothing;

  insert into public.user_session_security (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  update public.staff_invitations
  set status = 'expired'
  where email_normalized = lower(btrim(new.email))
    and status = 'pending'
    and expires_at <= now();

  select * into v_invitation
  from public.staff_invitations
  where email_normalized = lower(btrim(new.email))
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if found then
    update public.staff_invitations
    set status = 'claimed', claimed_by = new.id, claimed_at = now()
    where id = v_invitation.id;

    insert into public.role_assignments (user_id, role, assigned_by, reason)
    values (new.id, v_invitation.role, v_invitation.invited_by, 'Founder-created staff invitation');

    insert into public.authority_audit_events (
      event_id, correlation_id, actor_id, event_type, outcome,
      entity_type, entity_id, payload_hash, metadata
    ) values (
      gen_random_uuid(), v_invitation.id, v_invitation.invited_by,
      'staff.invitation.claimed', 'accepted', 'profile', new.id::text,
      v_invitation.email_hash, jsonb_build_object('role', v_invitation.role)
    );
  else
    insert into public.role_assignments (user_id, role, assigned_by)
    values (new.id, 'customer', null)
    on conflict (user_id, role) where active do nothing;
  end if;

  return new;
end;
$$;

insert into public.user_session_security (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

alter table public.user_session_security enable row level security;
alter table public.user_session_security force row level security;
alter table public.session_revocations enable row level security;
alter table public.session_revocations force row level security;
alter table public.staff_invitations enable row level security;
alter table public.staff_invitations force row level security;
alter table public.command_receipts enable row level security;
alter table public.command_receipts force row level security;
alter table public.authority_audit_events enable row level security;
alter table public.authority_audit_events force row level security;

create policy user_session_security_select_own
on public.user_session_security
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy session_revocations_select_own
on public.session_revocations
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_session_security from anon;
revoke all on table public.user_session_security from authenticated;
grant select on table public.user_session_security to authenticated;

revoke all on table public.session_revocations from anon;
revoke all on table public.session_revocations from authenticated;
grant select on table public.session_revocations to authenticated;

revoke all on table public.staff_invitations from anon;
revoke all on table public.staff_invitations from authenticated;
revoke all on table public.command_receipts from anon;
revoke all on table public.command_receipts from authenticated;
revoke all on table public.authority_audit_events from anon;
revoke all on table public.authority_audit_events from authenticated;

grant select, insert, update on table public.user_session_security to service_role;
grant select, insert on table public.session_revocations to service_role;
grant select, insert, update on table public.staff_invitations to service_role;
grant select, insert on table public.command_receipts to service_role;
grant select, insert on table public.authority_audit_events to service_role;
grant select, insert, update on table public.role_assignments to service_role;
grant select on table public.profiles to service_role;
grant usage, select on sequence public.authority_audit_events_id_seq to service_role;

revoke all on function private.reject_authority_event_mutation() from public;
revoke all on function private.reject_authority_event_mutation() from anon;
revoke all on function private.reject_authority_event_mutation() from authenticated;
revoke all on function private.append_authority_event(uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) from public;
revoke all on function private.append_authority_event(uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) from anon;
revoke all on function private.append_authority_event(uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) from authenticated;
grant execute on function private.append_authority_event(uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;

revoke all on function public.execute_access_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) from public;
revoke all on function public.execute_access_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) from anon;
revoke all on function public.execute_access_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) from authenticated;
grant execute on function public.execute_access_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) to service_role;

comment on table public.staff_invitations is
  'PII-bearing staff invitations. Data API access is server-secret only; staff authority is activated by the auth trigger.';
comment on table public.authority_audit_events is
  'Append-only evidence for Founder access commands and staff invitation activation.';
comment on function public.execute_access_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) is
  'Service-role-only, security-invoker transaction boundary for Founder access commands.';
