-- VOYARA AI Task 006: Payment Request, human Payment Verification and allocation readiness.
-- Provider or Customer evidence never equals verified Payment.
-- This migration intentionally creates no Credit, Booking, Supplier Confirmation or Voucher authority.

alter table public.customer_quotation_acceptances
  add constraint customer_quotation_acceptances_exact_identity_unique
  unique (id, quotation_id, version_number, payload_hash, customer_id);

create table public.payment_requests (
  id uuid primary key,
  quotation_id uuid not null unique references public.commercial_quotations (id) on delete restrict,
  quotation_version integer not null,
  quotation_hash text not null,
  acceptance_id uuid not null unique,
  customer_id uuid not null references auth.users (id) on delete restrict,
  locale text not null,
  currency text not null,
  amount_minor bigint not null,
  status text not null default 'REQUESTED',
  current_evidence_id uuid,
  current_evidence_hash text,
  current_review_id uuid,
  current_verification_id uuid,
  current_verification_hash text,
  allocation_id uuid,
  allocation_hash text,
  readiness_evaluation_id uuid,
  readiness_evaluation_hash text,
  readiness_result text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  evidence_received_at timestamptz,
  review_started_at timestamptz,
  verified_at timestamptz,
  allocated_at timestamptz,
  readiness_evaluated_at timestamptz,
  foreign key (acceptance_id, quotation_id, quotation_version, quotation_hash, customer_id)
    references public.customer_quotation_acceptances
      (id, quotation_id, version_number, payload_hash, customer_id) on delete restrict,
  constraint payment_requests_version_check check (quotation_version > 0),
  constraint payment_requests_hash_check check (quotation_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_requests_locale_check check (locale in ('az', 'ru', 'en')),
  constraint payment_requests_currency_check check (currency = 'AZN'),
  constraint payment_requests_amount_check check (amount_minor between 1 and 1000000000000),
  constraint payment_requests_status_check check (status in (
    'REQUESTED', 'EVIDENCE_RECEIVED', 'UNDER_REVIEW', 'EVIDENCE_REJECTED',
    'VERIFIED', 'ALLOCATED', 'READY_FOR_BOOKING'
  )),
  constraint payment_requests_evidence_pointer_check check (
    (current_evidence_id is null and current_evidence_hash is null)
    or (current_evidence_id is not null and current_evidence_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint payment_requests_verification_pointer_check check (
    (current_verification_id is null and current_verification_hash is null)
    or (current_verification_id is not null and current_verification_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint payment_requests_allocation_pointer_check check (
    (allocation_id is null and allocation_hash is null)
    or (allocation_id is not null and allocation_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint payment_requests_readiness_pointer_check check (
    (readiness_evaluation_id is null and readiness_evaluation_hash is null and readiness_result is null)
    or (
      readiness_evaluation_id is not null
      and readiness_evaluation_hash ~ '^[0-9a-f]{64}$'
      and readiness_result = 'READY_FOR_BOOKING'
    )
  ),
  constraint payment_requests_state_pointer_check check (
    (status = 'REQUESTED'
      and current_evidence_id is null and current_review_id is null
      and current_verification_id is null and allocation_id is null
      and readiness_evaluation_id is null)
    or (status = 'EVIDENCE_RECEIVED'
      and current_evidence_id is not null and current_review_id is null
      and current_verification_id is null and allocation_id is null
      and readiness_evaluation_id is null)
    or (status = 'UNDER_REVIEW'
      and current_evidence_id is not null and current_review_id is not null
      and current_verification_id is null and allocation_id is null
      and readiness_evaluation_id is null)
    or (status in ('EVIDENCE_REJECTED', 'VERIFIED')
      and current_evidence_id is not null and current_review_id is not null
      and current_verification_id is not null and allocation_id is null
      and readiness_evaluation_id is null)
    or (status = 'ALLOCATED'
      and current_evidence_id is not null and current_review_id is not null
      and current_verification_id is not null and allocation_id is not null
      and readiness_evaluation_id is null)
    or (status = 'READY_FOR_BOOKING'
      and current_evidence_id is not null and current_review_id is not null
      and current_verification_id is not null and allocation_id is not null
      and readiness_evaluation_id is not null and readiness_result = 'READY_FOR_BOOKING')
  )
);

create index payment_requests_customer_updated_idx
  on public.payment_requests (customer_id, updated_at desc);
create index payment_requests_finance_queue_idx
  on public.payment_requests (status, updated_at asc);

create table public.payment_evidence_versions (
  id uuid primary key,
  payment_request_id uuid not null references public.payment_requests (id) on delete restrict,
  evidence_version integer not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  source_kind text not null,
  channel text not null,
  canonical_payload jsonb not null,
  evidence_hash text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  created_at timestamptz not null default now(),
  unique (payment_request_id, evidence_version),
  unique (payment_request_id, id, evidence_hash),
  constraint payment_evidence_version_check check (evidence_version > 0),
  constraint payment_evidence_source_check check (source_kind in ('CUSTOMER_EVIDENCE', 'FINANCE_DETECTION')),
  constraint payment_evidence_channel_check check (channel in (
    'BANK_TRANSFER_REFERENCE', 'CARD_PAYMENT_REFERENCE',
    'BANK_STATEMENT', 'ACQUIRER_DASHBOARD'
  )),
  constraint payment_evidence_source_channel_check check (
    (source_kind = 'CUSTOMER_EVIDENCE' and channel in ('BANK_TRANSFER_REFERENCE', 'CARD_PAYMENT_REFERENCE'))
    or (source_kind = 'FINANCE_DETECTION' and channel in ('BANK_STATEMENT', 'ACQUIRER_DASHBOARD'))
  ),
  constraint payment_evidence_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint payment_evidence_hash_check check (evidence_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_evidence_aal_check check (actor_aal in ('aal1', 'aal2'))
);

create index payment_evidence_request_idx
  on public.payment_evidence_versions (payment_request_id, evidence_version desc);

create table public.payment_review_events (
  id uuid primary key,
  payment_request_id uuid not null references public.payment_requests (id) on delete restrict,
  evidence_id uuid not null,
  evidence_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  reviewer_id uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  started_at timestamptz not null default now(),
  unique (payment_request_id, evidence_id),
  unique (payment_request_id, id),
  foreign key (payment_request_id, evidence_id, evidence_hash)
    references public.payment_evidence_versions (payment_request_id, id, evidence_hash) on delete restrict,
  constraint payment_review_hash_check check (evidence_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_review_aal_check check (actor_aal = 'aal2')
);

create table public.payment_verification_decisions (
  id uuid primary key,
  payment_request_id uuid not null references public.payment_requests (id) on delete restrict,
  evidence_id uuid not null,
  evidence_hash text not null,
  review_id uuid not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  decision text not null,
  canonical_payload jsonb not null,
  verification_hash text not null,
  verified_amount_minor bigint,
  currency text not null,
  reason text not null,
  decided_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  decided_at timestamptz not null default now(),
  unique (payment_request_id, evidence_id),
  unique (payment_request_id, id, verification_hash),
  foreign key (payment_request_id, evidence_id, evidence_hash)
    references public.payment_evidence_versions (payment_request_id, id, evidence_hash) on delete restrict,
  foreign key (payment_request_id, review_id)
    references public.payment_review_events (payment_request_id, id) on delete restrict,
  constraint payment_verification_decision_check check (decision in ('VERIFY', 'REJECT')),
  constraint payment_verification_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint payment_verification_hash_check check (verification_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_verification_amount_check check (
    (decision = 'VERIFY' and verified_amount_minor between 1 and 1000000000000)
    or (decision = 'REJECT' and verified_amount_minor is null)
  ),
  constraint payment_verification_currency_check check (currency = 'AZN'),
  constraint payment_verification_reason_check check (char_length(btrim(reason)) between 3 and 500),
  constraint payment_verification_aal_check check (actor_aal = 'aal2')
);

create table public.fund_allocations (
  id uuid primary key,
  payment_request_id uuid not null unique references public.payment_requests (id) on delete restrict,
  verification_id uuid not null,
  verification_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  quotation_id uuid not null references public.commercial_quotations (id) on delete restrict,
  quotation_version integer not null,
  quotation_hash text not null,
  currency text not null,
  amount_minor bigint not null,
  canonical_payload jsonb not null,
  allocation_hash text not null,
  allocated_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  allocated_at timestamptz not null default now(),
  unique (payment_request_id, id, allocation_hash),
  foreign key (payment_request_id, verification_id, verification_hash)
    references public.payment_verification_decisions
      (payment_request_id, id, verification_hash) on delete restrict,
  constraint fund_allocations_version_check check (quotation_version > 0),
  constraint fund_allocations_quotation_hash_check check (quotation_hash ~ '^[0-9a-f]{64}$'),
  constraint fund_allocations_currency_check check (currency = 'AZN'),
  constraint fund_allocations_amount_check check (amount_minor between 1 and 1000000000000),
  constraint fund_allocations_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint fund_allocations_hash_check check (allocation_hash ~ '^[0-9a-f]{64}$'),
  constraint fund_allocations_aal_check check (actor_aal = 'aal2')
);

create table public.financial_readiness_evaluations (
  id uuid primary key,
  payment_request_id uuid not null unique references public.payment_requests (id) on delete restrict,
  allocation_id uuid not null,
  allocation_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  quotation_id uuid not null references public.commercial_quotations (id) on delete restrict,
  quotation_version integer not null,
  quotation_hash text not null,
  acceptance_id uuid not null references public.customer_quotation_acceptances (id) on delete restrict,
  canonical_input jsonb not null,
  evaluation_hash text not null,
  result text not null,
  reason_codes jsonb not null,
  evaluated_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  evaluated_at timestamptz not null default now(),
  unique (payment_request_id, id, evaluation_hash),
  foreign key (payment_request_id, allocation_id, allocation_hash)
    references public.fund_allocations (payment_request_id, id, allocation_hash) on delete restrict,
  constraint financial_readiness_version_check check (quotation_version > 0),
  constraint financial_readiness_quotation_hash_check check (quotation_hash ~ '^[0-9a-f]{64}$'),
  constraint financial_readiness_input_check check (jsonb_typeof(canonical_input) = 'object'),
  constraint financial_readiness_hash_check check (evaluation_hash ~ '^[0-9a-f]{64}$'),
  constraint financial_readiness_result_check check (result = 'READY_FOR_BOOKING'),
  constraint financial_readiness_reasons_check check (reason_codes = '["VERIFIED_PAYMENT_FULLY_ALLOCATED"]'::jsonb),
  constraint financial_readiness_aal_check check (actor_aal = 'aal2')
);

create table public.financial_work_receipts (
  command_id uuid primary key,
  payment_request_id uuid not null references public.payment_requests (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  quotation_id uuid not null references public.commercial_quotations (id) on delete restrict,
  action text not null,
  actor_role text not null,
  from_status text,
  to_status text not null,
  authority_hash text not null,
  occurred_at timestamptz not null default now(),
  constraint financial_work_receipts_action_check check (action in (
    'payment_request.create', 'payment.evidence.submit', 'payment.detection.record',
    'payment.review.start', 'payment.verify', 'funds.allocate', 'payment.evaluate_readiness'
  )),
  constraint financial_work_receipts_actor_role_check check (
    actor_role in ('customer', 'finance', 'admin', 'founder')
  ),
  constraint financial_work_receipts_from_status_check check (
    from_status is null or from_status in (
      'REQUESTED', 'EVIDENCE_RECEIVED', 'UNDER_REVIEW', 'EVIDENCE_REJECTED',
      'VERIFIED', 'ALLOCATED', 'READY_FOR_BOOKING'
    )
  ),
  constraint financial_work_receipts_to_status_check check (to_status in (
    'REQUESTED', 'EVIDENCE_RECEIVED', 'UNDER_REVIEW', 'EVIDENCE_REJECTED',
    'VERIFIED', 'ALLOCATED', 'READY_FOR_BOOKING'
  )),
  constraint financial_work_receipts_hash_check check (authority_hash ~ '^[0-9a-f]{64}$')
);

create index financial_work_receipts_request_idx
  on public.financial_work_receipts (payment_request_id, occurred_at, command_id);
create index financial_work_receipts_customer_idx
  on public.financial_work_receipts (customer_id, occurred_at desc);

create table public.financial_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint financial_command_receipts_key_check check (char_length(idempotency_key) between 12 and 160),
  constraint financial_command_receipts_name_check check (command_name in (
    'payment_request.create', 'payment.evidence.submit', 'payment.detection.record',
    'payment.review.start', 'payment.verify', 'funds.allocate', 'payment.evaluate_readiness'
  )),
  constraint financial_command_receipts_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint financial_command_receipts_response_check check (jsonb_typeof(response) = 'object'),
  constraint financial_command_receipts_expiry_check check (expires_at > created_at)
);

create index financial_command_receipts_actor_created_idx
  on public.financial_command_receipts (actor_id, created_at desc);
create index financial_command_receipts_expires_idx
  on public.financial_command_receipts (expires_at);

alter table public.payment_requests
  add constraint payment_requests_current_evidence_fk
    foreign key (id, current_evidence_id, current_evidence_hash)
    references public.payment_evidence_versions (payment_request_id, id, evidence_hash)
    deferrable initially deferred,
  add constraint payment_requests_current_review_fk
    foreign key (id, current_review_id)
    references public.payment_review_events (payment_request_id, id)
    deferrable initially deferred,
  add constraint payment_requests_current_verification_fk
    foreign key (id, current_verification_id, current_verification_hash)
    references public.payment_verification_decisions (payment_request_id, id, verification_hash)
    deferrable initially deferred,
  add constraint payment_requests_allocation_fk
    foreign key (id, allocation_id, allocation_hash)
    references public.fund_allocations (payment_request_id, id, allocation_hash)
    deferrable initially deferred,
  add constraint payment_requests_readiness_fk
    foreign key (id, readiness_evaluation_id, readiness_evaluation_hash)
    references public.financial_readiness_evaluations (payment_request_id, id, evaluation_hash)
    deferrable initially deferred;

create or replace function private.reject_financial_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'financial authority evidence is append-only' using errcode = '55000';
end;
$$;

create trigger payment_evidence_versions_immutable
before update or delete on public.payment_evidence_versions
for each row execute function private.reject_financial_evidence_mutation();
create trigger payment_review_events_immutable
before update or delete on public.payment_review_events
for each row execute function private.reject_financial_evidence_mutation();
create trigger payment_verification_decisions_immutable
before update or delete on public.payment_verification_decisions
for each row execute function private.reject_financial_evidence_mutation();
create trigger fund_allocations_immutable
before update or delete on public.fund_allocations
for each row execute function private.reject_financial_evidence_mutation();
create trigger financial_readiness_evaluations_immutable
before update or delete on public.financial_readiness_evaluations
for each row execute function private.reject_financial_evidence_mutation();
create trigger financial_work_receipts_immutable
before update or delete on public.financial_work_receipts
for each row execute function private.reject_financial_evidence_mutation();

create or replace function private.guard_payment_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.quotation_id, new.quotation_version, new.quotation_hash,
    new.acceptance_id, new.customer_id, new.locale, new.currency,
    new.amount_minor, new.created_by, new.created_at
  ) is distinct from row(
    old.quotation_id, old.quotation_version, old.quotation_hash,
    old.acceptance_id, old.customer_id, old.locale, old.currency,
    old.amount_minor, old.created_by, old.created_at
  ) then
    raise exception 'payment request identity and amount are immutable' using errcode = '55000';
  end if;

  if (old.status, new.status) not in (
    ('REQUESTED', 'EVIDENCE_RECEIVED'),
    ('EVIDENCE_REJECTED', 'EVIDENCE_RECEIVED'),
    ('EVIDENCE_RECEIVED', 'UNDER_REVIEW'),
    ('UNDER_REVIEW', 'EVIDENCE_REJECTED'),
    ('UNDER_REVIEW', 'VERIFIED'),
    ('VERIFIED', 'ALLOCATED'),
    ('ALLOCATED', 'READY_FOR_BOOKING')
  ) then
    raise exception 'invalid payment request state transition' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger payment_requests_guarded
before update on public.payment_requests
for each row execute function private.guard_payment_request_update();

create or replace function private.is_valid_payment_evidence_payload(p_payload jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_amount bigint;
  v_observed_at timestamptz;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'schemaVersion' <> 'payment-evidence-v1'
    or coalesce(p_payload->>'paymentRequestId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_payload->>'sourceKind' not in ('CUSTOMER_EVIDENCE', 'FINANCE_DETECTION')
    or p_payload->>'channel' not in (
      'BANK_TRANSFER_REFERENCE', 'CARD_PAYMENT_REFERENCE',
      'BANK_STATEMENT', 'ACQUIRER_DASHBOARD'
    )
    or p_payload->>'currency' <> 'AZN'
    or coalesce(p_payload->>'amountMinor', '') !~ '^[1-9][0-9]*$'
    or char_length(btrim(coalesce(p_payload->>'externalReference', ''))) not between 3 and 120
    or char_length(coalesce(p_payload->>'note', '')) > 500
    or p_payload->>'declarationConfirmed' <> 'true'
  then
    return false;
  end if;

  if (p_payload->>'sourceKind' = 'CUSTOMER_EVIDENCE'
      and p_payload->>'channel' not in ('BANK_TRANSFER_REFERENCE', 'CARD_PAYMENT_REFERENCE'))
    or (p_payload->>'sourceKind' = 'FINANCE_DETECTION'
      and p_payload->>'channel' not in ('BANK_STATEMENT', 'ACQUIRER_DASHBOARD'))
  then
    return false;
  end if;

  v_amount := (p_payload->>'amountMinor')::bigint;
  v_observed_at := (p_payload->>'observedAt')::timestamptz;
  return v_amount between 1 and 1000000000000
    and v_observed_at <= now() + interval '5 minutes';
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    return false;
end;
$$;

create or replace function private.is_valid_payment_verification_payload(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_payload) = 'object'
    and p_payload->>'schemaVersion' = 'payment-verification-v1'
    and coalesce(p_payload->>'paymentRequestId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'evidenceId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'evidenceHash', '') ~ '^[0-9a-f]{64}$'
    and p_payload->>'decision' in ('VERIFY', 'REJECT')
    and char_length(btrim(coalesce(p_payload->>'reason', ''))) between 3 and 500;
$$;

create or replace function private.is_valid_allocation_payload(p_payload jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_amount bigint;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'schemaVersion' <> 'funds-allocation-v1'
    or coalesce(p_payload->>'paymentRequestId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'verificationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'verificationHash', '') !~ '^[0-9a-f]{64}$'
    or p_payload->>'currency' <> 'AZN'
    or coalesce(p_payload->>'amountMinor', '') !~ '^[1-9][0-9]*$'
  then
    return false;
  end if;
  v_amount := (p_payload->>'amountMinor')::bigint;
  return v_amount between 1 and 1000000000000;
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$$;

create or replace function private.is_valid_readiness_input(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_payload) = 'object'
    and p_payload->>'schemaVersion' = 'financial-readiness-input-v1'
    and coalesce(p_payload->>'paymentRequestId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'allocationId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'allocationHash', '') ~ '^[0-9a-f]{64}$';
$$;

create or replace function private.financial_denial_result(
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
    'payment_request',
    coalesce(p_entity_id, p_command_id::text),
    case when p_payload_hash ~ '^[0-9a-f]{64}$' then p_payload_hash else repeat('0', 64) end,
    '{}'::jsonb
  );
  return jsonb_build_object('status', 'denied', 'reasonCode', p_reason_code);
end;
$$;

create or replace function public.execute_payment_command(
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
  v_existing public.financial_command_receipts%rowtype;
  v_request public.payment_requests%rowtype;
  v_quote public.commercial_quotations%rowtype;
  v_acceptance public.customer_quotation_acceptances%rowtype;
  v_published public.published_proposals%rowtype;
  v_evidence public.payment_evidence_versions%rowtype;
  v_review public.payment_review_events%rowtype;
  v_verification public.payment_verification_decisions%rowtype;
  v_allocation public.fund_allocations%rowtype;
  v_result jsonb;
  v_payment_request_id uuid;
  v_quotation_id uuid;
  v_quotation_version integer;
  v_quotation_hash text;
  v_evidence_id uuid;
  v_evidence_hash text;
  v_verification_id uuid;
  v_verification_hash text;
  v_allocation_id uuid;
  v_allocation_hash text;
  v_canonical_payload jsonb;
  v_authority_hash text;
  v_decision text;
  v_reason text;
  v_from_status text;
  v_to_status text;
  v_actor_role text;
  v_revoked_before timestamptz;
  v_is_customer_command boolean;
  v_evidence_version integer;
  v_amount_minor bigint;
begin
  select * into v_existing
  from public.financial_command_receipts
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.command_name <> p_command_name or v_existing.payload_hash <> p_payload_hash then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'IDEMPOTENCY_CONFLICT', null, p_payload_hash
      );
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in (
    'payment_request.create', 'payment.evidence.submit', 'payment.detection.record',
    'payment.review.start', 'payment.verify', 'funds.allocate', 'payment.evaluate_readiness'
  ) then
    return private.financial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'UNREGISTERED_COMMAND', null, p_payload_hash
    );
  end if;

  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload) <> 'object' then
    return private.financial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'INVALID_PAYLOAD', null, p_payload_hash
    );
  end if;

  if p_actor_session_id is null or p_actor_issued_at is null or p_actor_aal not in ('aal1', 'aal2') then
    return private.financial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_EVIDENCE_REQUIRED', null, p_payload_hash
    );
  end if;

  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return private.financial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  select revoked_before into v_revoked_before
  from public.user_session_security
  where user_id = p_actor_id;

  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return private.financial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  v_is_customer_command := p_command_name = 'payment.evidence.submit';
  if v_is_customer_command then
    if not exists (
      select 1 from public.role_assignments
      where user_id = p_actor_id and role = 'customer' and active
    ) then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'CUSTOMER_REQUIRED', null, p_payload_hash
      );
    end if;
    v_actor_role := 'customer';
  else
    if p_actor_aal <> 'aal2' then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'AAL2_REQUIRED', null, p_payload_hash
      );
    end if;

    if p_command_name in ('funds.allocate', 'payment.evaluate_readiness') then
      select role into v_actor_role
      from public.role_assignments
      where user_id = p_actor_id and role in ('finance', 'founder') and active
      order by case role when 'founder' then 1 else 2 end
      limit 1;
      if v_actor_role is null then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'ALLOCATION_AUTHORITY_REQUIRED', null, p_payload_hash
        );
      end if;
    else
      select role into v_actor_role
      from public.role_assignments
      where user_id = p_actor_id and role in ('finance', 'admin', 'founder') and active
      order by case role when 'founder' then 1 when 'finance' then 2 else 3 end
      limit 1;
      if v_actor_role is null then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'FINANCE_AUTHORITY_REQUIRED', null, p_payload_hash
        );
      end if;
    end if;
  end if;

  if v_is_customer_command and (
    select count(*) from public.financial_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '24 hours'
  ) >= 10 then
    return private.financial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'RATE_LIMITED', null, p_payload_hash
    );
  end if;

  if not v_is_customer_command and (
    select count(*) from public.financial_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
  ) >= 120 then
    return private.financial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'RATE_LIMITED', null, p_payload_hash
    );
  end if;

  begin
    v_payment_request_id := nullif(p_payload->>'paymentRequestId', '')::uuid;
    v_quotation_id := nullif(p_payload->>'quotationId', '')::uuid;
    v_quotation_version := nullif(p_payload->>'versionNumber', '')::integer;
    v_evidence_id := nullif(p_payload->>'evidenceId', '')::uuid;
    v_verification_id := nullif(p_payload->>'verificationId', '')::uuid;
    v_allocation_id := nullif(p_payload->>'allocationId', '')::uuid;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_IDENTIFIER', null, p_payload_hash
      );
  end;

  v_quotation_hash := p_payload->>'quotationHash';
  v_evidence_hash := p_payload->>'evidenceHash';
  v_verification_hash := p_payload->>'verificationHash';
  v_allocation_hash := p_payload->>'allocationHash';

  if p_command_name = 'payment_request.create' then
    if v_quotation_id is null or v_quotation_version is null
      or v_quotation_hash is null or v_quotation_hash !~ '^[0-9a-f]{64}$'
    then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_ACCEPTED_QUOTATION_REQUIRED', coalesce(v_quotation_id::text, p_command_id::text), p_payload_hash
      );
    end if;

    select * into v_quote from public.commercial_quotations
    where id = v_quotation_id for update;
    if not found or v_quote.status <> 'ACCEPTED'
      or v_quote.current_version <> v_quotation_version or v_quote.current_hash <> v_quotation_hash
      or v_quote.approved_version <> v_quotation_version or v_quote.approved_hash <> v_quotation_hash
      or v_quote.published_version <> v_quotation_version or v_quote.published_hash <> v_quotation_hash
    then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_ACCEPTED_QUOTATION_REQUIRED', v_quotation_id::text, p_payload_hash
      );
    end if;

    select * into v_acceptance from public.customer_quotation_acceptances
    where quotation_id = v_quotation_id and version_number = v_quotation_version
      and payload_hash = v_quotation_hash and customer_id = v_quote.customer_id;
    select * into v_published from public.published_proposals
    where quotation_id = v_quotation_id and version_number = v_quotation_version
      and payload_hash = v_quotation_hash and customer_id = v_quote.customer_id;

    if v_acceptance.id is null or v_published.id is null
      or coalesce(v_published.customer_payload#>>'{totalMinor}', '') !~ '^[1-9][0-9]*$'
      or v_published.customer_payload->>'currency' <> 'AZN'
    then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_ACCEPTANCE_REQUIRED', v_quotation_id::text, p_payload_hash
      );
    end if;

    if exists (select 1 from public.payment_requests where quotation_id = v_quotation_id) then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'PAYMENT_REQUEST_EXISTS', v_quotation_id::text, p_payload_hash
      );
    end if;

    v_amount_minor := (v_published.customer_payload#>>'{totalMinor}')::bigint;
    if v_amount_minor not between 1 and 1000000000000 then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_PAYMENT_AMOUNT', v_quotation_id::text, p_payload_hash
      );
    end if;

    v_payment_request_id := p_command_id;
    insert into public.payment_requests (
      id, quotation_id, quotation_version, quotation_hash, acceptance_id,
      customer_id, locale, currency, amount_minor, created_by
    ) values (
      v_payment_request_id, v_quotation_id, v_quotation_version, v_quotation_hash,
      v_acceptance.id, v_quote.customer_id, v_acceptance.locale, 'AZN', v_amount_minor, p_actor_id
    );
    select * into v_request from public.payment_requests where id = v_payment_request_id;
    v_from_status := null;
    v_to_status := 'REQUESTED';
    v_authority_hash := v_quotation_hash;

  else
    if v_payment_request_id is null then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'PAYMENT_REQUEST_REQUIRED', null, p_payload_hash
      );
    end if;

    select * into v_request from public.payment_requests
    where id = v_payment_request_id for update;
    if not found then
      return private.financial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'PAYMENT_REQUEST_NOT_FOUND', v_payment_request_id::text, p_payload_hash
      );
    end if;
    v_quotation_id := v_request.quotation_id;
    v_quotation_version := v_request.quotation_version;
    v_quotation_hash := v_request.quotation_hash;

    if p_command_name in ('payment.evidence.submit', 'payment.detection.record') then
      if v_request.status not in ('REQUESTED', 'EVIDENCE_REJECTED') then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'PAYMENT_EVIDENCE_NOT_ACCEPTED_IN_STATE', v_payment_request_id::text, p_payload_hash
        );
      end if;
      if v_is_customer_command and v_request.customer_id <> p_actor_id then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'CUSTOMER_OWNERSHIP_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;

      v_canonical_payload := p_payload->'evidencePayload';
      v_evidence_hash := p_payload->>'evidenceHash';
      if v_evidence_hash is null or v_evidence_hash !~ '^[0-9a-f]{64}$'
        or not private.is_valid_payment_evidence_payload(v_canonical_payload)
        or v_canonical_payload->>'paymentRequestId' <> v_payment_request_id::text
        or (v_is_customer_command and v_canonical_payload->>'sourceKind' <> 'CUSTOMER_EVIDENCE')
        or (not v_is_customer_command and v_canonical_payload->>'sourceKind' <> 'FINANCE_DETECTION')
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_PAYMENT_EVIDENCE', v_payment_request_id::text, p_payload_hash
        );
      end if;

      select count(*)::integer + 1 into v_evidence_version
      from public.payment_evidence_versions where payment_request_id = v_payment_request_id;
      v_evidence_id := p_command_id;
      insert into public.payment_evidence_versions (
        id, payment_request_id, evidence_version, customer_id, source_kind, channel,
        canonical_payload, evidence_hash, created_by, actor_session_id, actor_aal
      ) values (
        v_evidence_id, v_payment_request_id, v_evidence_version, v_request.customer_id,
        v_canonical_payload->>'sourceKind', v_canonical_payload->>'channel',
        v_canonical_payload, v_evidence_hash, p_actor_id, p_actor_session_id, p_actor_aal
      );

      v_from_status := v_request.status;
      v_to_status := 'EVIDENCE_RECEIVED';
      update public.payment_requests
      set status = v_to_status,
          current_evidence_id = v_evidence_id, current_evidence_hash = v_evidence_hash,
          current_review_id = null,
          current_verification_id = null, current_verification_hash = null,
          review_started_at = null, verified_at = null,
          evidence_received_at = now(), updated_at = now()
      where id = v_payment_request_id;
      v_authority_hash := v_evidence_hash;

    elsif p_command_name = 'payment.review.start' then
      if v_request.status <> 'EVIDENCE_RECEIVED'
        or v_evidence_id is null or v_evidence_hash !~ '^[0-9a-f]{64}$'
        or v_request.current_evidence_id <> v_evidence_id
        or v_request.current_evidence_hash <> v_evidence_hash
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_PAYMENT_EVIDENCE_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;
      select * into v_evidence from public.payment_evidence_versions
      where payment_request_id = v_payment_request_id and id = v_evidence_id
        and evidence_hash = v_evidence_hash;
      if not found then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_PAYMENT_EVIDENCE_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;

      insert into public.payment_review_events (
        id, payment_request_id, evidence_id, evidence_hash, customer_id,
        reviewer_id, actor_session_id, actor_aal
      ) values (
        p_command_id, v_payment_request_id, v_evidence_id, v_evidence_hash,
        v_request.customer_id, p_actor_id, p_actor_session_id, p_actor_aal
      );
      v_from_status := 'EVIDENCE_RECEIVED';
      v_to_status := 'UNDER_REVIEW';
      update public.payment_requests
      set status = v_to_status, current_review_id = p_command_id,
          review_started_at = now(), updated_at = now()
      where id = v_payment_request_id;
      v_authority_hash := v_evidence_hash;

    elsif p_command_name = 'payment.verify' then
      if v_request.status <> 'UNDER_REVIEW'
        or v_evidence_id is null or v_evidence_hash !~ '^[0-9a-f]{64}$'
        or v_request.current_evidence_id <> v_evidence_id
        or v_request.current_evidence_hash <> v_evidence_hash
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_REVIEWED_EVIDENCE_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;
      select * into v_evidence from public.payment_evidence_versions
      where payment_request_id = v_payment_request_id and id = v_evidence_id
        and evidence_hash = v_evidence_hash;
      select * into v_review from public.payment_review_events
      where payment_request_id = v_payment_request_id and id = v_request.current_review_id
        and evidence_id = v_evidence_id and evidence_hash = v_evidence_hash;
      if v_evidence.id is null or v_review.id is null then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_REVIEWED_EVIDENCE_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;

      v_canonical_payload := p_payload->'verificationPayload';
      v_verification_hash := p_payload->>'verificationHash';
      v_decision := v_canonical_payload->>'decision';
      v_reason := btrim(coalesce(v_canonical_payload->>'reason', ''));
      if v_verification_hash is null or v_verification_hash !~ '^[0-9a-f]{64}$'
        or not private.is_valid_payment_verification_payload(v_canonical_payload)
        or v_canonical_payload->>'paymentRequestId' <> v_payment_request_id::text
        or v_canonical_payload->>'evidenceId' <> v_evidence_id::text
        or v_canonical_payload->>'evidenceHash' <> v_evidence_hash
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_PAYMENT_VERIFICATION', v_payment_request_id::text, p_payload_hash
        );
      end if;

      if v_decision = 'VERIFY' and (
        (v_evidence.canonical_payload->>'amountMinor')::bigint <> v_request.amount_minor
        or v_evidence.canonical_payload->>'currency' <> v_request.currency
      ) then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'PAYMENT_AMOUNT_MISMATCH', v_payment_request_id::text, p_payload_hash
        );
      end if;

      v_verification_id := p_command_id;
      insert into public.payment_verification_decisions (
        id, payment_request_id, evidence_id, evidence_hash, review_id, customer_id,
        decision, canonical_payload, verification_hash, verified_amount_minor,
        currency, reason, decided_by, actor_session_id, actor_aal
      ) values (
        v_verification_id, v_payment_request_id, v_evidence_id, v_evidence_hash,
        v_review.id, v_request.customer_id, v_decision, v_canonical_payload,
        v_verification_hash,
        case when v_decision = 'VERIFY' then v_request.amount_minor else null end,
        v_request.currency, v_reason, p_actor_id, p_actor_session_id, p_actor_aal
      );

      v_from_status := 'UNDER_REVIEW';
      v_to_status := case when v_decision = 'VERIFY' then 'VERIFIED' else 'EVIDENCE_REJECTED' end;
      update public.payment_requests
      set status = v_to_status,
          current_verification_id = v_verification_id,
          current_verification_hash = v_verification_hash,
          verified_at = case when v_decision = 'VERIFY' then now() else null end,
          updated_at = now()
      where id = v_payment_request_id;
      v_authority_hash := v_verification_hash;

    elsif p_command_name = 'funds.allocate' then
      if v_request.status <> 'VERIFIED'
        or v_verification_id is null or v_verification_hash !~ '^[0-9a-f]{64}$'
        or v_request.current_verification_id <> v_verification_id
        or v_request.current_verification_hash <> v_verification_hash
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_VERIFIED_PAYMENT_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;
      select * into v_verification from public.payment_verification_decisions
      where payment_request_id = v_payment_request_id and id = v_verification_id
        and verification_hash = v_verification_hash and decision = 'VERIFY';
      if not found or v_verification.verified_amount_minor <> v_request.amount_minor then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_VERIFIED_PAYMENT_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;

      v_canonical_payload := p_payload->'allocationPayload';
      v_allocation_hash := p_payload->>'allocationHash';
      if v_allocation_hash is null or v_allocation_hash !~ '^[0-9a-f]{64}$'
        or not private.is_valid_allocation_payload(v_canonical_payload)
        or v_canonical_payload->>'paymentRequestId' <> v_payment_request_id::text
        or v_canonical_payload->>'verificationId' <> v_verification_id::text
        or v_canonical_payload->>'verificationHash' <> v_verification_hash
        or (v_canonical_payload->>'amountMinor')::bigint <> v_request.amount_minor
        or v_canonical_payload->>'currency' <> v_request.currency
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_FUNDS_ALLOCATION', v_payment_request_id::text, p_payload_hash
        );
      end if;

      v_allocation_id := p_command_id;
      insert into public.fund_allocations (
        id, payment_request_id, verification_id, verification_hash, customer_id,
        quotation_id, quotation_version, quotation_hash, currency, amount_minor,
        canonical_payload, allocation_hash, allocated_by, actor_session_id, actor_aal
      ) values (
        v_allocation_id, v_payment_request_id, v_verification_id, v_verification_hash,
        v_request.customer_id, v_request.quotation_id, v_request.quotation_version,
        v_request.quotation_hash, v_request.currency, v_request.amount_minor,
        v_canonical_payload, v_allocation_hash, p_actor_id, p_actor_session_id, p_actor_aal
      );
      v_from_status := 'VERIFIED';
      v_to_status := 'ALLOCATED';
      update public.payment_requests
      set status = v_to_status, allocation_id = v_allocation_id,
          allocation_hash = v_allocation_hash, allocated_at = now(), updated_at = now()
      where id = v_payment_request_id;
      v_authority_hash := v_allocation_hash;

    else
      if v_request.status <> 'ALLOCATED'
        or v_allocation_id is null or v_allocation_hash !~ '^[0-9a-f]{64}$'
        or v_request.allocation_id <> v_allocation_id
        or v_request.allocation_hash <> v_allocation_hash
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_ALLOCATION_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;
      select * into v_allocation from public.fund_allocations
      where payment_request_id = v_payment_request_id and id = v_allocation_id
        and allocation_hash = v_allocation_hash;
      if not found or v_allocation.amount_minor <> v_request.amount_minor
        or v_allocation.currency <> v_request.currency
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_ALLOCATION_REQUIRED', v_payment_request_id::text, p_payload_hash
        );
      end if;

      v_canonical_payload := p_payload->'readinessInput';
      v_authority_hash := p_payload->>'readinessHash';
      if v_authority_hash is null or v_authority_hash !~ '^[0-9a-f]{64}$'
        or not private.is_valid_readiness_input(v_canonical_payload)
        or v_canonical_payload->>'paymentRequestId' <> v_payment_request_id::text
        or v_canonical_payload->>'allocationId' <> v_allocation_id::text
        or v_canonical_payload->>'allocationHash' <> v_allocation_hash
        or not exists (
          select 1 from public.customer_quotation_acceptances
          where id = v_request.acceptance_id and quotation_id = v_request.quotation_id
            and version_number = v_request.quotation_version
            and payload_hash = v_request.quotation_hash
            and customer_id = v_request.customer_id
        )
      then
        return private.financial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'FINANCIAL_READINESS_NOT_PROVEN', v_payment_request_id::text, p_payload_hash
        );
      end if;

      insert into public.financial_readiness_evaluations (
        id, payment_request_id, allocation_id, allocation_hash, customer_id,
        quotation_id, quotation_version, quotation_hash, acceptance_id,
        canonical_input, evaluation_hash, result, reason_codes,
        evaluated_by, actor_session_id, actor_aal
      ) values (
        p_command_id, v_payment_request_id, v_allocation_id, v_allocation_hash,
        v_request.customer_id, v_request.quotation_id, v_request.quotation_version,
        v_request.quotation_hash, v_request.acceptance_id, v_canonical_payload,
        v_authority_hash, 'READY_FOR_BOOKING',
        '["VERIFIED_PAYMENT_FULLY_ALLOCATED"]'::jsonb,
        p_actor_id, p_actor_session_id, p_actor_aal
      );
      v_from_status := 'ALLOCATED';
      v_to_status := 'READY_FOR_BOOKING';
      update public.payment_requests
      set status = v_to_status, readiness_evaluation_id = p_command_id,
          readiness_evaluation_hash = v_authority_hash,
          readiness_result = 'READY_FOR_BOOKING',
          readiness_evaluated_at = now(), updated_at = now()
      where id = v_payment_request_id;
    end if;
  end if;

  insert into public.financial_work_receipts (
    command_id, payment_request_id, customer_id, quotation_id,
    action, actor_role, from_status, to_status, authority_hash
  ) values (
    p_command_id, v_payment_request_id, v_request.customer_id, v_request.quotation_id,
    p_command_name, v_actor_role, v_from_status, v_to_status, v_authority_hash
  );

  v_result := jsonb_strip_nulls(jsonb_build_object(
    'status', 'accepted',
    'commandName', p_command_name,
    'paymentRequestId', v_payment_request_id,
    'paymentStatus', v_to_status,
    'quotationId', v_request.quotation_id,
    'versionNumber', v_request.quotation_version,
    'quotationHash', v_request.quotation_hash,
    'evidenceId', v_evidence_id,
    'evidenceHash', v_evidence_hash,
    'verificationId', v_verification_id,
    'verificationHash', v_verification_hash,
    'allocationId', v_allocation_id,
    'allocationHash', v_allocation_hash,
    'readinessEvaluationId', case when v_to_status = 'READY_FOR_BOOKING' then p_command_id else null end,
    'readinessResult', case when v_to_status = 'READY_FOR_BOOKING' then 'READY_FOR_BOOKING' else null end,
    'workReceiptId', p_command_id
  ));

  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal,
    p_command_name, 'accepted', null, 'payment_request', v_payment_request_id::text,
    v_authority_hash,
    jsonb_build_object(
      'fromStatus', v_from_status,
      'toStatus', v_to_status,
      'actorRole', v_actor_role,
      'quotationId', v_request.quotation_id,
      'quotationHash', v_request.quotation_hash
    )
  );

  insert into public.financial_command_receipts (
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
    from public.financial_command_receipts
    where idempotency_key = p_idempotency_key
      and command_name = p_command_name
      and payload_hash = p_payload_hash;
    if found then return v_result; end if;
    raise;
end;
$$;

alter table public.payment_requests enable row level security;
alter table public.payment_requests force row level security;
alter table public.payment_evidence_versions enable row level security;
alter table public.payment_evidence_versions force row level security;
alter table public.payment_review_events enable row level security;
alter table public.payment_review_events force row level security;
alter table public.payment_verification_decisions enable row level security;
alter table public.payment_verification_decisions force row level security;
alter table public.fund_allocations enable row level security;
alter table public.fund_allocations force row level security;
alter table public.financial_readiness_evaluations enable row level security;
alter table public.financial_readiness_evaluations force row level security;
alter table public.financial_work_receipts enable row level security;
alter table public.financial_work_receipts force row level security;
alter table public.financial_command_receipts enable row level security;
alter table public.financial_command_receipts force row level security;

create policy payment_requests_select_customer_or_aal2_staff
on public.payment_requests for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
    )
  )
);

create policy payment_evidence_select_aal2_finance
on public.payment_evidence_versions for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('finance', 'admin', 'founder') and active
  )
);

create policy payment_reviews_select_aal2_finance
on public.payment_review_events for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('finance', 'admin', 'founder') and active
  )
);

create policy payment_verifications_select_aal2_finance
on public.payment_verification_decisions for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('finance', 'admin', 'founder') and active
  )
);

create policy fund_allocations_select_aal2_finance
on public.fund_allocations for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('finance', 'admin', 'founder') and active
  )
);

create policy financial_readiness_select_aal2_finance
on public.financial_readiness_evaluations for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('finance', 'admin', 'founder') and active
  )
);

create policy financial_work_receipts_select_customer_or_aal2_finance
on public.financial_work_receipts for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('finance', 'admin', 'founder') and active
    )
  )
);

revoke all on table public.payment_requests from anon, authenticated;
grant select (
  id, quotation_id, quotation_version, quotation_hash, acceptance_id, customer_id,
  locale, currency, amount_minor, status, current_evidence_id, current_evidence_hash,
  current_review_id, current_verification_id, current_verification_hash,
  allocation_id, allocation_hash, readiness_evaluation_id,
  readiness_evaluation_hash, readiness_result, created_at, updated_at,
  evidence_received_at, review_started_at, verified_at, allocated_at,
  readiness_evaluated_at
) on table public.payment_requests to authenticated;

revoke all on table public.payment_evidence_versions from anon, authenticated;
grant select on table public.payment_evidence_versions to authenticated;
revoke all on table public.payment_review_events from anon, authenticated;
grant select on table public.payment_review_events to authenticated;
revoke all on table public.payment_verification_decisions from anon, authenticated;
grant select on table public.payment_verification_decisions to authenticated;
revoke all on table public.fund_allocations from anon, authenticated;
grant select on table public.fund_allocations to authenticated;
revoke all on table public.financial_readiness_evaluations from anon, authenticated;
grant select on table public.financial_readiness_evaluations to authenticated;
revoke all on table public.financial_work_receipts from anon, authenticated;
grant select on table public.financial_work_receipts to authenticated;
revoke all on table public.financial_command_receipts from anon, authenticated;

grant select, insert, update on table public.payment_requests to service_role;
grant select, insert on table public.payment_evidence_versions to service_role;
grant select, insert on table public.payment_review_events to service_role;
grant select, insert on table public.payment_verification_decisions to service_role;
grant select, insert on table public.fund_allocations to service_role;
grant select, insert on table public.financial_readiness_evaluations to service_role;
grant select, insert on table public.financial_work_receipts to service_role;
grant select, insert on table public.financial_command_receipts to service_role;

revoke all on function private.reject_financial_evidence_mutation() from public, anon, authenticated;
revoke all on function private.guard_payment_request_update() from public, anon, authenticated;
revoke all on function private.is_valid_payment_evidence_payload(jsonb) from public, anon, authenticated;
revoke all on function private.is_valid_payment_verification_payload(jsonb) from public, anon, authenticated;
revoke all on function private.is_valid_allocation_payload(jsonb) from public, anon, authenticated;
revoke all on function private.is_valid_readiness_input(jsonb) from public, anon, authenticated;
grant execute on function private.is_valid_payment_evidence_payload(jsonb) to service_role;
grant execute on function private.is_valid_payment_verification_payload(jsonb) to service_role;
grant execute on function private.is_valid_allocation_payload(jsonb) to service_role;
grant execute on function private.is_valid_readiness_input(jsonb) to service_role;
revoke all on function private.financial_denial_result(uuid, text, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function private.financial_denial_result(uuid, text, uuid, uuid, text, text, text, text)
  to service_role;

revoke all on function public.execute_payment_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from public, anon, authenticated;
grant execute on function public.execute_payment_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) to service_role;

comment on table public.payment_evidence_versions is
  'Unverified Customer evidence or human Finance detection. Presence never means verified Payment.';
comment on table public.payment_verification_decisions is
  'Immutable human Finance decisions bound to one exact evidence version and hash.';
comment on table public.fund_allocations is
  'Immutable internal allocation evidence; this table does not execute an external funds transfer.';
comment on table public.financial_readiness_evaluations is
  'Deterministic readiness evidence. READY_FOR_BOOKING does not create or verify a Booking.';
comment on function public.execute_payment_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) is
  'Service-secret-only gateway separating evidence, human Verification, allocation and readiness.';
