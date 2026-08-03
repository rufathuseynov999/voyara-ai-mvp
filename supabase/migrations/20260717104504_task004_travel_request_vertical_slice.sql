-- VOYARA AI Task 004: versioned Travel Request vertical slice.
-- This migration stops at HUMAN_REVIEW. It does not create a Quotation,
-- Approval, Payment, Booking, Supplier Confirmation or Voucher authority.

create table public.travel_requests (
  id uuid primary key,
  customer_id uuid not null references auth.users (id) on delete restrict,
  status text not null default 'DRAFT',
  current_version integer not null default 0,
  assigned_staff_id uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_requests_status_check
    check (status in ('DRAFT', 'SUBMITTED', 'AI_PREPARATION', 'HUMAN_REVIEW')),
  constraint travel_requests_current_version_check check (current_version >= 0),
  constraint travel_requests_assignment_state_check check (
    (assigned_staff_id is null and claimed_at is null)
    or (assigned_staff_id is not null and claimed_at is not null)
  ),
  constraint travel_requests_submission_state_check check (
    (status = 'DRAFT' and submitted_at is null)
    or (status <> 'DRAFT' and submitted_at is not null)
  )
);

create index travel_requests_customer_updated_idx
  on public.travel_requests (customer_id, updated_at desc);

create unique index travel_requests_one_draft_per_customer_uidx
  on public.travel_requests (customer_id)
  where status = 'DRAFT';

create index travel_requests_staff_queue_idx
  on public.travel_requests (status, submitted_at, created_at)
  where status <> 'DRAFT';

create index travel_requests_assigned_staff_idx
  on public.travel_requests (assigned_staff_id, updated_at desc)
  where assigned_staff_id is not null;

create table public.travel_request_versions (
  travel_request_id uuid not null references public.travel_requests (id) on delete restrict,
  version_number integer not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  locale text not null,
  canonical_payload jsonb not null,
  payload_hash text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (travel_request_id, version_number),
  unique (travel_request_id, version_number, payload_hash),
  constraint travel_request_versions_number_check check (version_number > 0),
  constraint travel_request_versions_locale_check check (locale in ('az', 'ru', 'en')),
  constraint travel_request_versions_payload_object_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint travel_request_versions_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index travel_request_versions_customer_idx
  on public.travel_request_versions (customer_id, created_at desc);

create table public.travel_request_submissions (
  id uuid primary key,
  travel_request_id uuid not null,
  version_number integer not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  acknowledgement_version text not null,
  accuracy_confirmed boolean not null,
  data_processing_acknowledged boolean not null,
  submitted_by uuid not null references auth.users (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  unique (travel_request_id),
  foreign key (travel_request_id, version_number, payload_hash)
    references public.travel_request_versions (travel_request_id, version_number, payload_hash) on delete restrict,
  constraint travel_request_submissions_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint travel_request_submissions_acknowledgement_version_check
    check (acknowledgement_version = 'travel-request-submission-v1'),
  constraint travel_request_submissions_confirmed_check
    check (accuracy_confirmed and data_processing_acknowledged)
);

create index travel_request_submissions_customer_idx
  on public.travel_request_submissions (customer_id, submitted_at desc);

create table public.travel_request_lifecycle_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  correlation_id uuid not null,
  travel_request_id uuid not null references public.travel_requests (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  actor_id uuid references auth.users (id) on delete set null,
  actor_session_id uuid,
  actor_kind text not null,
  actor_aal text,
  event_type text not null,
  from_status text,
  to_status text not null,
  version_number integer,
  payload_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint travel_request_lifecycle_actor_kind_check check (actor_kind in ('human', 'ai_agent', 'system')),
  constraint travel_request_lifecycle_aal_check check (actor_aal is null or actor_aal in ('aal1', 'aal2')),
  constraint travel_request_lifecycle_event_type_check check (event_type in (
    'travel_request.draft_saved',
    'travel_request.submitted',
    'travel_request.claimed',
    'travel_request.ai_preparation_started',
    'travel_request.human_review_started'
  )),
  constraint travel_request_lifecycle_from_status_check check (
    from_status is null or from_status in ('DRAFT', 'SUBMITTED', 'AI_PREPARATION', 'HUMAN_REVIEW')
  ),
  constraint travel_request_lifecycle_to_status_check
    check (to_status in ('DRAFT', 'SUBMITTED', 'AI_PREPARATION', 'HUMAN_REVIEW')),
  constraint travel_request_lifecycle_version_check check (version_number is null or version_number > 0),
  constraint travel_request_lifecycle_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint travel_request_lifecycle_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index travel_request_lifecycle_request_idx
  on public.travel_request_lifecycle_events (travel_request_id, occurred_at, id);

create index travel_request_lifecycle_customer_idx
  on public.travel_request_lifecycle_events (customer_id, occurred_at desc);

create table public.travel_request_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint travel_request_receipts_key_length_check check (char_length(idempotency_key) between 12 and 160),
  constraint travel_request_receipts_name_check check (command_name in (
    'travel_request.save_draft',
    'travel_request.submit',
    'travel_request.claim',
    'travel_request.start_ai_preparation',
    'travel_request.start_human_review'
  )),
  constraint travel_request_receipts_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint travel_request_receipts_response_object_check check (jsonb_typeof(response) = 'object'),
  constraint travel_request_receipts_expiry_check check (expires_at > created_at)
);

create index travel_request_command_receipts_expires_idx
  on public.travel_request_command_receipts (expires_at);

create index travel_request_command_receipts_actor_created_idx
  on public.travel_request_command_receipts (actor_id, created_at desc);

create or replace function private.reject_travel_request_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'travel request evidence is append-only' using errcode = '55000';
end;
$$;

create trigger travel_request_versions_immutable
before update or delete on public.travel_request_versions
for each row execute function private.reject_travel_request_evidence_mutation();

create trigger travel_request_submissions_immutable
before update or delete on public.travel_request_submissions
for each row execute function private.reject_travel_request_evidence_mutation();

create trigger travel_request_lifecycle_events_immutable
before update or delete on public.travel_request_lifecycle_events
for each row execute function private.reject_travel_request_evidence_mutation();

create or replace function private.is_iso_date(p_value text)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  return to_char(p_value::date, 'YYYY-MM-DD') = p_value;
exception
  when invalid_datetime_format or datetime_field_overflow then
    return false;
end;
$$;

create or replace function private.is_valid_travel_request_content(p_content jsonb, p_require_acknowledgement boolean)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_departure_date text;
  v_return_date text;
begin
  if jsonb_typeof(p_content) <> 'object' then return false; end if;

  v_departure_date := p_content->>'departureDate';
  v_return_date := p_content->>'returnDate';

  if char_length(btrim(coalesce(p_content->>'destination', ''))) not between 2 and 120
    or char_length(btrim(coalesce(p_content->>'departureCity', ''))) not between 2 and 120
    or not private.is_iso_date(v_departure_date)
    or not private.is_iso_date(v_return_date)
    or v_return_date < v_departure_date
    or coalesce(p_content->>'locale', '') not in ('az', 'ru', 'en')
    or coalesce(p_content->>'tripPurpose', '') not in (
      'leisure', 'business', 'family', 'honeymoon', 'wellness', 'adventure', 'other'
    )
    or char_length(coalesce(p_content->>'notes', '')) > 2000
    or jsonb_typeof(p_content->'travelers') <> 'object'
    or coalesce(p_content#>>'{travelers,adults}', '') !~ '^[0-9]+$'
    or (p_content#>>'{travelers,adults}')::integer not between 1 and 12
    or coalesce(p_content#>>'{travelers,children}', '') !~ '^[0-9]+$'
    or (p_content#>>'{travelers,children}')::integer not between 0 and 8
    or coalesce(p_content#>>'{travelers,infants}', '') !~ '^[0-9]+$'
    or (p_content#>>'{travelers,infants}')::integer not between 0 and 4
    or coalesce(p_content->>'budgetAzn', '') !~ '^[0-9]+$'
    or (p_content->>'budgetAzn')::integer not between 100 and 1000000
    or jsonb_typeof(p_content->'submissionAcknowledgements') <> 'object'
  then
    return false;
  end if;

  if p_require_acknowledgement and (
    coalesce((p_content#>>'{submissionAcknowledgements,accuracyConfirmed}')::boolean, false) is not true
    or coalesce((p_content#>>'{submissionAcknowledgements,dataProcessingAcknowledged}')::boolean, false) is not true
  ) then
    return false;
  end if;

  return true;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end;
$$;

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

alter table public.travel_requests enable row level security;
alter table public.travel_requests force row level security;
alter table public.travel_request_versions enable row level security;
alter table public.travel_request_versions force row level security;
alter table public.travel_request_submissions enable row level security;
alter table public.travel_request_submissions force row level security;
alter table public.travel_request_lifecycle_events enable row level security;
alter table public.travel_request_lifecycle_events force row level security;
alter table public.travel_request_command_receipts enable row level security;
alter table public.travel_request_command_receipts force row level security;

create policy travel_requests_select_owner_or_aal2_staff
on public.travel_requests
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

create policy travel_request_versions_select_owner_or_aal2_staff
on public.travel_request_versions
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

create policy travel_request_submissions_select_owner_or_aal2_staff
on public.travel_request_submissions
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

create policy travel_request_lifecycle_select_owner_or_aal2_staff
on public.travel_request_lifecycle_events
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

revoke all on table public.travel_requests from anon;
revoke all on table public.travel_requests from authenticated;
grant select on table public.travel_requests to authenticated;

revoke all on table public.travel_request_versions from anon;
revoke all on table public.travel_request_versions from authenticated;
grant select on table public.travel_request_versions to authenticated;

revoke all on table public.travel_request_submissions from anon;
revoke all on table public.travel_request_submissions from authenticated;
grant select on table public.travel_request_submissions to authenticated;

revoke all on table public.travel_request_lifecycle_events from anon;
revoke all on table public.travel_request_lifecycle_events from authenticated;
grant select on table public.travel_request_lifecycle_events to authenticated;

revoke all on table public.travel_request_command_receipts from anon;
revoke all on table public.travel_request_command_receipts from authenticated;

grant select, insert, update on table public.travel_requests to service_role;
grant select, insert on table public.travel_request_versions to service_role;
grant select, insert on table public.travel_request_submissions to service_role;
grant select, insert on table public.travel_request_lifecycle_events to service_role;
grant select, insert on table public.travel_request_command_receipts to service_role;
grant usage, select on sequence public.travel_request_lifecycle_events_id_seq to service_role;

revoke all on function private.reject_travel_request_evidence_mutation() from public;
revoke all on function private.reject_travel_request_evidence_mutation() from anon;
revoke all on function private.reject_travel_request_evidence_mutation() from authenticated;
revoke all on function private.is_iso_date(text) from public;
revoke all on function private.is_iso_date(text) from anon;
revoke all on function private.is_iso_date(text) from authenticated;
grant execute on function private.is_iso_date(text) to service_role;
revoke all on function private.is_valid_travel_request_content(jsonb, boolean) from public;
revoke all on function private.is_valid_travel_request_content(jsonb, boolean) from anon;
revoke all on function private.is_valid_travel_request_content(jsonb, boolean) from authenticated;
grant execute on function private.is_valid_travel_request_content(jsonb, boolean) to service_role;

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

comment on table public.travel_requests is
  'Mutable Travel Request lifecycle pointer. Exact Customer content lives in immutable versions.';
comment on table public.travel_request_versions is
  'Append-only Customer Travel Request content, bound to a canonical payload SHA-256.';
comment on table public.travel_request_submissions is
  'One immutable Customer submission bound to one exact Travel Request version and hash.';
comment on function public.execute_travel_request_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) is
  'Service-role-only, security-invoker transaction boundary for Task 004 Travel Request commands.';
