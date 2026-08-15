-- VOYARA AI Phase E.1: first-class public.intents domain primitive.
--
-- Boundary: public.travel_requests / public.travel_request_versions remain
-- the sole authority for Travel Request *content* (destination, dates,
-- travellers, budget, trip purpose, notes, acknowledgements). This
-- migration does not copy that content anywhere. An Intent row is a
-- lightweight, durable pointer that represents *why the traveller wants
-- VOYARA to act*: it carries provenance (who, source channel, locale),
-- lifecycle (unresolved / resolved / cancelled) and a reference to the
-- exact canonical Travel Request version/hash it currently represents.
-- Intent lifecycle and Travel Request status are deliberately separate,
-- non-competing state machines: Travel Request status tracks operational
-- processing (DRAFT -> SUBMITTED -> AI_PREPARATION -> HUMAN_REVIEW);
-- Intent status tracks whether the underlying customer goal is still open
-- (unresolved), has been satisfied (resolved) or was abandoned
-- (cancelled). Intent -> Journey resolution is explicitly out of scope for
-- this checkpoint (Section 6, Phase E.1 prompt) and is not implemented
-- here.
--
-- This migration is additive only. Migrations 1-27 are not edited,
-- renamed or reordered. The only change to prior behaviour is a
-- create-or-replace of public.execute_travel_request_command with the
-- identical signature, extending its existing transaction to also
-- maintain the owning Intent row for the customer commands
-- (travel_request.save_draft, travel_request.submit). Staff commands
-- (claim / start_ai_preparation / start_human_review) are unchanged.

create table public.intents (
  id uuid primary key,
  customer_id uuid not null references auth.users (id) on delete restrict,
  travel_request_id uuid not null references public.travel_requests (id) on delete restrict,
  travel_request_version_number integer not null,
  travel_request_payload_hash text not null,
  source text not null default 'WIZARD',
  locale text not null,
  status text not null default 'unresolved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint intents_one_per_travel_request_uidx unique (travel_request_id),
  constraint intents_source_check check (source in (
    'WIZARD', 'WHATSAPP', 'INSTAGRAM', 'VOICE', 'STAFF_MANUAL'
  )),
  constraint intents_locale_check check (locale in ('az', 'ru', 'en')),
  constraint intents_status_check check (status in ('unresolved', 'resolved', 'cancelled')),
  constraint intents_version_check check (travel_request_version_number > 0),
  constraint intents_payload_hash_check check (travel_request_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint intents_resolved_at_check check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved' and resolved_at is null)
  ),
  foreign key (travel_request_id, travel_request_version_number, travel_request_payload_hash)
    references public.travel_request_versions (travel_request_id, version_number, payload_hash)
    on delete restrict
);

create index intents_customer_updated_idx
  on public.intents (customer_id, updated_at desc);

create index intents_status_created_idx
  on public.intents (status, created_at desc);

create index intents_source_idx
  on public.intents (source, created_at desc);

comment on table public.intents is
  'Phase E.1 first-class Travel Intent: a durable, provenance-carrying pointer to the canonical Travel Request version/hash that represents an unresolved or resolved customer goal. Travel Request content remains solely authoritative in travel_requests / travel_request_versions; this table never duplicates that content.';
comment on column public.intents.source is
  'Channel provenance. Only WIZARD is wired in Phase E.1; the remaining values exist so later channel activation (WhatsApp, Instagram, Voice, staff-manual) requires no further foundational migration.';
comment on column public.intents.status is
  'Intent lifecycle, deliberately separate from travel_requests.status: unresolved (open customer goal), resolved (goal satisfied, e.g. by a later Journey), cancelled (abandoned). Not a duplicate of Travel Request operational status.';

alter table public.intents enable row level security;
alter table public.intents force row level security;

create policy intents_select_owner_or_aal2_staff
on public.intents
for select
to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    )
  )
);

revoke all on table public.intents from anon;
revoke all on table public.intents from authenticated;
grant select on table public.intents to authenticated;

grant select, insert, update on table public.intents to service_role;

-- Replace the Task 004 command function, identical signature, to also
-- maintain the owning Intent row for customer commands. Everything except
-- the two marked additions is byte-identical to the Task 004 definition.
create or replace function public.execute_travel_request_command(
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
  v_existing public.travel_request_command_receipts%rowtype;
  v_request public.travel_requests%rowtype;
  v_result jsonb;
  v_request_id uuid;
  v_content jsonb;
  v_content_hash text;
  v_locale text;
  v_version integer;
  v_revoked_before timestamptz;
  v_is_customer_command boolean;
  v_is_staff_command boolean;
begin
  select * into v_existing
  from public.travel_request_command_receipts
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.command_name <> p_command_name or v_existing.payload_hash <> p_payload_hash then
      return jsonb_build_object('status', 'denied', 'reasonCode', 'IDEMPOTENCY_CONFLICT');
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in (
    'travel_request.save_draft',
    'travel_request.submit',
    'travel_request.claim',
    'travel_request.start_ai_preparation',
    'travel_request.start_human_review'
  ) then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'UNREGISTERED_COMMAND');
  end if;

  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_PAYLOAD');
  end if;

  if p_actor_session_id is null or p_actor_issued_at is null or p_actor_aal not in ('aal1', 'aal2') then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_EVIDENCE_REQUIRED');
  end if;

  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_REVOKED');
  end if;

  select revoked_before into v_revoked_before
  from public.user_session_security
  where user_id = p_actor_id;

  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'SESSION_REVOKED');
  end if;

  v_is_customer_command := p_command_name in ('travel_request.save_draft', 'travel_request.submit');
  v_is_staff_command := not v_is_customer_command;

  if v_is_customer_command and not exists (
    select 1 from public.role_assignments
    where user_id = p_actor_id and role = 'customer' and active
  ) then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'CUSTOMER_REQUIRED');
  end if;

  if v_is_staff_command then
    if p_actor_aal <> 'aal2' then
      return jsonb_build_object('status', 'denied', 'reasonCode', 'AAL2_REQUIRED');
    end if;
    if not exists (
      select 1 from public.role_assignments
      where user_id = p_actor_id
        and role in ('staff', 'manager', 'finance', 'admin', 'founder')
        and active
    ) then
      return jsonb_build_object('status', 'denied', 'reasonCode', 'STAFF_REQUIRED');
    end if;
  end if;

  if v_is_customer_command and (
    select count(*) from public.travel_request_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
  ) >= 30 then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'RATE_LIMITED');
  end if;

  if p_command_name = 'travel_request.submit' and (
    select count(*) from public.travel_request_command_receipts
    where actor_id = p_actor_id
      and command_name = 'travel_request.submit'
      and created_at >= now() - interval '24 hours'
  ) >= 5 then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'RATE_LIMITED');
  end if;

  if v_is_staff_command and (
    select count(*) from public.travel_request_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
  ) >= 120 then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'RATE_LIMITED');
  end if;

  begin
    v_request_id := nullif(p_payload->>'requestId', '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_REQUEST_ID');
  end;

  if v_is_customer_command then
    v_content := p_payload->'content';
    v_content_hash := p_payload->>'contentHash';
    v_locale := v_content->>'locale';

    if v_content_hash is null
      or v_content_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_travel_request_content(v_content, p_command_name = 'travel_request.submit')
    then
      return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_TRAVEL_REQUEST');
    end if;

    if v_request_id is null then
      select * into v_request
      from public.travel_requests
      where customer_id = p_actor_id and status = 'DRAFT'
      order by created_at
      limit 1
      for update;

      if found then
        v_request_id := v_request.id;
      else
        v_request_id := p_command_id;
        insert into public.travel_requests (id, customer_id)
        values (v_request_id, p_actor_id);
        select * into v_request from public.travel_requests where id = v_request_id for update;
      end if;
    else
      select * into v_request from public.travel_requests where id = v_request_id for update;
      if not found then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'REQUEST_NOT_FOUND');
      end if;
      if v_request.customer_id <> p_actor_id then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'REQUEST_OWNERSHIP_REQUIRED');
      end if;
      if v_request.status <> 'DRAFT' then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'REQUEST_NOT_EDITABLE');
      end if;
    end if;

    v_version := v_request.current_version + 1;

    insert into public.travel_request_versions (
      travel_request_id, version_number, customer_id, locale,
      canonical_payload, payload_hash, created_by
    ) values (
      v_request_id, v_version, p_actor_id, v_locale,
      v_content, v_content_hash, p_actor_id
    );

    -- Phase E.1 addition: establish or advance the owning Intent for this
    -- Travel Request, in the same transaction, before branching between
    -- draft/submit. One row per travel_request_id (see
    -- intents_one_per_travel_request_uidx); retries are covered by the
    -- existing idempotency-receipt short-circuit above, so this upsert
    -- only ever runs once per genuinely new command. Only an
    -- already-unresolved Intent is advanced, so a resolved/cancelled
    -- Intent is never silently reopened by this path.
    insert into public.intents (
      id, customer_id, travel_request_id, travel_request_version_number,
      travel_request_payload_hash, source, locale, status, created_at, updated_at
    ) values (
      gen_random_uuid(), p_actor_id, v_request_id, v_version,
      v_content_hash, 'WIZARD', v_locale, 'unresolved', now(), now()
    )
    on conflict (travel_request_id) do update
    set travel_request_version_number = excluded.travel_request_version_number,
        travel_request_payload_hash = excluded.travel_request_payload_hash,
        locale = excluded.locale,
        updated_at = now()
    where public.intents.status = 'unresolved';

    if p_command_name = 'travel_request.save_draft' then
      update public.travel_requests
      set current_version = v_version, updated_at = now()
      where id = v_request_id;

      insert into public.travel_request_lifecycle_events (
        event_id, correlation_id, travel_request_id, customer_id,
        actor_id, actor_session_id, actor_kind, actor_aal, event_type,
        from_status, to_status, version_number, payload_hash, metadata
      ) values (
        gen_random_uuid(), p_command_id, v_request_id, p_actor_id,
        p_actor_id, p_actor_session_id, 'human', p_actor_aal, 'travel_request.draft_saved',
        case when v_version = 1 then null else 'DRAFT' end, 'DRAFT', v_version, v_content_hash,
        jsonb_build_object('locale', v_locale)
      );

      v_result := jsonb_build_object(
        'status', 'accepted', 'commandName', p_command_name,
        'requestId', v_request_id, 'requestStatus', 'DRAFT',
        'versionNumber', v_version, 'payloadHash', v_content_hash
      );
    else
      insert into public.travel_request_submissions (
        id, travel_request_id, version_number, customer_id, payload_hash,
        acknowledgement_version, accuracy_confirmed, data_processing_acknowledged, submitted_by
      ) values (
        p_command_id, v_request_id, v_version, p_actor_id, v_content_hash,
        'travel-request-submission-v1', true, true, p_actor_id
      );

      update public.travel_requests
      set status = 'SUBMITTED', current_version = v_version,
          submitted_at = now(), updated_at = now()
      where id = v_request_id;

      insert into public.travel_request_lifecycle_events (
        event_id, correlation_id, travel_request_id, customer_id,
        actor_id, actor_session_id, actor_kind, actor_aal, event_type,
        from_status, to_status, version_number, payload_hash, metadata
      ) values (
        gen_random_uuid(), p_command_id, v_request_id, p_actor_id,
        p_actor_id, p_actor_session_id, 'human', p_actor_aal, 'travel_request.submitted',
        'DRAFT', 'SUBMITTED', v_version, v_content_hash,
        jsonb_build_object('acknowledgementVersion', 'travel-request-submission-v1', 'locale', v_locale)
      );

      v_result := jsonb_build_object(
        'status', 'accepted', 'commandName', p_command_name,
        'requestId', v_request_id, 'requestStatus', 'SUBMITTED',
        'versionNumber', v_version, 'payloadHash', v_content_hash
      );
    end if;
  else
    if v_request_id is null then
      return jsonb_build_object('status', 'denied', 'reasonCode', 'REQUEST_ID_REQUIRED');
    end if;

    select * into v_request from public.travel_requests where id = v_request_id for update;
    if not found then
      return jsonb_build_object('status', 'denied', 'reasonCode', 'REQUEST_NOT_FOUND');
    end if;

    if p_command_name = 'travel_request.claim' then
      if v_request.status = 'DRAFT' then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'SUBMISSION_REQUIRED');
      end if;
      if v_request.assigned_staff_id is not null and v_request.assigned_staff_id <> p_actor_id then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'REQUEST_ALREADY_CLAIMED');
      end if;

      update public.travel_requests
      set assigned_staff_id = p_actor_id,
          claimed_at = coalesce(claimed_at, now()),
          updated_at = now()
      where id = v_request_id;

      insert into public.travel_request_lifecycle_events (
        event_id, correlation_id, travel_request_id, customer_id,
        actor_id, actor_session_id, actor_kind, actor_aal, event_type,
        from_status, to_status, version_number, payload_hash, metadata
      ) values (
        gen_random_uuid(), p_command_id, v_request_id, v_request.customer_id,
        p_actor_id, p_actor_session_id, 'human', p_actor_aal, 'travel_request.claimed',
        v_request.status, v_request.status, v_request.current_version, p_payload_hash,
        jsonb_build_object('assignedStaffId', p_actor_id)
      );

      v_result := jsonb_build_object(
        'status', 'accepted', 'commandName', p_command_name,
        'requestId', v_request_id, 'requestStatus', v_request.status,
        'assignedStaffId', p_actor_id
      );
    elsif p_command_name = 'travel_request.start_ai_preparation' then
      if v_request.status <> 'SUBMITTED' then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_STATE_TRANSITION');
      end if;
      if v_request.assigned_staff_id is distinct from p_actor_id then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'ASSIGNED_STAFF_REQUIRED');
      end if;

      update public.travel_requests
      set status = 'AI_PREPARATION', updated_at = now()
      where id = v_request_id;

      insert into public.travel_request_lifecycle_events (
        event_id, correlation_id, travel_request_id, customer_id,
        actor_id, actor_session_id, actor_kind, actor_aal, event_type,
        from_status, to_status, version_number, payload_hash, metadata
      ) values (
        gen_random_uuid(), p_command_id, v_request_id, v_request.customer_id,
        p_actor_id, p_actor_session_id, 'human', p_actor_aal, 'travel_request.ai_preparation_started',
        'SUBMITTED', 'AI_PREPARATION', v_request.current_version, p_payload_hash,
        jsonb_build_object('providerCalled', false)
      );

      v_result := jsonb_build_object(
        'status', 'accepted', 'commandName', p_command_name,
        'requestId', v_request_id, 'requestStatus', 'AI_PREPARATION'
      );
    else
      if v_request.status <> 'AI_PREPARATION' then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'INVALID_STATE_TRANSITION');
      end if;
      if v_request.assigned_staff_id is distinct from p_actor_id then
        return jsonb_build_object('status', 'denied', 'reasonCode', 'ASSIGNED_STAFF_REQUIRED');
      end if;

      update public.travel_requests
      set status = 'HUMAN_REVIEW', updated_at = now()
      where id = v_request_id;

      insert into public.travel_request_lifecycle_events (
        event_id, correlation_id, travel_request_id, customer_id,
        actor_id, actor_session_id, actor_kind, actor_aal, event_type,
        from_status, to_status, version_number, payload_hash, metadata
      ) values (
        gen_random_uuid(), p_command_id, v_request_id, v_request.customer_id,
        p_actor_id, p_actor_session_id, 'human', p_actor_aal, 'travel_request.human_review_started',
        'AI_PREPARATION', 'HUMAN_REVIEW', v_request.current_version, p_payload_hash, '{}'::jsonb
      );

      v_result := jsonb_build_object(
        'status', 'accepted', 'commandName', p_command_name,
        'requestId', v_request_id, 'requestStatus', 'HUMAN_REVIEW'
      );
    end if;
  end if;

  insert into public.travel_request_command_receipts (
    idempotency_key, command_id, command_name, actor_id, payload_hash, response, expires_at
  ) values (
    p_idempotency_key, p_command_id, p_command_name, p_actor_id,
    p_payload_hash, v_result, now() + interval '24 hours'
  );

  return v_result;
exception
  when unique_violation then
    select response into v_result
    from public.travel_request_command_receipts
    where idempotency_key = p_idempotency_key
      and command_name = p_command_name
      and payload_hash = p_payload_hash;
    if found then return v_result; end if;
    raise;
end;
$$;

revoke all on function public.execute_travel_request_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from public;
revoke all on function public.execute_travel_request_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from anon;
revoke all on function public.execute_travel_request_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from authenticated;
grant execute on function public.execute_travel_request_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) to service_role;
