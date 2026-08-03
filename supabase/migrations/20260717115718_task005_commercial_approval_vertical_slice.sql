-- VOYARA AI Task 005: Commercial Approval vertical slice.
-- One exact Travel Request version may produce one versioned Quotation.
-- Founder-only AAL2 approval and publication are the safe launch default.
-- This migration intentionally creates no Payment, Booking or Voucher authority.

create table public.commercial_approval_policy_versions (
  id uuid primary key,
  policy_code text not null unique,
  mode text not null,
  created_at timestamptz not null default now(),
  constraint commercial_approval_policy_code_check
    check (policy_code ~ '^[a-z0-9-]{3,80}$'),
  constraint commercial_approval_policy_mode_check
    check (mode = 'FOUNDER_ONLY')
);

insert into public.commercial_approval_policy_versions (id, policy_code, mode)
values (
  '55000000-0000-4000-8000-000000000001',
  'founder-only-v1',
  'FOUNDER_ONLY'
);

create table public.commercial_approval_policy_state (
  singleton boolean primary key default true,
  active_policy_version_id uuid not null unique
    references public.commercial_approval_policy_versions (id) on delete restrict,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint commercial_approval_policy_state_singleton_check check (singleton)
);

insert into public.commercial_approval_policy_state (singleton, active_policy_version_id)
values (true, '55000000-0000-4000-8000-000000000001');

create table public.commercial_quotations (
  id uuid primary key,
  travel_request_id uuid not null unique references public.travel_requests (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  source_request_version integer not null,
  source_request_hash text not null,
  status text not null default 'DRAFT',
  current_version integer not null default 0,
  current_hash text,
  approved_version integer,
  approved_hash text,
  published_version integer,
  published_hash text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  foreign key (travel_request_id, source_request_version, source_request_hash)
    references public.travel_request_versions (travel_request_id, version_number, payload_hash) on delete restrict,
  constraint commercial_quotations_source_version_check check (source_request_version > 0),
  constraint commercial_quotations_source_hash_check check (source_request_hash ~ '^[0-9a-f]{64}$'),
  constraint commercial_quotations_status_check check (
    status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ACCEPTED')
  ),
  constraint commercial_quotations_current_pointer_check check (
    (current_version = 0 and current_hash is null)
    or (current_version > 0 and current_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint commercial_quotations_approved_pointer_check check (
    (approved_version is null and approved_hash is null)
    or (approved_version > 0 and approved_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint commercial_quotations_published_pointer_check check (
    (published_version is null and published_hash is null)
    or (published_version > 0 and published_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint commercial_quotations_state_pointer_check check (
    (status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED')
      and approved_version is null and published_version is null and accepted_at is null)
    or (status = 'APPROVED'
      and approved_version = current_version and approved_hash = current_hash
      and published_version is null and accepted_at is null)
    or (status = 'PUBLISHED'
      and approved_version = current_version and approved_hash = current_hash
      and published_version = approved_version and published_hash = approved_hash
      and accepted_at is null)
    or (status = 'ACCEPTED'
      and approved_version = current_version and approved_hash = current_hash
      and published_version = approved_version and published_hash = approved_hash
      and accepted_at is not null)
  )
);

create index commercial_quotations_customer_updated_idx
  on public.commercial_quotations (customer_id, updated_at desc);

create index commercial_quotations_staff_queue_idx
  on public.commercial_quotations (status, updated_at desc);

create table public.quotation_versions (
  quotation_id uuid not null references public.commercial_quotations (id) on delete restrict,
  version_number integer not null,
  travel_request_id uuid not null references public.travel_requests (id) on delete restrict,
  source_request_version integer not null,
  source_request_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  canonical_payload jsonb not null,
  payload_hash text not null,
  created_by_kind text not null,
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (quotation_id, version_number),
  unique (quotation_id, version_number, payload_hash),
  foreign key (travel_request_id, source_request_version, source_request_hash)
    references public.travel_request_versions (travel_request_id, version_number, payload_hash) on delete restrict,
  constraint quotation_versions_number_check check (version_number > 0),
  constraint quotation_versions_source_hash_check check (source_request_hash ~ '^[0-9a-f]{64}$'),
  constraint quotation_versions_payload_object_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint quotation_versions_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint quotation_versions_creator_kind_check check (created_by_kind in ('human', 'ai_agent')),
  constraint quotation_versions_creator_attribution_check check (
    (created_by_kind = 'human' and created_by is not null)
    or (created_by_kind = 'ai_agent' and created_by is null)
  )
);

alter table public.commercial_quotations
  add constraint commercial_quotations_current_version_fk
    foreign key (id, current_version, current_hash)
    references public.quotation_versions (quotation_id, version_number, payload_hash)
    deferrable initially deferred,
  add constraint commercial_quotations_approved_version_fk
    foreign key (id, approved_version, approved_hash)
    references public.quotation_versions (quotation_id, version_number, payload_hash)
    deferrable initially deferred,
  add constraint commercial_quotations_published_version_fk
    foreign key (id, published_version, published_hash)
    references public.quotation_versions (quotation_id, version_number, payload_hash)
    deferrable initially deferred;

create index quotation_versions_customer_idx
  on public.quotation_versions (customer_id, created_at desc);

create table public.commercial_approval_decisions (
  id uuid primary key,
  quotation_id uuid not null,
  version_number integer not null,
  payload_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  decision text not null,
  reason text not null,
  policy_version_id uuid not null references public.commercial_approval_policy_versions (id) on delete restrict,
  decided_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  decided_at timestamptz not null default now(),
  unique (quotation_id, version_number),
  foreign key (quotation_id, version_number, payload_hash)
    references public.quotation_versions (quotation_id, version_number, payload_hash) on delete restrict,
  constraint commercial_approval_decisions_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint commercial_approval_decisions_decision_check check (decision in ('APPROVE', 'REJECT')),
  constraint commercial_approval_decisions_reason_check check (char_length(btrim(reason)) between 3 and 500),
  constraint commercial_approval_decisions_aal_check check (actor_aal = 'aal2')
);

create index commercial_approval_decisions_customer_idx
  on public.commercial_approval_decisions (customer_id, decided_at desc);

create table public.published_proposals (
  id uuid primary key,
  quotation_id uuid not null unique,
  version_number integer not null,
  payload_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  customer_payload jsonb not null,
  locale text not null,
  valid_until timestamptz not null,
  approval_decision_id uuid not null references public.commercial_approval_decisions (id) on delete restrict,
  published_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  published_at timestamptz not null default now(),
  unique (quotation_id, version_number, payload_hash),
  foreign key (quotation_id, version_number, payload_hash)
    references public.quotation_versions (quotation_id, version_number, payload_hash) on delete restrict,
  constraint published_proposals_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint published_proposals_payload_object_check check (jsonb_typeof(customer_payload) = 'object'),
  constraint published_proposals_locale_check check (locale in ('az', 'ru', 'en')),
  constraint published_proposals_validity_check check (valid_until > published_at)
);

create index published_proposals_customer_idx
  on public.published_proposals (customer_id, published_at desc);

create table public.customer_quotation_acceptances (
  id uuid primary key,
  quotation_id uuid not null unique,
  version_number integer not null,
  payload_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  acceptance_version text not null,
  locale text not null,
  accepted_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  accepted_at timestamptz not null default now(),
  foreign key (quotation_id, version_number, payload_hash)
    references public.published_proposals (quotation_id, version_number, payload_hash) on delete restrict,
  constraint customer_quotation_acceptances_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_quotation_acceptances_version_check
    check (acceptance_version = 'quotation-acceptance-v1'),
  constraint customer_quotation_acceptances_locale_check check (locale in ('az', 'ru', 'en')),
  constraint customer_quotation_acceptances_actor_check check (accepted_by = customer_id)
);

create index customer_quotation_acceptances_customer_idx
  on public.customer_quotation_acceptances (customer_id, accepted_at desc);

create table public.commercial_work_receipts (
  command_id uuid primary key,
  quotation_id uuid not null references public.commercial_quotations (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  action text not null,
  actor_role text not null,
  from_status text,
  to_status text not null,
  version_number integer not null,
  payload_hash text not null,
  occurred_at timestamptz not null default now(),
  constraint commercial_work_receipts_action_check check (action in (
    'quotation.create_version',
    'quotation.submit_for_approval',
    'quotation.decide',
    'quotation.publish',
    'quotation.accept'
  )),
  constraint commercial_work_receipts_actor_role_check
    check (actor_role in ('customer', 'staff', 'manager', 'admin', 'founder')),
  constraint commercial_work_receipts_from_status_check check (
    from_status is null or from_status in (
      'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ACCEPTED'
    )
  ),
  constraint commercial_work_receipts_to_status_check check (
    to_status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ACCEPTED')
  ),
  constraint commercial_work_receipts_version_check check (version_number > 0),
  constraint commercial_work_receipts_hash_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index commercial_work_receipts_quotation_idx
  on public.commercial_work_receipts (quotation_id, occurred_at, command_id);

create index commercial_work_receipts_customer_idx
  on public.commercial_work_receipts (customer_id, occurred_at desc);

create table public.commercial_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint commercial_command_receipts_key_check check (char_length(idempotency_key) between 12 and 160),
  constraint commercial_command_receipts_name_check check (command_name in (
    'quotation.create_version',
    'quotation.submit_for_approval',
    'quotation.decide',
    'quotation.publish',
    'quotation.accept'
  )),
  constraint commercial_command_receipts_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint commercial_command_receipts_response_check check (jsonb_typeof(response) = 'object'),
  constraint commercial_command_receipts_expiry_check check (expires_at > created_at)
);

create index commercial_command_receipts_actor_created_idx
  on public.commercial_command_receipts (actor_id, created_at desc);

create index commercial_command_receipts_expires_idx
  on public.commercial_command_receipts (expires_at);

create or replace function private.reject_commercial_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'commercial authority evidence is append-only' using errcode = '55000';
end;
$$;

create trigger commercial_approval_policy_versions_immutable
before update or delete on public.commercial_approval_policy_versions
for each row execute function private.reject_commercial_evidence_mutation();

create trigger quotation_versions_immutable
before update or delete on public.quotation_versions
for each row execute function private.reject_commercial_evidence_mutation();

create trigger commercial_approval_decisions_immutable
before update or delete on public.commercial_approval_decisions
for each row execute function private.reject_commercial_evidence_mutation();

create trigger published_proposals_immutable
before update or delete on public.published_proposals
for each row execute function private.reject_commercial_evidence_mutation();

create trigger customer_quotation_acceptances_immutable
before update or delete on public.customer_quotation_acceptances
for each row execute function private.reject_commercial_evidence_mutation();

create trigger commercial_work_receipts_immutable
before update or delete on public.commercial_work_receipts
for each row execute function private.reject_commercial_evidence_mutation();

create or replace function private.is_valid_quotation_payload(p_payload jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_customer jsonb;
  v_commercial jsonb;
  v_source jsonb;
  v_risk_flags jsonb;
  v_line_count integer;
  v_subtotal bigint;
  v_service_fee bigint;
  v_discount bigint;
  v_total bigint;
  v_cost bigint;
  v_gross_profit bigint;
  v_margin_bps integer;
  v_calculated_subtotal bigint;
  v_valid_until timestamptz;
begin
  if jsonb_typeof(p_payload) <> 'object' or p_payload->>'schemaVersion' <> 'quotation-v1' then
    return false;
  end if;

  v_source := p_payload->'source';
  v_customer := p_payload->'customer';
  v_commercial := p_payload->'commercial';
  v_risk_flags := p_payload->'riskFlags';

  if jsonb_typeof(v_source) <> 'object'
    or coalesce(v_source->>'travelRequestId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_source->>'travelRequestVersion', '') !~ '^[1-9][0-9]*$'
    or coalesce(v_source->>'travelRequestHash', '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_customer) <> 'object'
    or char_length(btrim(coalesce(v_customer->>'title', ''))) not between 3 and 120
    or char_length(btrim(coalesce(v_customer->>'summary', ''))) not between 10 and 1200
    or coalesce(v_customer->>'locale', '') not in ('az', 'ru', 'en')
    or v_customer->>'currency' <> 'AZN'
    or jsonb_typeof(v_customer->'lineItems') <> 'array'
    or char_length(coalesce(v_customer->>'customerNotes', '')) > 1200
    or jsonb_typeof(v_commercial) <> 'object'
    or jsonb_typeof(v_risk_flags) <> 'array'
  then
    return false;
  end if;

  v_line_count := jsonb_array_length(v_customer->'lineItems');
  if v_line_count not between 1 and 20 then return false; end if;

  if exists (
    select 1 from jsonb_array_elements(v_customer->'lineItems') item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item->>'lineNumber', '') !~ '^[1-9][0-9]*$'
      or char_length(btrim(coalesce(item->>'description', ''))) not between 2 and 160
      or coalesce(item->>'quantity', '') !~ '^[1-9][0-9]*$'
      or (item->>'quantity')::integer not between 1 and 100
      or coalesce(item->>'unitPriceMinor', '') !~ '^[0-9]+$'
      or (item->>'unitPriceMinor')::bigint > 10000000000
      or coalesce(item->>'totalMinor', '') !~ '^[0-9]+$'
      or (item->>'totalMinor')::bigint <> (item->>'quantity')::integer * (item->>'unitPriceMinor')::bigint
  ) then
    return false;
  end if;

  if (
    select count(distinct (item->>'lineNumber')::integer)
    from jsonb_array_elements(v_customer->'lineItems') item
  ) <> v_line_count then
    return false;
  end if;

  select coalesce(sum((item->>'totalMinor')::bigint), 0)
  into v_calculated_subtotal
  from jsonb_array_elements(v_customer->'lineItems') item;

  if coalesce(v_customer->>'subtotalMinor', '') !~ '^[0-9]+$'
    or coalesce(v_customer->>'serviceFeeMinor', '') !~ '^[0-9]+$'
    or coalesce(v_customer->>'discountMinor', '') !~ '^[0-9]+$'
    or coalesce(v_customer->>'totalMinor', '') !~ '^[1-9][0-9]*$'
    or coalesce(v_commercial->>'costTotalMinor', '') !~ '^[0-9]+$'
    or coalesce(v_commercial->>'grossProfitMinor', '') !~ '^-?[0-9]+$'
    or coalesce(v_commercial->>'grossMarginBps', '') !~ '^-?[0-9]+$'
  then
    return false;
  end if;

  v_subtotal := (v_customer->>'subtotalMinor')::bigint;
  v_service_fee := (v_customer->>'serviceFeeMinor')::bigint;
  v_discount := (v_customer->>'discountMinor')::bigint;
  v_total := (v_customer->>'totalMinor')::bigint;
  v_cost := (v_commercial->>'costTotalMinor')::bigint;
  v_gross_profit := (v_commercial->>'grossProfitMinor')::bigint;
  v_margin_bps := (v_commercial->>'grossMarginBps')::integer;

  if v_subtotal <> v_calculated_subtotal
    or v_discount > v_subtotal + v_service_fee
    or v_total <> v_subtotal + v_service_fee - v_discount
    or v_cost > 1000000000000
    or v_gross_profit <> v_total - v_cost
    or v_margin_bps <> trunc((v_gross_profit * 10000)::numeric / v_total)::integer
  then
    return false;
  end if;

  if jsonb_array_length(v_risk_flags) > 6
    or exists (
      select 1 from jsonb_array_elements_text(v_risk_flags) flag
      where flag not in (
        'PRICE_VOLATILITY', 'SUPPLIER_UNVERIFIED', 'LOW_MARGIN',
        'NON_REFUNDABLE', 'MANUAL_CONFIRMATION_REQUIRED', 'CUSTOM_TERMS'
      )
    )
    or (
      select count(*) from jsonb_array_elements_text(v_risk_flags)
    ) <> (
      select count(distinct flag) from jsonb_array_elements_text(v_risk_flags) flag
    )
  then
    return false;
  end if;

  v_valid_until := (v_customer->>'validUntil')::timestamptz;
  if v_valid_until <= now() then return false; end if;

  return true;
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    return false;
end;
$$;

create or replace function private.commercial_denial_result(
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
    'commercial_quotation',
    coalesce(p_entity_id, p_command_id::text),
    case when p_payload_hash ~ '^[0-9a-f]{64}$' then p_payload_hash else repeat('0', 64) end,
    '{}'::jsonb
  );
  return jsonb_build_object('status', 'denied', 'reasonCode', p_reason_code);
end;
$$;

create or replace function public.execute_commercial_command(
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
  v_existing public.commercial_command_receipts%rowtype;
  v_quote public.commercial_quotations%rowtype;
  v_request public.travel_requests%rowtype;
  v_version public.quotation_versions%rowtype;
  v_published public.published_proposals%rowtype;
  v_policy public.commercial_approval_policy_versions%rowtype;
  v_result jsonb;
  v_quotation_id uuid;
  v_request_id uuid;
  v_version_number integer;
  v_quotation_hash text;
  v_canonical_payload jsonb;
  v_decision text;
  v_reason text;
  v_locale text;
  v_from_status text;
  v_to_status text;
  v_actor_role text;
  v_revoked_before timestamptz;
  v_is_customer_command boolean;
  v_is_founder_command boolean;
begin
  select * into v_existing
  from public.commercial_command_receipts
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing.command_name <> p_command_name or v_existing.payload_hash <> p_payload_hash then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'IDEMPOTENCY_CONFLICT', null, p_payload_hash
      );
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in (
    'quotation.create_version',
    'quotation.submit_for_approval',
    'quotation.decide',
    'quotation.publish',
    'quotation.accept'
  ) then
    return private.commercial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'UNREGISTERED_COMMAND', null, p_payload_hash
    );
  end if;

  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload) <> 'object' then
    return private.commercial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'INVALID_PAYLOAD', null, p_payload_hash
    );
  end if;

  if p_actor_session_id is null or p_actor_issued_at is null or p_actor_aal not in ('aal1', 'aal2') then
    return private.commercial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_EVIDENCE_REQUIRED', null, p_payload_hash
    );
  end if;

  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return private.commercial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  select revoked_before into v_revoked_before
  from public.user_session_security
  where user_id = p_actor_id;

  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return private.commercial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  v_is_customer_command := p_command_name = 'quotation.accept';
  v_is_founder_command := p_command_name in ('quotation.decide', 'quotation.publish');

  if v_is_customer_command then
    if not exists (
      select 1 from public.role_assignments
      where user_id = p_actor_id and role = 'customer' and active
    ) then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'CUSTOMER_REQUIRED', null, p_payload_hash
      );
    end if;
    v_actor_role := 'customer';
  else
    if p_actor_aal <> 'aal2' then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'AAL2_REQUIRED', null, p_payload_hash
      );
    end if;

    if v_is_founder_command then
      if not exists (
        select 1 from public.role_assignments
        where user_id = p_actor_id and role = 'founder' and active
      ) then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'FOUNDER_REQUIRED', null, p_payload_hash
        );
      end if;
      v_actor_role := 'founder';
    else
      select role into v_actor_role
      from public.role_assignments
      where user_id = p_actor_id
        and role in ('staff', 'manager', 'admin', 'founder')
        and active
      order by case role
        when 'founder' then 1 when 'admin' then 2 when 'manager' then 3 else 4
      end
      limit 1;

      if v_actor_role is null then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'COMMERCIAL_STAFF_REQUIRED', null, p_payload_hash
        );
      end if;
    end if;
  end if;

  if v_is_customer_command and (
    select count(*) from public.commercial_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '24 hours'
  ) >= 10 then
    return private.commercial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'RATE_LIMITED', null, p_payload_hash
    );
  end if;

  if not v_is_customer_command and (
    select count(*) from public.commercial_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
  ) >= 120 then
    return private.commercial_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'RATE_LIMITED', null, p_payload_hash
    );
  end if;

  begin
    v_quotation_id := nullif(p_payload->>'quotationId', '')::uuid;
    v_request_id := nullif(p_payload->>'travelRequestId', '')::uuid;
    v_version_number := nullif(p_payload->>'versionNumber', '')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_IDENTIFIER', null, p_payload_hash
      );
  end;

  v_quotation_hash := p_payload->>'quotationHash';

  if p_command_name = 'quotation.create_version' then
    if v_request_id is null then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'TRAVEL_REQUEST_REQUIRED', null, p_payload_hash
      );
    end if;

    select * into v_request
    from public.travel_requests
    where id = v_request_id
    for update;

    if not found or v_request.status <> 'HUMAN_REVIEW' then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'HUMAN_REVIEW_REQUIRED', v_request_id::text, p_payload_hash
      );
    end if;

    if v_request.assigned_staff_id is distinct from p_actor_id then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'ASSIGNED_STAFF_REQUIRED', v_request_id::text, p_payload_hash
      );
    end if;

    v_canonical_payload := p_payload->'canonicalPayload';
    if v_quotation_hash is null
      or v_quotation_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_quotation_payload(v_canonical_payload)
      or v_canonical_payload#>>'{source,travelRequestId}' <> v_request_id::text
      or (v_canonical_payload#>>'{source,travelRequestVersion}')::integer <> v_request.current_version
      or v_canonical_payload#>>'{source,travelRequestHash}' <> (
        select payload_hash from public.travel_request_versions
        where travel_request_id = v_request.id and version_number = v_request.current_version
      )
    then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_QUOTATION_VERSION', v_request_id::text, p_payload_hash
      );
    end if;

    if v_quotation_id is null then
      select * into v_quote
      from public.commercial_quotations
      where travel_request_id = v_request_id
      for update;

      if found then
        v_quotation_id := v_quote.id;
      else
        v_quotation_id := p_command_id;
        insert into public.commercial_quotations (
          id, travel_request_id, customer_id, source_request_version,
          source_request_hash, created_by
        ) values (
          v_quotation_id, v_request.id, v_request.customer_id, v_request.current_version,
          v_canonical_payload#>>'{source,travelRequestHash}', p_actor_id
        );
        select * into v_quote
        from public.commercial_quotations where id = v_quotation_id for update;
      end if;
    else
      select * into v_quote
      from public.commercial_quotations
      where id = v_quotation_id
      for update;
      if not found or v_quote.travel_request_id <> v_request_id then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'QUOTATION_NOT_FOUND', coalesce(v_quotation_id::text, v_request_id::text), p_payload_hash
        );
      end if;
    end if;

    if v_quote.status not in ('DRAFT', 'REJECTED') then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'QUOTATION_NOT_EDITABLE', v_quotation_id::text, p_payload_hash
      );
    end if;

    v_from_status := case when v_quote.current_version = 0 then null else v_quote.status end;
    v_to_status := 'DRAFT';
    v_version_number := v_quote.current_version + 1;

    insert into public.quotation_versions (
      quotation_id, version_number, travel_request_id, source_request_version,
      source_request_hash, customer_id, canonical_payload, payload_hash,
      created_by_kind, created_by
    ) values (
      v_quotation_id, v_version_number, v_request.id, v_request.current_version,
      v_canonical_payload#>>'{source,travelRequestHash}', v_request.customer_id,
      v_canonical_payload, v_quotation_hash, 'human', p_actor_id
    );

    update public.commercial_quotations
    set status = 'DRAFT', current_version = v_version_number, current_hash = v_quotation_hash,
        approved_version = null, approved_hash = null,
        published_version = null, published_hash = null,
        accepted_at = null, updated_at = now()
    where id = v_quotation_id;

  else
    if v_quotation_id is null or v_version_number is null
      or v_quotation_hash is null or v_quotation_hash !~ '^[0-9a-f]{64}$'
    then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_QUOTATION_VERSION_REQUIRED', coalesce(v_quotation_id::text, p_command_id::text), p_payload_hash
      );
    end if;

    select * into v_quote
    from public.commercial_quotations
    where id = v_quotation_id
    for update;

    if not found then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'QUOTATION_NOT_FOUND', v_quotation_id::text, p_payload_hash
      );
    end if;

    if v_quote.current_version <> v_version_number or v_quote.current_hash <> v_quotation_hash then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'QUOTATION_HASH_MISMATCH', v_quotation_id::text, p_payload_hash
      );
    end if;

    select * into v_version
    from public.quotation_versions
    where quotation_id = v_quotation_id
      and version_number = v_version_number
      and payload_hash = v_quotation_hash;

    if not found then
      return private.commercial_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'QUOTATION_VERSION_NOT_FOUND', v_quotation_id::text, p_payload_hash
      );
    end if;

    if p_command_name = 'quotation.submit_for_approval' then
      select * into v_request
      from public.travel_requests
      where id = v_quote.travel_request_id;

      if v_request.assigned_staff_id is distinct from p_actor_id then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'ASSIGNED_STAFF_REQUIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      if v_quote.status <> 'DRAFT' then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_STATE_TRANSITION', v_quotation_id::text, p_payload_hash
        );
      end if;

      v_from_status := 'DRAFT';
      v_to_status := 'PENDING_APPROVAL';
      update public.commercial_quotations
      set status = v_to_status, updated_at = now()
      where id = v_quotation_id;

    elsif p_command_name = 'quotation.decide' then
      v_decision := p_payload->>'decision';
      v_reason := btrim(coalesce(p_payload->>'reason', ''));
      if v_decision not in ('APPROVE', 'REJECT') or char_length(v_reason) not between 3 and 500 then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_APPROVAL_DECISION', v_quotation_id::text, p_payload_hash
        );
      end if;

      if v_quote.status <> 'PENDING_APPROVAL' then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_STATE_TRANSITION', v_quotation_id::text, p_payload_hash
        );
      end if;

      select * into v_policy
      from public.commercial_approval_policy_versions
      where id = (
        select active_policy_version_id
        from public.commercial_approval_policy_state
        where singleton
      );

      if not found or v_policy.mode <> 'FOUNDER_ONLY' then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'APPROVAL_POLICY_UNAVAILABLE', v_quotation_id::text, p_payload_hash
        );
      end if;

      insert into public.commercial_approval_decisions (
        id, quotation_id, version_number, payload_hash, customer_id,
        decision, reason, policy_version_id, decided_by, actor_session_id, actor_aal
      ) values (
        p_command_id, v_quotation_id, v_version_number, v_quotation_hash, v_quote.customer_id,
        v_decision, v_reason, v_policy.id, p_actor_id, p_actor_session_id, p_actor_aal
      );

      v_from_status := 'PENDING_APPROVAL';
      if v_decision = 'APPROVE' then
        v_to_status := 'APPROVED';
        update public.commercial_quotations
        set status = v_to_status, approved_version = v_version_number,
            approved_hash = v_quotation_hash, updated_at = now()
        where id = v_quotation_id;
      else
        v_to_status := 'REJECTED';
        update public.commercial_quotations
        set status = v_to_status, updated_at = now()
        where id = v_quotation_id;
      end if;

    elsif p_command_name = 'quotation.publish' then
      if v_quote.status <> 'APPROVED'
        or v_quote.approved_version <> v_version_number
        or v_quote.approved_hash <> v_quotation_hash
      then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_APPROVAL_REQUIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      if (v_version.canonical_payload#>>'{customer,validUntil}')::timestamptz <= now() then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'QUOTATION_EXPIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      insert into public.published_proposals (
        id, quotation_id, version_number, payload_hash, customer_id,
        customer_payload, locale, valid_until, approval_decision_id,
        published_by, actor_session_id
      )
      select
        p_command_id, v_quotation_id, v_version_number, v_quotation_hash, v_quote.customer_id,
        v_version.canonical_payload->'customer',
        v_version.canonical_payload#>>'{customer,locale}',
        (v_version.canonical_payload#>>'{customer,validUntil}')::timestamptz,
        decision.id, p_actor_id, p_actor_session_id
      from public.commercial_approval_decisions decision
      where decision.quotation_id = v_quotation_id
        and decision.version_number = v_version_number
        and decision.payload_hash = v_quotation_hash
        and decision.decision = 'APPROVE';

      if not found then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_APPROVAL_REQUIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      v_from_status := 'APPROVED';
      v_to_status := 'PUBLISHED';
      update public.commercial_quotations
      set status = v_to_status, published_version = v_version_number,
          published_hash = v_quotation_hash, updated_at = now()
      where id = v_quotation_id;

    else
      if v_quote.customer_id <> p_actor_id then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'CUSTOMER_OWNERSHIP_REQUIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      if v_quote.status <> 'PUBLISHED'
        or v_quote.published_version <> v_version_number
        or v_quote.published_hash <> v_quotation_hash
      then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_PUBLISHED_PROPOSAL_REQUIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      select * into v_published
      from public.published_proposals
      where quotation_id = v_quotation_id
        and version_number = v_version_number
        and payload_hash = v_quotation_hash;

      v_locale := p_payload->>'locale';
      if not found or v_published.valid_until <= now() then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'PUBLISHED_PROPOSAL_EXPIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      if v_locale <> v_published.locale or p_payload->>'acceptanceConfirmed' <> 'true' then
        return private.commercial_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_ACCEPTANCE_CONFIRMATION_REQUIRED', v_quotation_id::text, p_payload_hash
        );
      end if;

      insert into public.customer_quotation_acceptances (
        id, quotation_id, version_number, payload_hash, customer_id,
        acceptance_version, locale, accepted_by, actor_session_id
      ) values (
        p_command_id, v_quotation_id, v_version_number, v_quotation_hash, p_actor_id,
        'quotation-acceptance-v1', v_locale, p_actor_id, p_actor_session_id
      );

      v_from_status := 'PUBLISHED';
      v_to_status := 'ACCEPTED';
      update public.commercial_quotations
      set status = v_to_status, accepted_at = now(), updated_at = now()
      where id = v_quotation_id;
    end if;
  end if;

  insert into public.commercial_work_receipts (
    command_id, quotation_id, customer_id, action, actor_role,
    from_status, to_status, version_number, payload_hash
  ) values (
    p_command_id, v_quotation_id, coalesce(v_quote.customer_id, v_request.customer_id),
    p_command_name, v_actor_role, v_from_status, v_to_status,
    v_version_number, v_quotation_hash
  );

  v_result := jsonb_build_object(
    'status', 'accepted',
    'commandName', p_command_name,
    'quotationId', v_quotation_id,
    'quotationStatus', v_to_status,
    'versionNumber', v_version_number,
    'payloadHash', v_quotation_hash,
    'workReceiptId', p_command_id
  );

  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal,
    p_command_name, 'accepted', null, 'commercial_quotation', v_quotation_id::text,
    v_quotation_hash,
    jsonb_build_object(
      'fromStatus', v_from_status,
      'toStatus', v_to_status,
      'versionNumber', v_version_number,
      'actorRole', v_actor_role
    )
  );

  insert into public.commercial_command_receipts (
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
    from public.commercial_command_receipts
    where idempotency_key = p_idempotency_key
      and command_name = p_command_name
      and payload_hash = p_payload_hash;
    if found then return v_result; end if;
    raise;
end;
$$;

alter table public.commercial_approval_policy_versions enable row level security;
alter table public.commercial_approval_policy_versions force row level security;
alter table public.commercial_approval_policy_state enable row level security;
alter table public.commercial_approval_policy_state force row level security;
alter table public.commercial_quotations enable row level security;
alter table public.commercial_quotations force row level security;
alter table public.quotation_versions enable row level security;
alter table public.quotation_versions force row level security;
alter table public.commercial_approval_decisions enable row level security;
alter table public.commercial_approval_decisions force row level security;
alter table public.published_proposals enable row level security;
alter table public.published_proposals force row level security;
alter table public.customer_quotation_acceptances enable row level security;
alter table public.customer_quotation_acceptances force row level security;
alter table public.commercial_work_receipts enable row level security;
alter table public.commercial_work_receipts force row level security;
alter table public.commercial_command_receipts enable row level security;
alter table public.commercial_command_receipts force row level security;

create policy commercial_policy_versions_select_aal2_staff
on public.commercial_approval_policy_versions
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
  )
);

create policy commercial_policy_state_select_aal2_staff
on public.commercial_approval_policy_state
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
  )
);

create policy commercial_quotations_select_aal2_staff
on public.commercial_quotations
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
  )
);

create policy quotation_versions_select_aal2_staff
on public.quotation_versions
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
  )
);

create policy commercial_approval_decisions_select_aal2_staff
on public.commercial_approval_decisions
for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
  )
);

create policy published_proposals_select_customer_or_aal2_staff
on public.published_proposals
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
    )
  )
);

create policy customer_quotation_acceptances_select_customer_or_aal2_staff
on public.customer_quotation_acceptances
for select to authenticated
using (
  (select auth.uid()) = customer_id
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
    )
  )
);

create policy commercial_work_receipts_select_customer_or_aal2_staff
on public.commercial_work_receipts
for select to authenticated
using (
  ((select auth.uid()) = customer_id and action in ('quotation.publish', 'quotation.accept'))
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'finance', 'admin', 'founder') and active
    )
  )
);

revoke all on table public.commercial_approval_policy_versions from anon, authenticated;
grant select on table public.commercial_approval_policy_versions to authenticated;

revoke all on table public.commercial_approval_policy_state from anon, authenticated;
grant select on table public.commercial_approval_policy_state to authenticated;

revoke all on table public.commercial_quotations from anon, authenticated;
grant select on table public.commercial_quotations to authenticated;

revoke all on table public.quotation_versions from anon, authenticated;
grant select on table public.quotation_versions to authenticated;

revoke all on table public.commercial_approval_decisions from anon, authenticated;
grant select on table public.commercial_approval_decisions to authenticated;

revoke all on table public.published_proposals from anon, authenticated;
grant select (
  id, quotation_id, version_number, payload_hash, customer_id,
  customer_payload, locale, valid_until, published_at
) on table public.published_proposals to authenticated;

revoke all on table public.customer_quotation_acceptances from anon, authenticated;
grant select (
  id, quotation_id, version_number, payload_hash, customer_id,
  acceptance_version, locale, accepted_at
) on table public.customer_quotation_acceptances to authenticated;

revoke all on table public.commercial_work_receipts from anon, authenticated;
grant select on table public.commercial_work_receipts to authenticated;

revoke all on table public.commercial_command_receipts from anon, authenticated;

grant select on table public.commercial_approval_policy_versions to service_role;
grant select, update on table public.commercial_approval_policy_state to service_role;
grant select, insert, update on table public.commercial_quotations to service_role;
grant select, insert on table public.quotation_versions to service_role;
grant select, insert on table public.commercial_approval_decisions to service_role;
grant select, insert on table public.published_proposals to service_role;
grant select, insert on table public.customer_quotation_acceptances to service_role;
grant select, insert on table public.commercial_work_receipts to service_role;
grant select, insert on table public.commercial_command_receipts to service_role;

revoke all on function private.reject_commercial_evidence_mutation() from public, anon, authenticated;
revoke all on function private.is_valid_quotation_payload(jsonb) from public, anon, authenticated;
grant execute on function private.is_valid_quotation_payload(jsonb) to service_role;
revoke all on function private.commercial_denial_result(uuid, text, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function private.commercial_denial_result(uuid, text, uuid, uuid, text, text, text, text)
  to service_role;

revoke all on function public.execute_commercial_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from public, anon, authenticated;
grant execute on function public.execute_commercial_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) to service_role;

comment on table public.quotation_versions is
  'Append-only full Quotation versions. Customer publication exposes only the customer payload and the same full-version hash.';
comment on table public.commercial_approval_decisions is
  'Founder-only Task 005 decisions bound to one exact Quotation version and SHA-256 hash.';
comment on table public.published_proposals is
  'Immutable Customer-safe proposal snapshots tied to the exact approved full-version hash.';
comment on function public.execute_commercial_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text) is
  'Service-role-only, security-invoker transaction boundary for Task 005 commercial commands.';
