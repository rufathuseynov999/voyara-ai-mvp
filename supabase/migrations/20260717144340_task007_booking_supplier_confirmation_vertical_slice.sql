-- VOYARA AI Task 007: Booking creation, accountable human Supplier execution,
-- and immutable Supplier Confirmation capture.
-- Supplier Confirmation is evidence only. This migration intentionally creates
-- no Booking Verification, Voucher, Credit, Refund or autonomous Supplier action.

create table public.bookings (
  id uuid primary key,
  payment_request_id uuid not null unique references public.payment_requests (id) on delete restrict,
  readiness_evaluation_id uuid not null unique,
  readiness_evaluation_hash text not null,
  acceptance_id uuid not null unique,
  quotation_id uuid not null unique references public.commercial_quotations (id) on delete restrict,
  quotation_version integer not null,
  quotation_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  locale text not null,
  currency text not null,
  amount_minor bigint not null,
  status text not null default 'CREATED',
  canonical_authority_payload jsonb not null,
  booking_authority_hash text not null,
  current_execution_id uuid,
  current_execution_hash text,
  supplier_confirmation_id uuid,
  supplier_confirmation_hash text,
  created_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supplier_executed_at timestamptz,
  supplier_confirmed_at timestamptz,
  unique (id, booking_authority_hash),
  foreign key (payment_request_id, readiness_evaluation_id, readiness_evaluation_hash)
    references public.financial_readiness_evaluations
      (payment_request_id, id, evaluation_hash) on delete restrict,
  foreign key (acceptance_id, quotation_id, quotation_version, quotation_hash, customer_id)
    references public.customer_quotation_acceptances
      (id, quotation_id, version_number, payload_hash, customer_id) on delete restrict,
  constraint bookings_version_check check (quotation_version > 0),
  constraint bookings_hash_check check (quotation_hash ~ '^[0-9a-f]{64}$'),
  constraint bookings_readiness_hash_check check (readiness_evaluation_hash ~ '^[0-9a-f]{64}$'),
  constraint bookings_locale_check check (locale in ('az', 'ru', 'en')),
  constraint bookings_currency_check check (currency = 'AZN'),
  constraint bookings_amount_check check (amount_minor between 1 and 1000000000000),
  constraint bookings_status_check check (status in (
    'CREATED', 'SUPPLIER_EXECUTED', 'SUPPLIER_CONFIRMED'
  )),
  constraint bookings_authority_payload_check check (jsonb_typeof(canonical_authority_payload) = 'object'),
  constraint bookings_authority_hash_check check (booking_authority_hash ~ '^[0-9a-f]{64}$'),
  constraint bookings_execution_pointer_check check (
    (current_execution_id is null and current_execution_hash is null)
    or (current_execution_id is not null and current_execution_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint bookings_confirmation_pointer_check check (
    (supplier_confirmation_id is null and supplier_confirmation_hash is null)
    or (supplier_confirmation_id is not null and supplier_confirmation_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint bookings_state_pointer_check check (
    (status = 'CREATED'
      and current_execution_id is null and supplier_confirmation_id is null
      and supplier_executed_at is null and supplier_confirmed_at is null)
    or (status = 'SUPPLIER_EXECUTED'
      and current_execution_id is not null and supplier_confirmation_id is null
      and supplier_executed_at is not null and supplier_confirmed_at is null)
    or (status = 'SUPPLIER_CONFIRMED'
      and current_execution_id is not null and supplier_confirmation_id is not null
      and supplier_executed_at is not null and supplier_confirmed_at is not null)
  ),
  constraint bookings_aal_check check (actor_aal = 'aal2')
);

create index bookings_customer_created_idx
  on public.bookings (customer_id, created_at desc);
create index bookings_operations_queue_idx
  on public.bookings (status, updated_at asc);

create table public.supplier_booking_executions (
  id uuid primary key,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  booking_authority_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  supplier_name text not null,
  channel text not null,
  canonical_payload jsonb not null,
  execution_hash text not null,
  executed_at timestamptz not null,
  executed_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  recorded_at timestamptz not null default now(),
  unique (booking_id, id, execution_hash),
  foreign key (booking_id, booking_authority_hash)
    references public.bookings (id, booking_authority_hash) on delete restrict,
  constraint supplier_executions_name_check check (char_length(btrim(supplier_name)) between 2 and 120),
  constraint supplier_executions_channel_check check (channel in (
    'SUPPLIER_PORTAL', 'EMAIL', 'PHONE', 'MESSAGING'
  )),
  constraint supplier_executions_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint supplier_executions_hash_check check (execution_hash ~ '^[0-9a-f]{64}$'),
  constraint supplier_executions_aal_check check (actor_aal = 'aal2')
);

create table public.supplier_confirmations (
  id uuid primary key,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  execution_id uuid not null unique,
  execution_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  supplier_name text not null,
  channel text not null,
  confirmation_reference text not null,
  canonical_payload jsonb not null,
  confirmation_hash text not null,
  supplier_confirmed_at timestamptz not null,
  captured_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  captured_at timestamptz not null default now(),
  unique (booking_id, id, confirmation_hash),
  foreign key (booking_id, execution_id, execution_hash)
    references public.supplier_booking_executions
      (booking_id, id, execution_hash) on delete restrict,
  constraint supplier_confirmations_name_check check (char_length(btrim(supplier_name)) between 2 and 120),
  constraint supplier_confirmations_channel_check check (channel in (
    'SUPPLIER_PORTAL', 'EMAIL', 'PHONE', 'MESSAGING'
  )),
  constraint supplier_confirmations_reference_check check (
    char_length(btrim(confirmation_reference)) between 3 and 120
  ),
  constraint supplier_confirmations_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint supplier_confirmations_execution_hash_check check (execution_hash ~ '^[0-9a-f]{64}$'),
  constraint supplier_confirmations_hash_check check (confirmation_hash ~ '^[0-9a-f]{64}$'),
  constraint supplier_confirmations_aal_check check (actor_aal = 'aal2')
);

create table public.booking_work_receipts (
  command_id uuid primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  quotation_id uuid not null references public.commercial_quotations (id) on delete restrict,
  action text not null,
  actor_role text not null,
  from_status text,
  to_status text not null,
  authority_hash text not null,
  occurred_at timestamptz not null default now(),
  constraint booking_work_receipts_action_check check (action in (
    'booking.create', 'supplier_booking.complete', 'supplier_confirmation.capture'
  )),
  constraint booking_work_receipts_role_check check (actor_role in (
    'staff', 'manager', 'admin', 'founder'
  )),
  constraint booking_work_receipts_from_check check (
    from_status is null or from_status in ('CREATED', 'SUPPLIER_EXECUTED')
  ),
  constraint booking_work_receipts_to_check check (to_status in (
    'CREATED', 'SUPPLIER_EXECUTED', 'SUPPLIER_CONFIRMED'
  )),
  constraint booking_work_receipts_hash_check check (authority_hash ~ '^[0-9a-f]{64}$')
);

create index booking_work_receipts_customer_idx
  on public.booking_work_receipts (customer_id, occurred_at desc);
create index booking_work_receipts_booking_idx
  on public.booking_work_receipts (booking_id, occurred_at, command_id);

create table public.booking_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint booking_command_receipts_key_check check (
    char_length(idempotency_key) between 12 and 160
  ),
  constraint booking_command_receipts_name_check check (command_name in (
    'booking.create', 'supplier_booking.complete', 'supplier_confirmation.capture'
  )),
  constraint booking_command_receipts_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_command_receipts_response_check check (jsonb_typeof(response) = 'object'),
  constraint booking_command_receipts_expiry_check check (expires_at > created_at)
);

create index booking_command_receipts_actor_created_idx
  on public.booking_command_receipts (actor_id, created_at desc);
create index booking_command_receipts_expires_idx
  on public.booking_command_receipts (expires_at);

alter table public.bookings
  add constraint bookings_current_execution_fk
  foreign key (id, current_execution_id, current_execution_hash)
    references public.supplier_booking_executions (booking_id, id, execution_hash)
    on delete restrict;

alter table public.bookings
  add constraint bookings_supplier_confirmation_fk
  foreign key (id, supplier_confirmation_id, supplier_confirmation_hash)
    references public.supplier_confirmations (booking_id, id, confirmation_hash)
    on delete restrict;

create or replace function private.reject_booking_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'booking authority evidence is append-only' using errcode = '55000';
end;
$$;

create trigger supplier_booking_executions_immutable
before update or delete on public.supplier_booking_executions
for each row execute function private.reject_booking_evidence_mutation();
create trigger supplier_confirmations_immutable
before update or delete on public.supplier_confirmations
for each row execute function private.reject_booking_evidence_mutation();
create trigger booking_work_receipts_immutable
before update or delete on public.booking_work_receipts
for each row execute function private.reject_booking_evidence_mutation();

create or replace function private.guard_booking_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.payment_request_id <> old.payment_request_id
    or new.readiness_evaluation_id <> old.readiness_evaluation_id
    or new.readiness_evaluation_hash <> old.readiness_evaluation_hash
    or new.acceptance_id <> old.acceptance_id
    or new.quotation_id <> old.quotation_id
    or new.quotation_version <> old.quotation_version
    or new.quotation_hash <> old.quotation_hash
    or new.customer_id <> old.customer_id
    or new.locale <> old.locale
    or new.currency <> old.currency
    or new.amount_minor <> old.amount_minor
    or new.canonical_authority_payload <> old.canonical_authority_payload
    or new.booking_authority_hash <> old.booking_authority_hash
    or new.created_by <> old.created_by
    or new.actor_session_id <> old.actor_session_id
    or new.actor_aal <> old.actor_aal
    or new.created_at <> old.created_at
  then
    raise exception 'booking authority identity is immutable' using errcode = '55000';
  end if;

  if (old.status = 'CREATED' and new.status = 'SUPPLIER_EXECUTED'
      and old.current_execution_id is null and new.current_execution_id is not null
      and new.supplier_confirmation_id is null)
    or (old.status = 'SUPPLIER_EXECUTED' and new.status = 'SUPPLIER_CONFIRMED'
      and new.current_execution_id = old.current_execution_id
      and new.current_execution_hash = old.current_execution_hash
      and old.supplier_confirmation_id is null and new.supplier_confirmation_id is not null)
  then
    return new;
  end if;

  raise exception 'invalid or non-monotonic booking transition' using errcode = '55000';
end;
$$;

create trigger bookings_guarded
before update on public.bookings
for each row execute function private.guard_booking_update();

create or replace function private.is_valid_booking_creation_payload(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_payload) = 'object'
    and p_payload->>'schemaVersion' = 'booking-creation-v1'
    and coalesce(p_payload->>'paymentRequestId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'readinessEvaluationId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'readinessHash', '') ~ '^[0-9a-f]{64}$'
    and coalesce(p_payload->>'acceptanceId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'quotationId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'quotationVersion', '') ~ '^[1-9][0-9]*$'
    and coalesce(p_payload->>'quotationHash', '') ~ '^[0-9a-f]{64}$';
$$;

create or replace function private.is_valid_supplier_execution_payload(p_payload jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_executed_at timestamptz;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'schemaVersion' <> 'supplier-execution-v1'
    or coalesce(p_payload->>'bookingId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_payload->>'channel' not in ('SUPPLIER_PORTAL', 'EMAIL', 'PHONE', 'MESSAGING')
    or char_length(btrim(coalesce(p_payload->>'supplierName', ''))) not between 2 and 120
    or char_length(btrim(coalesce(p_payload->>'requestReference', ''))) not between 3 and 120
    or char_length(btrim(coalesce(p_payload->>'serviceSummary', ''))) not between 3 and 500
    or char_length(coalesce(p_payload->>'note', '')) > 500
    or p_payload->>'declarationConfirmed' <> 'true'
  then
    return false;
  end if;
  v_executed_at := (p_payload->>'executedAt')::timestamptz;
  return v_executed_at <= now() + interval '5 minutes';
exception
  when invalid_text_representation or datetime_field_overflow then
    return false;
end;
$$;

create or replace function private.is_valid_supplier_confirmation_payload(p_payload jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_confirmed_at timestamptz;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'schemaVersion' <> 'supplier-confirmation-v1'
    or coalesce(p_payload->>'bookingId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'executionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'executionHash', '') !~ '^[0-9a-f]{64}$'
    or char_length(btrim(coalesce(p_payload->>'supplierName', ''))) not between 2 and 120
    or p_payload->>'channel' not in ('SUPPLIER_PORTAL', 'EMAIL', 'PHONE', 'MESSAGING')
    or char_length(btrim(coalesce(p_payload->>'confirmationReference', ''))) not between 3 and 120
    or char_length(btrim(coalesce(p_payload->>'serviceSummary', ''))) not between 3 and 500
    or char_length(coalesce(p_payload->>'note', '')) > 500
    or p_payload->>'declarationConfirmed' <> 'true'
  then
    return false;
  end if;
  v_confirmed_at := (p_payload->>'confirmedAt')::timestamptz;
  return v_confirmed_at <= now() + interval '5 minutes';
exception
  when invalid_text_representation or datetime_field_overflow then
    return false;
end;
$$;

create or replace function private.booking_denial_result(
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
    p_command_id,
    p_actor_id,
    p_actor_session_id,
    p_actor_aal,
    p_command_name,
    'denied',
    p_reason_code,
    'booking',
    coalesce(p_entity_id, p_command_id::text),
    case when p_payload_hash ~ '^[0-9a-f]{64}$' then p_payload_hash else repeat('0', 64) end,
    '{}'::jsonb
  );
  return jsonb_build_object('status', 'denied', 'reasonCode', p_reason_code);
end;
$$;

create or replace function public.execute_booking_command(
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
  v_existing public.booking_command_receipts%rowtype;
  v_payment public.payment_requests%rowtype;
  v_readiness public.financial_readiness_evaluations%rowtype;
  v_quote public.commercial_quotations%rowtype;
  v_booking public.bookings%rowtype;
  v_execution public.supplier_booking_executions%rowtype;
  v_result jsonb;
  v_booking_id uuid;
  v_payment_request_id uuid;
  v_readiness_id uuid;
  v_readiness_hash text;
  v_execution_id uuid;
  v_execution_hash text;
  v_confirmation_id uuid;
  v_confirmation_hash text;
  v_canonical_payload jsonb;
  v_authority_hash text;
  v_from_status text;
  v_to_status text;
  v_actor_role text;
  v_revoked_before timestamptz;
begin
  select * into v_existing
  from public.booking_command_receipts
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.command_name <> p_command_name or v_existing.payload_hash <> p_payload_hash then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'IDEMPOTENCY_CONFLICT', null, p_payload_hash
      );
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in (
    'booking.create', 'supplier_booking.complete', 'supplier_confirmation.capture'
  ) then
    return private.booking_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'UNREGISTERED_COMMAND', null, p_payload_hash
    );
  end if;

  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_payload) <> 'object'
  then
    return private.booking_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'INVALID_PAYLOAD', null, p_payload_hash
    );
  end if;

  if p_actor_session_id is null or p_actor_issued_at is null or p_actor_aal <> 'aal2' then
    return private.booking_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'AAL2_REQUIRED', null, p_payload_hash
    );
  end if;

  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return private.booking_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  select revoked_before into v_revoked_before
  from public.user_session_security
  where user_id = p_actor_id;
  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return private.booking_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  select role into v_actor_role
  from public.role_assignments
  where user_id = p_actor_id
    and role in ('staff', 'manager', 'admin', 'founder') and active
  order by case role
    when 'founder' then 1 when 'admin' then 2 when 'manager' then 3 else 4
  end
  limit 1;
  if v_actor_role is null then
    return private.booking_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'BOOKING_OPERATIONS_AUTHORITY_REQUIRED', null, p_payload_hash
    );
  end if;

  if (
    select count(*) from public.booking_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
  ) >= 120 then
    return private.booking_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'RATE_LIMITED', null, p_payload_hash
    );
  end if;

  begin
    v_booking_id := nullif(p_payload->>'bookingId', '')::uuid;
    v_payment_request_id := nullif(p_payload->>'paymentRequestId', '')::uuid;
    v_readiness_id := nullif(p_payload->>'readinessEvaluationId', '')::uuid;
    v_execution_id := nullif(p_payload->>'executionId', '')::uuid;
  exception
    when invalid_text_representation then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_IDENTIFIER', null, p_payload_hash
      );
  end;
  v_readiness_hash := p_payload->>'readinessHash';
  v_execution_hash := p_payload->>'executionHash';

  if p_command_name = 'booking.create' then
    if v_payment_request_id is null or v_readiness_id is null
      or v_readiness_hash is null or v_readiness_hash !~ '^[0-9a-f]{64}$'
    then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'FINANCIAL_READINESS_REQUIRED', coalesce(v_payment_request_id::text, p_command_id::text), p_payload_hash
      );
    end if;

    select * into v_payment from public.payment_requests
    where id = v_payment_request_id for update;
    if not found
      or v_payment.status <> 'READY_FOR_BOOKING'
      or v_payment.readiness_result <> 'READY_FOR_BOOKING'
      or v_payment.readiness_evaluation_id <> v_readiness_id
      or v_payment.readiness_evaluation_hash <> v_readiness_hash
    then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'FINANCIAL_READINESS_REQUIRED', v_payment_request_id::text, p_payload_hash
      );
    end if;

    select * into v_readiness from public.financial_readiness_evaluations
    where payment_request_id = v_payment_request_id
      and id = v_readiness_id and evaluation_hash = v_readiness_hash;
    if not found
      or v_readiness.result <> 'READY_FOR_BOOKING'
      or v_readiness.customer_id <> v_payment.customer_id
      or v_readiness.quotation_id <> v_payment.quotation_id
      or v_readiness.quotation_version <> v_payment.quotation_version
      or v_readiness.quotation_hash <> v_payment.quotation_hash
      or v_readiness.acceptance_id <> v_payment.acceptance_id
    then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_READINESS_EVIDENCE_REQUIRED', v_payment_request_id::text, p_payload_hash
      );
    end if;

    select * into v_quote from public.commercial_quotations
    where id = v_payment.quotation_id;
    if not found or v_quote.status <> 'ACCEPTED'
      or v_quote.current_version <> v_payment.quotation_version
      or v_quote.current_hash <> v_payment.quotation_hash
      or v_quote.approved_version <> v_payment.quotation_version
      or v_quote.approved_hash <> v_payment.quotation_hash
      or v_quote.published_version <> v_payment.quotation_version
      or v_quote.published_hash <> v_payment.quotation_hash
      or not exists (
        select 1 from public.customer_quotation_acceptances
        where id = v_payment.acceptance_id
          and quotation_id = v_payment.quotation_id
          and version_number = v_payment.quotation_version
          and payload_hash = v_payment.quotation_hash
          and customer_id = v_payment.customer_id
      )
    then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_ACCEPTANCE_REQUIRED', v_payment.quotation_id::text, p_payload_hash
      );
    end if;

    if exists (
      select 1 from public.bookings
      where payment_request_id = v_payment_request_id or quotation_id = v_payment.quotation_id
    ) then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'BOOKING_EXISTS', v_payment_request_id::text, p_payload_hash
      );
    end if;

    v_canonical_payload := p_payload->'bookingPayload';
    v_authority_hash := p_payload->>'bookingHash';
    if v_authority_hash is null or v_authority_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_booking_creation_payload(v_canonical_payload)
      or v_canonical_payload->>'paymentRequestId' <> v_payment_request_id::text
      or v_canonical_payload->>'readinessEvaluationId' <> v_readiness_id::text
      or v_canonical_payload->>'readinessHash' <> v_readiness_hash
      or v_canonical_payload->>'acceptanceId' <> v_payment.acceptance_id::text
      or v_canonical_payload->>'quotationId' <> v_payment.quotation_id::text
      or (v_canonical_payload->>'quotationVersion')::integer <> v_payment.quotation_version
      or v_canonical_payload->>'quotationHash' <> v_payment.quotation_hash
    then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_BOOKING_AUTHORITY', v_payment_request_id::text, p_payload_hash
      );
    end if;

    v_booking_id := p_command_id;
    insert into public.bookings (
      id, payment_request_id, readiness_evaluation_id, readiness_evaluation_hash,
      acceptance_id, quotation_id, quotation_version, quotation_hash, customer_id,
      locale, currency, amount_minor, canonical_authority_payload,
      booking_authority_hash, created_by, actor_session_id, actor_aal
    ) values (
      v_booking_id, v_payment_request_id, v_readiness_id, v_readiness_hash,
      v_payment.acceptance_id, v_payment.quotation_id, v_payment.quotation_version,
      v_payment.quotation_hash, v_payment.customer_id, v_payment.locale,
      v_payment.currency, v_payment.amount_minor, v_canonical_payload,
      v_authority_hash, p_actor_id, p_actor_session_id, p_actor_aal
    );
    select * into v_booking from public.bookings where id = v_booking_id;
    v_from_status := null;
    v_to_status := 'CREATED';

  else
    if v_booking_id is null then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'BOOKING_REQUIRED', null, p_payload_hash
      );
    end if;
    select * into v_booking from public.bookings
    where id = v_booking_id for update;
    if not found then
      return private.booking_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'BOOKING_NOT_FOUND', v_booking_id::text, p_payload_hash
      );
    end if;

    if p_command_name = 'supplier_booking.complete' then
      if v_booking.status <> 'CREATED' then
        return private.booking_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'SUPPLIER_EXECUTION_NOT_ALLOWED_IN_STATE', v_booking_id::text, p_payload_hash
        );
      end if;
      v_canonical_payload := p_payload->'executionPayload';
      v_execution_hash := p_payload->>'executionHash';
      if v_execution_hash is null or v_execution_hash !~ '^[0-9a-f]{64}$'
        or not private.is_valid_supplier_execution_payload(v_canonical_payload)
        or v_canonical_payload->>'bookingId' <> v_booking_id::text
      then
        return private.booking_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPLIER_EXECUTION', v_booking_id::text, p_payload_hash
        );
      end if;

      v_execution_id := p_command_id;
      insert into public.supplier_booking_executions (
        id, booking_id, booking_authority_hash, customer_id, supplier_name,
        channel, canonical_payload, execution_hash, executed_at, executed_by,
        actor_session_id, actor_aal
      ) values (
        v_execution_id, v_booking_id, v_booking.booking_authority_hash,
        v_booking.customer_id, btrim(v_canonical_payload->>'supplierName'),
        v_canonical_payload->>'channel', v_canonical_payload, v_execution_hash,
        (v_canonical_payload->>'executedAt')::timestamptz, p_actor_id,
        p_actor_session_id, p_actor_aal
      );
      v_from_status := 'CREATED';
      v_to_status := 'SUPPLIER_EXECUTED';
      v_authority_hash := v_execution_hash;
      update public.bookings
      set status = v_to_status, current_execution_id = v_execution_id,
          current_execution_hash = v_execution_hash,
          supplier_executed_at = now(), updated_at = now()
      where id = v_booking_id;

    else
      if v_booking.status <> 'SUPPLIER_EXECUTED'
        or v_execution_id is null or v_execution_hash !~ '^[0-9a-f]{64}$'
        or v_booking.current_execution_id <> v_execution_id
        or v_booking.current_execution_hash <> v_execution_hash
      then
        return private.booking_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_SUPPLIER_EXECUTION_REQUIRED', v_booking_id::text, p_payload_hash
        );
      end if;
      select * into v_execution from public.supplier_booking_executions
      where booking_id = v_booking_id and id = v_execution_id
        and execution_hash = v_execution_hash;
      if not found then
        return private.booking_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_SUPPLIER_EXECUTION_REQUIRED', v_booking_id::text, p_payload_hash
        );
      end if;

      v_canonical_payload := p_payload->'confirmationPayload';
      v_confirmation_hash := p_payload->>'confirmationHash';
      if v_confirmation_hash is null or v_confirmation_hash !~ '^[0-9a-f]{64}$'
        or not private.is_valid_supplier_confirmation_payload(v_canonical_payload)
        or v_canonical_payload->>'bookingId' <> v_booking_id::text
        or v_canonical_payload->>'executionId' <> v_execution_id::text
        or v_canonical_payload->>'executionHash' <> v_execution_hash
        or v_canonical_payload->>'supplierName' <> v_execution.supplier_name
      then
        return private.booking_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPLIER_CONFIRMATION', v_booking_id::text, p_payload_hash
        );
      end if;

      v_confirmation_id := p_command_id;
      insert into public.supplier_confirmations (
        id, booking_id, execution_id, execution_hash, customer_id, supplier_name,
        channel, confirmation_reference, canonical_payload, confirmation_hash,
        supplier_confirmed_at, captured_by, actor_session_id, actor_aal
      ) values (
        v_confirmation_id, v_booking_id, v_execution_id, v_execution_hash,
        v_booking.customer_id, v_execution.supplier_name,
        v_canonical_payload->>'channel',
        btrim(v_canonical_payload->>'confirmationReference'),
        v_canonical_payload, v_confirmation_hash,
        (v_canonical_payload->>'confirmedAt')::timestamptz,
        p_actor_id, p_actor_session_id, p_actor_aal
      );
      v_from_status := 'SUPPLIER_EXECUTED';
      v_to_status := 'SUPPLIER_CONFIRMED';
      v_authority_hash := v_confirmation_hash;
      update public.bookings
      set status = v_to_status, supplier_confirmation_id = v_confirmation_id,
          supplier_confirmation_hash = v_confirmation_hash,
          supplier_confirmed_at = now(), updated_at = now()
      where id = v_booking_id;
    end if;
  end if;

  insert into public.booking_work_receipts (
    command_id, booking_id, customer_id, quotation_id,
    action, actor_role, from_status, to_status, authority_hash
  ) values (
    p_command_id, v_booking_id, v_booking.customer_id, v_booking.quotation_id,
    p_command_name, v_actor_role, v_from_status, v_to_status, v_authority_hash
  );

  v_result := jsonb_strip_nulls(jsonb_build_object(
    'status', 'accepted',
    'commandName', p_command_name,
    'bookingId', v_booking_id,
    'bookingStatus', v_to_status,
    'paymentRequestId', v_booking.payment_request_id,
    'readinessEvaluationId', v_booking.readiness_evaluation_id,
    'readinessHash', v_booking.readiness_evaluation_hash,
    'quotationId', v_booking.quotation_id,
    'versionNumber', v_booking.quotation_version,
    'quotationHash', v_booking.quotation_hash,
    'executionId', v_execution_id,
    'executionHash', v_execution_hash,
    'supplierConfirmationId', v_confirmation_id,
    'supplierConfirmationHash', v_confirmation_hash,
    'workReceiptId', p_command_id
  ));

  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal,
    p_command_name, 'accepted', null, 'booking', v_booking_id::text,
    v_authority_hash,
    jsonb_build_object(
      'fromStatus', v_from_status,
      'toStatus', v_to_status,
      'actorRole', v_actor_role,
      'quotationId', v_booking.quotation_id,
      'quotationHash', v_booking.quotation_hash
    )
  );

  insert into public.booking_command_receipts (
    idempotency_key, command_id, command_name, actor_id,
    payload_hash, response, expires_at
  ) values (
    p_idempotency_key, p_command_id, p_command_name, p_actor_id,
    p_payload_hash, v_result, now() + interval '24 hours'
  );
  return v_result;
exception
  when unique_violation then
    select response into v_result
    from public.booking_command_receipts
    where idempotency_key = p_idempotency_key
      and command_name = p_command_name
      and payload_hash = p_payload_hash;
    if found then return v_result; end if;
    raise;
end;
$$;

alter table public.bookings enable row level security;
alter table public.bookings force row level security;
alter table public.supplier_booking_executions enable row level security;
alter table public.supplier_booking_executions force row level security;
alter table public.supplier_confirmations enable row level security;
alter table public.supplier_confirmations force row level security;
alter table public.booking_work_receipts enable row level security;
alter table public.booking_work_receipts force row level security;
alter table public.booking_command_receipts enable row level security;
alter table public.booking_command_receipts force row level security;

create policy bookings_select_customer_or_aal2_operations
on public.bookings for select to authenticated
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

create policy supplier_executions_select_aal2_operations
on public.supplier_booking_executions for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'admin', 'founder') and active
  )
);

create policy supplier_confirmations_select_aal2_operations
on public.supplier_confirmations for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'admin', 'founder') and active
  )
);

create policy booking_work_receipts_select_customer_or_aal2_operations
on public.booking_work_receipts for select to authenticated
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

revoke all on table public.bookings from anon, authenticated;
grant select (
  id, payment_request_id, readiness_evaluation_id, readiness_evaluation_hash,
  acceptance_id, quotation_id, quotation_version, quotation_hash, customer_id,
  locale, currency, amount_minor, status, booking_authority_hash,
  current_execution_id, current_execution_hash, supplier_confirmation_id,
  supplier_confirmation_hash, created_at, updated_at, supplier_executed_at,
  supplier_confirmed_at
) on table public.bookings to authenticated;

revoke all on table public.supplier_booking_executions from anon, authenticated;
grant select on table public.supplier_booking_executions to authenticated;
revoke all on table public.supplier_confirmations from anon, authenticated;
grant select on table public.supplier_confirmations to authenticated;
revoke all on table public.booking_work_receipts from anon, authenticated;
grant select on table public.booking_work_receipts to authenticated;
revoke all on table public.booking_command_receipts from anon, authenticated;

grant select, insert, update on table public.bookings to service_role;
grant select, insert on table public.supplier_booking_executions to service_role;
grant select, insert on table public.supplier_confirmations to service_role;
grant select, insert on table public.booking_work_receipts to service_role;
grant select, insert on table public.booking_command_receipts to service_role;

revoke all on function private.reject_booking_evidence_mutation()
  from public, anon, authenticated;
revoke all on function private.guard_booking_update()
  from public, anon, authenticated;
revoke all on function private.is_valid_booking_creation_payload(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_valid_supplier_execution_payload(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_valid_supplier_confirmation_payload(jsonb)
  from public, anon, authenticated;
grant execute on function private.is_valid_booking_creation_payload(jsonb) to service_role;
grant execute on function private.is_valid_supplier_execution_payload(jsonb) to service_role;
grant execute on function private.is_valid_supplier_confirmation_payload(jsonb) to service_role;
revoke all on function private.booking_denial_result(
  uuid, text, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.booking_denial_result(
  uuid, text, uuid, uuid, text, text, text, text
) to service_role;

revoke all on function public.execute_booking_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from public, anon, authenticated;
grant execute on function public.execute_booking_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) to service_role;

comment on table public.bookings is
  'Booking aggregate created only from exact Acceptance plus READY_FOR_BOOKING evidence.';
comment on table public.supplier_booking_executions is
  'Immutable record that an accountable human executed the Supplier booking step.';
comment on table public.supplier_confirmations is
  'Immutable Supplier Confirmation evidence. Presence is not human Booking Verification.';
comment on function public.execute_booking_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) is
  'Service-secret-only gateway separating Booking creation, human Supplier execution and Supplier Confirmation capture.';
