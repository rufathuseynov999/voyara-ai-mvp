-- VOYARA AI Task 009: authenticated Trip Room Support and operational
-- Exception management. Support activity is an immutable communication and
-- ownership record only. It cannot change Booking, Payment, Voucher, Refund,
-- cancellation, compensation or other commercial authority.

create table public.support_cases (
  id uuid primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  voucher_id uuid not null,
  voucher_version integer not null,
  voucher_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  locale text not null,
  category text not null,
  subject text not null,
  status text not null default 'OPEN',
  priority text not null,
  escalation_level text not null default 'NONE',
  owner_id uuid references auth.users (id) on delete restrict,
  case_authority_hash text not null,
  current_event_sequence integer not null default 1,
  current_event_hash text not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (id, case_authority_hash),
  foreign key (booking_id, voucher_id, voucher_version, voucher_hash)
    references public.voucher_versions
      (booking_id, voucher_id, version_number, voucher_hash) on delete restrict,
  constraint support_cases_voucher_version_check check (voucher_version > 0),
  constraint support_cases_voucher_hash_check check (voucher_hash ~ '^[0-9a-f]{64}$'),
  constraint support_cases_locale_check check (locale in ('az', 'ru', 'en')),
  constraint support_cases_category_check check (category in (
    'TRAVEL_DISRUPTION', 'SUPPLIER_SERVICE', 'DOCUMENT_OR_VOUCHER',
    'ITINERARY_QUESTION', 'OTHER'
  )),
  constraint support_cases_subject_check
    check (char_length(btrim(subject)) between 5 and 120),
  constraint support_cases_status_check check (status in (
    'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'
  )),
  constraint support_cases_priority_check check (priority in (
    'P1_CRITICAL', 'P2_HIGH', 'P3_NORMAL', 'P4_LOW'
  )),
  constraint support_cases_escalation_check check (escalation_level in (
    'NONE', 'MANAGER', 'FOUNDER'
  )),
  constraint support_cases_authority_hash_check
    check (case_authority_hash ~ '^[0-9a-f]{64}$'),
  constraint support_cases_event_sequence_check check (current_event_sequence > 0),
  constraint support_cases_event_hash_check check (current_event_hash ~ '^[0-9a-f]{64}$'),
  constraint support_cases_owner_state_check check (
    (status = 'OPEN' and owner_id is null)
    or (status <> 'OPEN' and owner_id is not null)
  ),
  constraint support_cases_resolution_state_check check (
    (status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
      and resolved_at is null and closed_at is null)
    or (status = 'RESOLVED' and resolved_at is not null and closed_at is null)
    or (status = 'CLOSED' and resolved_at is not null and closed_at is not null)
  )
);

create table public.support_case_events (
  id uuid primary key,
  case_id uuid not null,
  case_authority_hash text not null,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  event_sequence integer not null,
  previous_event_sequence integer,
  previous_event_hash text,
  event_type text not null,
  visibility text not null,
  message text not null,
  canonical_payload jsonb not null,
  event_hash text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_kind text not null,
  actor_session_id uuid not null,
  actor_aal text not null,
  occurred_at timestamptz not null default now(),
  unique (case_id, event_sequence),
  unique (case_id, event_sequence, event_hash),
  foreign key (case_id, case_authority_hash)
    references public.support_cases (id, case_authority_hash) on delete restrict,
  foreign key (case_id, previous_event_sequence, previous_event_hash)
    references public.support_case_events (case_id, event_sequence, event_hash)
    on delete restrict,
  constraint support_events_authority_hash_check
    check (case_authority_hash ~ '^[0-9a-f]{64}$'),
  constraint support_events_sequence_check check (event_sequence > 0),
  constraint support_events_previous_check check (
    (event_sequence = 1 and previous_event_sequence is null and previous_event_hash is null)
    or (event_sequence > 1 and previous_event_sequence = event_sequence - 1
      and previous_event_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint support_events_type_check check (event_type in (
    'CASE_OPENED', 'CUSTOMER_MESSAGE', 'CASE_CLAIMED', 'PRIORITY_CHANGED',
    'CASE_ESCALATED', 'CUSTOMER_UPDATE', 'INTERNAL_NOTE',
    'CASE_RESOLVED', 'CASE_CLOSED'
  )),
  constraint support_events_visibility_check check (visibility in ('CUSTOMER', 'INTERNAL')),
  constraint support_events_message_check
    check (char_length(btrim(message)) between 5 and 2000),
  constraint support_events_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint support_events_hash_check check (event_hash ~ '^[0-9a-f]{64}$'),
  constraint support_events_actor_kind_check check (actor_kind in ('CUSTOMER', 'STAFF')),
  constraint support_events_actor_aal_check check (actor_aal in ('aal1', 'aal2')),
  constraint support_events_visibility_type_check check (
    (event_type in ('CASE_OPENED', 'CUSTOMER_MESSAGE', 'CUSTOMER_UPDATE', 'CASE_RESOLVED', 'CASE_CLOSED')
      and visibility = 'CUSTOMER')
    or (event_type in ('CASE_CLAIMED', 'PRIORITY_CHANGED', 'CASE_ESCALATED', 'INTERNAL_NOTE')
      and visibility = 'INTERNAL')
  )
);

create table public.support_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint support_command_receipts_key_check
    check (char_length(idempotency_key) between 12 and 160),
  constraint support_command_receipts_name_check check (command_name in (
    'support.case.open', 'support.case.message', 'support.case.claim',
    'support.case.priority.set', 'support.case.escalate',
    'support.case.customer_update', 'support.case.internal_note',
    'support.case.resolve', 'support.case.close'
  )),
  constraint support_command_receipts_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint support_command_receipts_response_check
    check (jsonb_typeof(response) = 'object'),
  constraint support_command_receipts_expiry_check check (expires_at > created_at)
);

create index support_cases_customer_opened_idx
  on public.support_cases (customer_id, opened_at desc);
create index support_cases_operations_queue_idx
  on public.support_cases (status, priority, escalation_level, updated_at desc);
create index support_cases_owner_queue_idx
  on public.support_cases (owner_id, status, updated_at desc);
create unique index support_cases_one_active_booking_idx
  on public.support_cases (booking_id)
  where status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER');
create index support_case_events_case_sequence_idx
  on public.support_case_events (case_id, event_sequence);
create index support_command_receipts_actor_created_idx
  on public.support_command_receipts (actor_id, created_at desc);

create or replace function private.reject_support_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'support evidence is append-only' using errcode = '55000';
end;
$$;

create trigger support_case_events_immutable
before update or delete on public.support_case_events
for each row execute function private.reject_support_evidence_mutation();

create trigger support_command_receipts_immutable
before update or delete on public.support_command_receipts
for each row execute function private.reject_support_evidence_mutation();

create or replace function private.guard_support_case_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'support cases cannot be deleted' using errcode = '55000';
  end if;
  if new.id <> old.id or new.booking_id <> old.booking_id
    or new.voucher_id <> old.voucher_id or new.voucher_version <> old.voucher_version
    or new.voucher_hash <> old.voucher_hash or new.customer_id <> old.customer_id
    or new.locale <> old.locale or new.category <> old.category
    or new.subject <> old.subject or new.case_authority_hash <> old.case_authority_hash
    or new.opened_at <> old.opened_at
  then
    raise exception 'support case authority identity is immutable' using errcode = '55000';
  end if;
  if old.status = 'CLOSED' then
    raise exception 'closed support cases are immutable' using errcode = '55000';
  end if;
  if new.current_event_sequence <> old.current_event_sequence + 1
    or new.current_event_hash = old.current_event_hash
    or not exists (
      select 1 from public.support_case_events
      where case_id = new.id and event_sequence = new.current_event_sequence
        and event_hash = new.current_event_hash
        and previous_event_sequence = old.current_event_sequence
        and previous_event_hash = old.current_event_hash
    )
  then
    raise exception 'support case update requires the next immutable event' using errcode = '55000';
  end if;
  if old.owner_id is not null and new.owner_id is distinct from old.owner_id then
    raise exception 'support case owner cannot be silently replaced' using errcode = '55000';
  end if;
  if old.owner_id is null and new.owner_id is not null
    and not (old.status = 'OPEN' and new.status = 'ASSIGNED')
  then
    raise exception 'support case ownership requires assignment' using errcode = '55000';
  end if;
  if not (
    new.status = old.status
    or (old.status = 'OPEN' and new.status = 'ASSIGNED')
    or (old.status = 'ASSIGNED' and new.status in ('IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'))
    or (old.status = 'IN_PROGRESS' and new.status in ('WAITING_CUSTOMER', 'RESOLVED'))
    or (old.status = 'WAITING_CUSTOMER' and new.status in ('IN_PROGRESS', 'RESOLVED'))
    or (old.status = 'RESOLVED' and new.status = 'CLOSED')
  ) then
    raise exception 'invalid support case transition' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger support_cases_guarded
before update or delete on public.support_cases
for each row execute function private.guard_support_case_update();

create or replace function private.is_valid_support_case_open_payload(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_payload) = 'object'
    and p_payload->>'schemaVersion' = 'support-case-open-v1'
    and (p_payload->>'caseId') is not null
    and (p_payload->>'bookingId') is not null
    and (p_payload->>'voucherId') is not null
    and (p_payload->>'voucherVersion') ~ '^[1-9][0-9]*$'
    and (p_payload->>'voucherHash') ~ '^[0-9a-f]{64}$'
    and (p_payload->>'customerId') is not null
    and p_payload->>'locale' in ('az', 'ru', 'en')
    and p_payload->>'category' in (
      'TRAVEL_DISRUPTION', 'SUPPLIER_SERVICE', 'DOCUMENT_OR_VOUCHER',
      'ITINERARY_QUESTION', 'OTHER'
    )
    and p_payload->>'urgency' in ('NORMAL', 'URGENT')
    and char_length(btrim(coalesce(p_payload->>'subject', ''))) between 5 and 120
    and char_length(btrim(coalesce(p_payload->>'message', ''))) between 10 and 2000
    and p_payload->'declarationConfirmed' = 'true'::jsonb;
$$;

create or replace function private.is_valid_support_case_event_payload(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_payload) = 'object'
    and p_payload->>'schemaVersion' = 'support-case-event-v1'
    and (p_payload->>'caseId') is not null
    and (p_payload->>'caseAuthorityHash') ~ '^[0-9a-f]{64}$'
    and (p_payload->>'eventSequence') ~ '^[2-9][0-9]*$|^[1-9][0-9]{1,}$'
    and (p_payload->>'previousEventHash') ~ '^[0-9a-f]{64}$'
    and p_payload->>'eventType' in (
      'CUSTOMER_MESSAGE', 'CASE_CLAIMED', 'PRIORITY_CHANGED',
      'CASE_ESCALATED', 'CUSTOMER_UPDATE', 'INTERNAL_NOTE',
      'CASE_RESOLVED', 'CASE_CLOSED'
    )
    and p_payload->>'visibility' in ('CUSTOMER', 'INTERNAL')
    and char_length(btrim(coalesce(p_payload->>'message', ''))) between 5 and 2000
    and coalesce(p_payload->>'nextStatus', '') in (
      '', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'
    )
    and coalesce(p_payload->>'priority', '') in (
      '', 'P1_CRITICAL', 'P2_HIGH', 'P3_NORMAL', 'P4_LOW'
    )
    and coalesce(p_payload->>'escalationLevel', '') in ('', 'NONE', 'MANAGER', 'FOUNDER')
    and p_payload->'financialAuthorityUnaffected' = 'true'::jsonb;
$$;

create or replace function private.support_denial_result(
  p_command_id uuid,
  p_command_name text,
  p_actor_id uuid,
  p_actor_session_id uuid,
  p_actor_aal text,
  p_reason_code text,
  p_entity_id text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal,
    p_command_name, 'denied', p_reason_code, 'support_case',
    coalesce(p_entity_id, p_command_id::text),
    case when p_payload_hash ~ '^[0-9a-f]{64}$'
      then p_payload_hash else repeat('0', 64) end,
    '{}'::jsonb
  );
  return jsonb_build_object('status', 'denied', 'reasonCode', p_reason_code);
end;
$$;

create or replace function public.execute_support_command(
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
  v_existing public.support_command_receipts%rowtype;
  v_case public.support_cases%rowtype;
  v_booking public.bookings%rowtype;
  v_voucher public.vouchers%rowtype;
  v_case_id uuid;
  v_booking_id uuid;
  v_voucher_id uuid;
  v_voucher_version integer;
  v_voucher_hash text;
  v_case_payload jsonb;
  v_event_payload jsonb;
  v_case_authority_hash text;
  v_event_hash text;
  v_event_sequence integer;
  v_event_type text;
  v_visibility text;
  v_message text;
  v_next_status text;
  v_priority text;
  v_escalation_level text;
  v_actor_role text;
  v_actor_kind text;
  v_revoked_before timestamptz;
  v_result jsonb;
begin
  select * into v_existing from public.support_command_receipts
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_name <> p_command_name
      or v_existing.payload_hash <> p_payload_hash
    then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'IDEMPOTENCY_CONFLICT', null, p_payload_hash
      );
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in (
    'support.case.open', 'support.case.message', 'support.case.claim',
    'support.case.priority.set', 'support.case.escalate',
    'support.case.customer_update', 'support.case.internal_note',
    'support.case.resolve', 'support.case.close'
  ) then
    return private.support_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'UNREGISTERED_COMMAND', null, p_payload_hash
    );
  end if;
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_payload) <> 'object'
    or p_actor_session_id is null or p_actor_issued_at is null
    or p_actor_aal not in ('aal1', 'aal2')
  then
    return private.support_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'INVALID_COMMAND_CONTEXT', null, p_payload_hash
    );
  end if;
  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return private.support_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;
  select revoked_before into v_revoked_before from public.user_session_security
  where user_id = p_actor_id;
  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return private.support_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  if p_command_name in ('support.case.open', 'support.case.message') then
    select role into v_actor_role from public.role_assignments
    where user_id = p_actor_id and role = 'customer' and active limit 1;
    v_actor_kind := 'CUSTOMER';
    if v_actor_role is null then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'CUSTOMER_AUTHORITY_REQUIRED', null, p_payload_hash
      );
    end if;
    if (
      select count(*) from public.support_command_receipts
      where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
    ) >= 30 then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'RATE_LIMITED', null, p_payload_hash
      );
    end if;
  else
    if p_actor_aal <> 'aal2' then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'AAL2_REQUIRED', null, p_payload_hash
      );
    end if;
    select role into v_actor_role from public.role_assignments
    where user_id = p_actor_id and role in ('staff', 'manager', 'admin', 'founder') and active
    order by case role when 'founder' then 1 when 'admin' then 2 when 'manager' then 3 else 4 end
    limit 1;
    v_actor_kind := 'STAFF';
    if v_actor_role is null then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'SUPPORT_OPERATIONS_AUTHORITY_REQUIRED', null, p_payload_hash
      );
    end if;
    if (
      select count(*) from public.support_command_receipts
      where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
    ) >= 120 then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'RATE_LIMITED', null, p_payload_hash
      );
    end if;
  end if;

  begin
    v_case_id := nullif(p_payload->>'caseId', '')::uuid;
    v_booking_id := nullif(p_payload->>'bookingId', '')::uuid;
    v_voucher_id := nullif(p_payload->>'voucherId', '')::uuid;
    v_voucher_version := nullif(p_payload->>'voucherVersion', '')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_IDENTIFIER', null, p_payload_hash
      );
  end;
  v_voucher_hash := p_payload->>'voucherHash';

  if p_command_name = 'support.case.open' then
    if v_case_id is null or v_case_id <> p_command_id
      or v_booking_id is null or v_voucher_id is null or v_voucher_version is null
      or v_voucher_hash !~ '^[0-9a-f]{64}$'
    then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_ISSUED_VOUCHER_REQUIRED', null, p_payload_hash
      );
    end if;
    select * into v_booking from public.bookings where id = v_booking_id;
    select * into v_voucher from public.vouchers
      where id = v_voucher_id and booking_id = v_booking_id;
    if v_booking.id is null or v_booking.status <> 'VOUCHER_ISSUED'
      or v_booking.customer_id <> p_actor_id
      or v_booking.voucher_id <> v_voucher_id
      or v_booking.voucher_version <> v_voucher_version
      or v_booking.voucher_hash <> v_voucher_hash
      or v_voucher.id is null or v_voucher.status <> 'ISSUED'
      or v_voucher.customer_id <> p_actor_id
      or v_voucher.issued_version <> v_voucher_version
      or v_voucher.issued_hash <> v_voucher_hash
    then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_ISSUED_VOUCHER_REQUIRED', coalesce(v_booking_id::text, null), p_payload_hash
      );
    end if;
    if exists (
      select 1 from public.support_cases
      where booking_id = v_booking_id
        and status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
    ) then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'ACTIVE_SUPPORT_CASE_EXISTS', v_booking_id::text, p_payload_hash
      );
    end if;
    v_case_payload := p_payload->'casePayload';
    v_case_authority_hash := p_payload->>'caseAuthorityHash';
    if v_case_authority_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_support_case_open_payload(v_case_payload)
      or v_case_payload->>'caseId' <> v_case_id::text
      or v_case_payload->>'bookingId' <> v_booking_id::text
      or v_case_payload->>'voucherId' <> v_voucher_id::text
      or (v_case_payload->>'voucherVersion')::integer <> v_voucher_version
      or v_case_payload->>'voucherHash' <> v_voucher_hash
      or v_case_payload->>'customerId' <> p_actor_id::text
      or v_case_payload->>'locale' <> v_booking.locale
    then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_SUPPORT_CASE', v_case_id::text, p_payload_hash
      );
    end if;
    v_priority := case when v_case_payload->>'urgency' = 'URGENT'
      then 'P2_HIGH' else 'P3_NORMAL' end;
    insert into public.support_cases (
      id, booking_id, voucher_id, voucher_version, voucher_hash,
      customer_id, locale, category, subject, priority,
      case_authority_hash, current_event_hash
    ) values (
      v_case_id, v_booking_id, v_voucher_id, v_voucher_version, v_voucher_hash,
      p_actor_id, v_booking.locale, v_case_payload->>'category',
      btrim(v_case_payload->>'subject'), v_priority,
      v_case_authority_hash, v_case_authority_hash
    );
    insert into public.support_case_events (
      id, case_id, case_authority_hash, booking_id, customer_id,
      event_sequence, event_type, visibility, message,
      canonical_payload, event_hash, actor_id, actor_kind,
      actor_session_id, actor_aal
    ) values (
      p_command_id, v_case_id, v_case_authority_hash, v_booking_id, p_actor_id,
      1, 'CASE_OPENED', 'CUSTOMER', btrim(v_case_payload->>'message'),
      v_case_payload, v_case_authority_hash, p_actor_id, 'CUSTOMER',
      p_actor_session_id, p_actor_aal
    );
    v_event_sequence := 1;
    v_event_hash := v_case_authority_hash;
    v_event_type := 'CASE_OPENED';
    v_next_status := 'OPEN';
    v_escalation_level := 'NONE';
  else
    if v_case_id is null then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'SUPPORT_CASE_REQUIRED', null, p_payload_hash
      );
    end if;
    select * into v_case from public.support_cases where id = v_case_id for update;
    if not found then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'SUPPORT_CASE_NOT_FOUND', v_case_id::text, p_payload_hash
      );
    end if;
    if p_command_name = 'support.case.message' and v_case.customer_id <> p_actor_id then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'SUPPORT_CASE_NOT_FOUND', v_case_id::text, p_payload_hash
      );
    end if;
    if p_command_name not in ('support.case.message', 'support.case.claim', 'support.case.priority.set')
      and v_case.owner_id is distinct from p_actor_id
      and v_actor_role not in ('manager', 'admin', 'founder')
    then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'CASE_OWNER_REQUIRED', v_case_id::text, p_payload_hash
      );
    end if;

    v_event_payload := p_payload->'eventPayload';
    v_event_hash := p_payload->>'eventHash';
    if v_event_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_support_case_event_payload(v_event_payload)
      or v_event_payload->>'caseId' <> v_case_id::text
      or v_event_payload->>'caseAuthorityHash' <> v_case.case_authority_hash
      or (v_event_payload->>'eventSequence')::integer <> v_case.current_event_sequence + 1
      or v_event_payload->>'previousEventHash' <> v_case.current_event_hash
    then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_SUPPORT_EVENT', v_case_id::text, p_payload_hash
      );
    end if;
    v_event_sequence := (v_event_payload->>'eventSequence')::integer;
    v_event_type := v_event_payload->>'eventType';
    v_visibility := v_event_payload->>'visibility';
    v_message := btrim(v_event_payload->>'message');
    v_next_status := nullif(v_event_payload->>'nextStatus', '');
    v_priority := nullif(v_event_payload->>'priority', '');
    v_escalation_level := nullif(v_event_payload->>'escalationLevel', '');

    if p_command_name = 'support.case.message' then
      if v_case.status in ('RESOLVED', 'CLOSED')
        or v_event_type <> 'CUSTOMER_MESSAGE' or v_visibility <> 'CUSTOMER'
        or v_next_status is not null or v_priority is not null or v_escalation_level is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPORT_CASE_STATE', v_case_id::text, p_payload_hash
        );
      end if;
      v_next_status := v_case.status;
      v_priority := v_case.priority;
      v_escalation_level := v_case.escalation_level;

    elsif p_command_name = 'support.case.claim' then
      if v_case.status <> 'OPEN' or v_case.owner_id is not null
        or v_event_type <> 'CASE_CLAIMED' or v_visibility <> 'INTERNAL'
        or v_next_status is not null or v_priority is not null or v_escalation_level is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'CASE_ASSIGNMENT_STATE_REQUIRED', v_case_id::text, p_payload_hash
        );
      end if;
      v_next_status := 'ASSIGNED';
      v_priority := v_case.priority;
      v_escalation_level := v_case.escalation_level;

    elsif p_command_name = 'support.case.priority.set' then
      if v_actor_role not in ('manager', 'admin', 'founder')
        or v_case.status = 'CLOSED' or v_priority is null or v_priority = v_case.priority
        or v_event_type <> 'PRIORITY_CHANGED' or v_visibility <> 'INTERNAL'
        or v_next_status is not null or v_escalation_level is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'PRIORITY_AUTHORITY_REQUIRED', v_case_id::text, p_payload_hash
        );
      end if;
      v_next_status := v_case.status;
      v_escalation_level := v_case.escalation_level;

    elsif p_command_name = 'support.case.escalate' then
      if v_case.status in ('RESOLVED', 'CLOSED')
        or v_event_type <> 'CASE_ESCALATED' or v_visibility <> 'INTERNAL'
        or v_escalation_level not in ('MANAGER', 'FOUNDER')
        or (case v_case.escalation_level when 'NONE' then 0 when 'MANAGER' then 1 else 2 end)
          >= (case v_escalation_level when 'MANAGER' then 1 else 2 end)
        or (v_escalation_level = 'FOUNDER' and v_actor_role = 'staff')
        or v_next_status is not null or v_priority is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_ESCALATION', v_case_id::text, p_payload_hash
        );
      end if;
      v_next_status := v_case.status;
      v_priority := v_case.priority;

    elsif p_command_name = 'support.case.customer_update' then
      if v_case.status not in ('ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
        or v_event_type <> 'CUSTOMER_UPDATE' or v_visibility <> 'CUSTOMER'
        or v_next_status not in ('IN_PROGRESS', 'WAITING_CUSTOMER')
        or v_priority is not null or v_escalation_level is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPORT_CASE_STATE', v_case_id::text, p_payload_hash
        );
      end if;
      v_priority := v_case.priority;
      v_escalation_level := v_case.escalation_level;

    elsif p_command_name = 'support.case.internal_note' then
      if v_case.status in ('RESOLVED', 'CLOSED')
        or v_event_type <> 'INTERNAL_NOTE' or v_visibility <> 'INTERNAL'
        or v_next_status is not null or v_priority is not null or v_escalation_level is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPORT_CASE_STATE', v_case_id::text, p_payload_hash
        );
      end if;
      v_next_status := v_case.status;
      v_priority := v_case.priority;
      v_escalation_level := v_case.escalation_level;

    elsif p_command_name = 'support.case.resolve' then
      if v_case.status not in ('ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
        or v_event_type <> 'CASE_RESOLVED' or v_visibility <> 'CUSTOMER'
        or v_next_status <> 'RESOLVED' or v_priority is not null or v_escalation_level is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPORT_CASE_STATE', v_case_id::text, p_payload_hash
        );
      end if;
      v_priority := v_case.priority;
      v_escalation_level := v_case.escalation_level;

    else
      if v_case.status <> 'RESOLVED'
        or v_event_type <> 'CASE_CLOSED' or v_visibility <> 'CUSTOMER'
        or v_next_status <> 'CLOSED' or v_priority is not null or v_escalation_level is not null
      then
        return private.support_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPORT_CASE_STATE', v_case_id::text, p_payload_hash
        );
      end if;
      v_priority := v_case.priority;
      v_escalation_level := v_case.escalation_level;
    end if;

    insert into public.support_case_events (
      id, case_id, case_authority_hash, booking_id, customer_id,
      event_sequence, previous_event_sequence, previous_event_hash,
      event_type, visibility, message, canonical_payload, event_hash,
      actor_id, actor_kind, actor_session_id, actor_aal
    ) values (
      p_command_id, v_case.id, v_case.case_authority_hash,
      v_case.booking_id, v_case.customer_id, v_event_sequence,
      v_case.current_event_sequence, v_case.current_event_hash,
      v_event_type, v_visibility, v_message, v_event_payload, v_event_hash,
      p_actor_id, v_actor_kind, p_actor_session_id, p_actor_aal
    );
    update public.support_cases set
      status = v_next_status,
      priority = v_priority,
      escalation_level = v_escalation_level,
      owner_id = case when p_command_name = 'support.case.claim' then p_actor_id else owner_id end,
      current_event_sequence = v_event_sequence,
      current_event_hash = v_event_hash,
      first_response_at = case
        when p_command_name in ('support.case.customer_update', 'support.case.resolve')
          then coalesce(first_response_at, now())
        else first_response_at end,
      resolved_at = case when p_command_name = 'support.case.resolve' then now() else resolved_at end,
      closed_at = case when p_command_name = 'support.case.close' then now() else closed_at end,
      updated_at = now()
    where id = v_case_id;
  end if;

  v_result := jsonb_strip_nulls(jsonb_build_object(
    'status', 'accepted', 'commandName', p_command_name,
    'caseId', v_case_id, 'caseStatus', v_next_status,
    'priority', v_priority, 'escalationLevel', v_escalation_level,
    'ownerId', case when p_command_name = 'support.case.claim'
      then p_actor_id else v_case.owner_id end,
    'eventId', p_command_id, 'eventSequence', v_event_sequence,
    'eventHash', v_event_hash
  ));
  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal,
    p_command_name, 'accepted', null, 'support_case', v_case_id::text,
    v_event_hash,
    jsonb_build_object(
      'eventType', v_event_type, 'visibility', coalesce(v_visibility, 'CUSTOMER'),
      'caseStatus', v_next_status, 'priority', v_priority,
      'escalationLevel', v_escalation_level, 'actorRole', v_actor_role,
      'financialAuthorityUnaffected', true
    )
  );
  insert into public.support_command_receipts (
    idempotency_key, command_id, command_name, actor_id,
    payload_hash, response, expires_at
  ) values (
    p_idempotency_key, p_command_id, p_command_name, p_actor_id,
    p_payload_hash, v_result, now() + interval '24 hours'
  );
  return v_result;
exception
  when unique_violation then
    select response into v_result from public.support_command_receipts
    where idempotency_key = p_idempotency_key
      and command_name = p_command_name and payload_hash = p_payload_hash;
    if found then return v_result; end if;
    if p_command_name = 'support.case.open' and exists (
      select 1 from public.support_cases
      where booking_id = v_booking_id
        and status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
    ) then
      return private.support_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'ACTIVE_SUPPORT_CASE_EXISTS', v_booking_id::text, p_payload_hash
      );
    end if;
    raise;
end;
$$;

alter table public.support_cases enable row level security;
alter table public.support_cases force row level security;
alter table public.support_case_events enable row level security;
alter table public.support_case_events force row level security;
alter table public.support_command_receipts enable row level security;
alter table public.support_command_receipts force row level security;

create policy support_cases_select_owner_or_aal2_operations
on public.support_cases for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'admin', 'founder') and active
    )
  )
);

create policy support_case_events_select_customer_safe_owner_or_aal2_operations
on public.support_case_events for select to authenticated
using (
  (customer_id = (select auth.uid()) and visibility = 'CUSTOMER')
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'admin', 'founder') and active
    )
  )
);

revoke all on table public.support_cases from anon, authenticated;
grant select (
  id, booking_id, voucher_id, voucher_version, voucher_hash,
  customer_id, locale, category, subject, status, priority,
  opened_at, updated_at, first_response_at, resolved_at, closed_at
) on table public.support_cases to authenticated;

revoke all on table public.support_case_events from anon, authenticated;
grant select (
  id, case_id, customer_id, event_sequence, event_type,
  visibility, message, occurred_at
) on table public.support_case_events to authenticated;

revoke all on table public.support_command_receipts from anon, authenticated;

grant select, insert, update on table public.support_cases to service_role;
grant select, insert on table public.support_case_events to service_role;
grant select, insert on table public.support_command_receipts to service_role;

revoke all on function private.reject_support_evidence_mutation()
  from public, anon, authenticated;
revoke all on function private.guard_support_case_update()
  from public, anon, authenticated;
revoke all on function private.is_valid_support_case_open_payload(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_valid_support_case_event_payload(jsonb)
  from public, anon, authenticated;
grant execute on function private.is_valid_support_case_open_payload(jsonb) to service_role;
grant execute on function private.is_valid_support_case_event_payload(jsonb) to service_role;
revoke all on function private.support_denial_result(
  uuid, text, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.support_denial_result(
  uuid, text, uuid, uuid, text, text, text, text
) to service_role;
revoke all on function public.execute_support_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from public, anon, authenticated;
grant execute on function public.execute_support_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) to service_role;

comment on table public.support_cases is
  'Customer-owned Support aggregate bound to one exact issued Voucher. It carries no financial or Booking authority.';
comment on table public.support_case_events is
  'Immutable SHA-256-linked Support event chain separating Customer-safe updates from internal notes.';
comment on function public.execute_support_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) is
  'Service-secret-only gateway for Customer Support requests and accountable AAL2 human operations.';
