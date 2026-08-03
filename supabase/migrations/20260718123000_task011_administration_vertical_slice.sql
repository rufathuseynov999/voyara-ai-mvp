-- VOYARA AI Task 011: launch administration vertical slice.
-- CRM tasks coordinate work but never change commercial, Payment, Booking,
-- Voucher, Support or Refund authority. Approved Membership prices are seeded
-- as immutable exact versions. Supplier configuration contains no credentials
-- and performs no Supplier action.

create table public.membership_plans (
  plan_code text primary key,
  audience text not null,
  display_order integer not null,
  status text not null default 'ACTIVE',
  current_version integer not null,
  current_hash text not null,
  constraint membership_plans_code_check check (plan_code ~ '^[a-z][a-z0-9-]{2,39}$'),
  constraint membership_plans_audience_check check (audience in ('PERSONAL', 'CORPORATE')),
  constraint membership_plans_order_check check (display_order > 0),
  constraint membership_plans_status_check check (status = 'ACTIVE'),
  constraint membership_plans_version_check check (current_version = 1),
  constraint membership_plans_hash_check check (current_hash ~ '^[0-9a-f]{64}$')
);

create table public.membership_plan_versions (
  plan_code text not null references public.membership_plans (plan_code) on delete restrict,
  version_number integer not null,
  audience text not null,
  display_name text not null,
  currency text not null,
  monthly_minor bigint,
  annual_minor bigint,
  pricing_model text not null,
  canonical_payload jsonb not null,
  payload_hash text not null,
  ratification_source text not null,
  created_at timestamptz not null default now(),
  primary key (plan_code, version_number),
  unique (plan_code, version_number, payload_hash),
  constraint membership_versions_number_check check (version_number = 1),
  constraint membership_versions_audience_check check (audience in ('PERSONAL', 'CORPORATE')),
  constraint membership_versions_name_check check (char_length(btrim(display_name)) between 2 and 80),
  constraint membership_versions_currency_check check (currency = 'AZN'),
  constraint membership_versions_price_check check (
    (pricing_model = 'FIXED' and monthly_minor between 1 and 100000000 and (annual_minor is null or annual_minor between 1 and 1000000000))
    or (pricing_model = 'CUSTOM' and monthly_minor is null and annual_minor is null)
  ),
  constraint membership_versions_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint membership_versions_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint membership_versions_source_check check (ratification_source = 'FOUNDER_BASELINE')
);

insert into public.membership_plans (plan_code, audience, display_order, current_version, current_hash)
values
  ('smart', 'PERSONAL', 1, 1, 'b328e7ec6b0e783ea6c9bdd68977b7fb328c3a604a0aca18f602c96415c57f18'),
  ('plus', 'PERSONAL', 2, 1, '60aac9ec6b94b04bae49533f6d1679ea184288ffd6b6a8577da363a9eba97b63'),
  ('premium', 'PERSONAL', 3, 1, 'e0677324b46b7ab08bcea8a5db5c5387dd21d4a9a6780e949b5a53f521045937'),
  ('black', 'PERSONAL', 4, 1, '868e9cd896c874c67721ab46ef4b1e44e8901a3d9c9075af2c7d15f29a359360'),
  ('starter', 'CORPORATE', 101, 1, '1f8cbf088024b22b2b55876db340f6e2465ad3fc93bb12b9d82ba0d3f4dd1d7f'),
  ('standard', 'CORPORATE', 102, 1, '58d3489c9a41636cda1164f72db79696bb0001b935508ed71034253e1ec60cdf'),
  ('professional', 'CORPORATE', 103, 1, '9973846aa95734f6eaacd47f93973b71213e8c47f704a38105d5880050d48ee6'),
  ('enterprise', 'CORPORATE', 104, 1, 'fb49e8e7821de3890c6d6f2902d5bc1a89c10bd5a0c3362c2dcfd3e828836bce');

insert into public.membership_plan_versions (
  plan_code, version_number, audience, display_name, currency,
  monthly_minor, annual_minor, pricing_model, canonical_payload,
  payload_hash, ratification_source
)
values
  ('smart', 1, 'PERSONAL', 'Smart', 'AZN', 1900, 19000, 'FIXED',
   '{"schemaVersion":"membership-plan-v1","planCode":"smart","audience":"PERSONAL","displayName":"Smart","currency":"AZN","monthlyMinor":1900,"annualMinor":19000,"pricingModel":"FIXED","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   'b328e7ec6b0e783ea6c9bdd68977b7fb328c3a604a0aca18f602c96415c57f18', 'FOUNDER_BASELINE'),
  ('plus', 1, 'PERSONAL', 'Plus', 'AZN', 3900, 39000, 'FIXED',
   '{"schemaVersion":"membership-plan-v1","planCode":"plus","audience":"PERSONAL","displayName":"Plus","currency":"AZN","monthlyMinor":3900,"annualMinor":39000,"pricingModel":"FIXED","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   '60aac9ec6b94b04bae49533f6d1679ea184288ffd6b6a8577da363a9eba97b63', 'FOUNDER_BASELINE'),
  ('premium', 1, 'PERSONAL', 'Premium', 'AZN', 6900, 69000, 'FIXED',
   '{"schemaVersion":"membership-plan-v1","planCode":"premium","audience":"PERSONAL","displayName":"Premium","currency":"AZN","monthlyMinor":6900,"annualMinor":69000,"pricingModel":"FIXED","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   'e0677324b46b7ab08bcea8a5db5c5387dd21d4a9a6780e949b5a53f521045937', 'FOUNDER_BASELINE'),
  ('black', 1, 'PERSONAL', 'Black', 'AZN', 29900, 299000, 'FIXED',
   '{"schemaVersion":"membership-plan-v1","planCode":"black","audience":"PERSONAL","displayName":"Black","currency":"AZN","monthlyMinor":29900,"annualMinor":299000,"pricingModel":"FIXED","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   '868e9cd896c874c67721ab46ef4b1e44e8901a3d9c9075af2c7d15f29a359360', 'FOUNDER_BASELINE'),
  ('starter', 1, 'CORPORATE', 'Starter', 'AZN', 14900, null, 'FIXED',
   '{"schemaVersion":"membership-plan-v1","planCode":"starter","audience":"CORPORATE","displayName":"Starter","currency":"AZN","monthlyMinor":14900,"annualMinor":null,"pricingModel":"FIXED","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   '1f8cbf088024b22b2b55876db340f6e2465ad3fc93bb12b9d82ba0d3f4dd1d7f', 'FOUNDER_BASELINE'),
  ('standard', 1, 'CORPORATE', 'Standard', 'AZN', 29900, null, 'FIXED',
   '{"schemaVersion":"membership-plan-v1","planCode":"standard","audience":"CORPORATE","displayName":"Standard","currency":"AZN","monthlyMinor":29900,"annualMinor":null,"pricingModel":"FIXED","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   '58d3489c9a41636cda1164f72db79696bb0001b935508ed71034253e1ec60cdf', 'FOUNDER_BASELINE'),
  ('professional', 1, 'CORPORATE', 'Professional', 'AZN', 59900, null, 'FIXED',
   '{"schemaVersion":"membership-plan-v1","planCode":"professional","audience":"CORPORATE","displayName":"Professional","currency":"AZN","monthlyMinor":59900,"annualMinor":null,"pricingModel":"FIXED","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   '9973846aa95734f6eaacd47f93973b71213e8c47f704a38105d5880050d48ee6', 'FOUNDER_BASELINE'),
  ('enterprise', 1, 'CORPORATE', 'Enterprise', 'AZN', null, null, 'CUSTOM',
   '{"schemaVersion":"membership-plan-v1","planCode":"enterprise","audience":"CORPORATE","displayName":"Enterprise","currency":"AZN","monthlyMinor":null,"annualMinor":null,"pricingModel":"CUSTOM","ratificationSource":"FOUNDER_BASELINE"}'::jsonb,
   'fb49e8e7821de3890c6d6f2902d5bc1a89c10bd5a0c3362c2dcfd3e828836bce', 'FOUNDER_BASELINE');

alter table public.membership_plans
  add constraint membership_plans_current_version_fk
  foreign key (plan_code, current_version, current_hash)
  references public.membership_plan_versions (plan_code, version_number, payload_hash)
  deferrable initially deferred;

create table public.crm_tasks (
  id uuid primary key,
  travel_request_id uuid not null references public.travel_requests (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  request_version integer not null,
  request_hash text not null,
  task_type text not null,
  title text not null,
  owner_id uuid references auth.users (id) on delete restrict,
  status text not null default 'OPEN',
  due_at timestamptz not null,
  current_version integer not null default 1,
  current_hash text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  foreign key (travel_request_id, request_version, request_hash)
    references public.travel_request_versions (travel_request_id, version_number, payload_hash) on delete restrict,
  constraint crm_tasks_request_version_check check (request_version > 0),
  constraint crm_tasks_request_hash_check check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint crm_tasks_type_check check (task_type in (
    'CUSTOMER_FOLLOW_UP', 'DOCUMENT_REVIEW', 'PAYMENT_FOLLOW_UP', 'SUPPLIER_CHECK',
    'BOOKING_FOLLOW_UP', 'SUPPORT_HANDOFF', 'OTHER'
  )),
  constraint crm_tasks_title_check check (char_length(btrim(title)) between 5 and 120),
  constraint crm_tasks_status_check check (status in ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  constraint crm_tasks_due_check check (due_at > created_at),
  constraint crm_tasks_version_check check (current_version > 0),
  constraint crm_tasks_hash_check check (current_hash ~ '^[0-9a-f]{64}$'),
  constraint crm_tasks_terminal_check check (
    (status = 'DONE' and completed_at is not null and cancelled_at is null)
    or (status = 'CANCELLED' and cancelled_at is not null and completed_at is null)
    or (status in ('OPEN', 'IN_PROGRESS') and completed_at is null and cancelled_at is null)
  )
);

create table public.crm_task_events (
  id uuid primary key,
  task_id uuid not null references public.crm_tasks (id) on delete restrict,
  event_version integer not null,
  previous_event_hash text,
  event_type text not null,
  note text not null,
  canonical_payload jsonb not null,
  event_hash text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  occurred_at timestamptz not null default now(),
  unique (task_id, event_version),
  unique (task_id, event_version, event_hash),
  constraint crm_task_events_version_check check (event_version > 0),
  constraint crm_task_events_previous_hash_check check (previous_event_hash is null or previous_event_hash ~ '^[0-9a-f]{64}$'),
  constraint crm_task_events_type_check check (event_type in (
    'TASK_CREATED', 'TASK_CLAIMED', 'TASK_REASSIGNED', 'TASK_STATUS_CHANGED', 'TASK_CANCELLED'
  )),
  constraint crm_task_events_note_check check (char_length(btrim(note)) between 8 and 500),
  constraint crm_task_events_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint crm_task_events_hash_check check (event_hash ~ '^[0-9a-f]{64}$'),
  constraint crm_task_events_aal_check check (actor_aal = 'aal2')
);

alter table public.crm_tasks
  add constraint crm_tasks_current_event_fk
  foreign key (id, current_version, current_hash)
  references public.crm_task_events (task_id, event_version, event_hash)
  deferrable initially deferred;

create index crm_tasks_queue_idx on public.crm_tasks (status, due_at, updated_at);
create index crm_tasks_owner_idx on public.crm_tasks (owner_id, status, due_at);
create index crm_tasks_request_idx on public.crm_tasks (travel_request_id, created_at desc);
create index crm_task_events_task_idx on public.crm_task_events (task_id, event_version);

create table public.supplier_registry (
  id uuid primary key,
  code text not null unique,
  status text not null,
  current_version integer not null,
  current_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_registry_code_check check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  constraint supplier_registry_status_check check (status in ('ACTIVE', 'PAUSED')),
  constraint supplier_registry_version_check check (current_version > 0),
  constraint supplier_registry_hash_check check (current_hash ~ '^[0-9a-f]{64}$')
);

create table public.supplier_configuration_versions (
  supplier_id uuid not null references public.supplier_registry (id) on delete restrict,
  version_number integer not null,
  previous_version_hash text,
  code text not null,
  display_name text not null,
  service_category text not null,
  operational_channel text not null,
  status text not null,
  operations_note text not null,
  canonical_payload jsonb not null,
  configuration_hash text not null,
  reason text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  created_at timestamptz not null default now(),
  primary key (supplier_id, version_number),
  unique (supplier_id, version_number, configuration_hash),
  constraint supplier_versions_number_check check (version_number > 0),
  constraint supplier_versions_previous_hash_check check (previous_version_hash is null or previous_version_hash ~ '^[0-9a-f]{64}$'),
  constraint supplier_versions_code_check check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  constraint supplier_versions_name_check check (char_length(btrim(display_name)) between 2 and 120),
  constraint supplier_versions_category_check check (service_category in (
    'FLIGHT', 'HOTEL', 'TRANSFER', 'INSURANCE', 'TOUR', 'VISA_SUPPORT', 'OTHER'
  )),
  constraint supplier_versions_channel_check check (operational_channel in ('EMAIL', 'PHONE', 'PORTAL', 'MESSAGING', 'MANUAL')),
  constraint supplier_versions_status_check check (status in ('ACTIVE', 'PAUSED')),
  constraint supplier_versions_note_check check (char_length(operations_note) <= 500),
  constraint supplier_versions_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint supplier_versions_hash_check check (configuration_hash ~ '^[0-9a-f]{64}$'),
  constraint supplier_versions_reason_check check (char_length(btrim(reason)) between 8 and 500),
  constraint supplier_versions_aal_check check (actor_aal = 'aal2')
);

alter table public.supplier_registry
  add constraint supplier_registry_current_version_fk
  foreign key (id, current_version, current_hash)
  references public.supplier_configuration_versions (supplier_id, version_number, configuration_hash)
  deferrable initially deferred;

create index supplier_versions_supplier_idx on public.supplier_configuration_versions (supplier_id, version_number desc);

create table public.administration_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint administration_receipts_key_check check (char_length(idempotency_key) between 12 and 160),
  constraint administration_receipts_name_check check (command_name in (
    'crm.task.create', 'crm.task.claim', 'crm.task.status.set', 'crm.task.reassign', 'crm.task.cancel',
    'supplier.configuration.create', 'supplier.configuration.revise'
  )),
  constraint administration_receipts_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint administration_receipts_response_check check (jsonb_typeof(response) = 'object'),
  constraint administration_receipts_expiry_check check (expires_at > created_at)
);

create index administration_receipts_actor_idx on public.administration_command_receipts (actor_id, created_at desc);

create or replace function private.reject_administration_evidence_mutation()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception 'administration evidence is append-only' using errcode = '55000';
end;
$$;

create trigger membership_plans_immutable before update or delete on public.membership_plans
for each row execute function private.reject_administration_evidence_mutation();
create trigger membership_plan_versions_immutable before update or delete on public.membership_plan_versions
for each row execute function private.reject_administration_evidence_mutation();
create trigger crm_task_events_immutable before update or delete on public.crm_task_events
for each row execute function private.reject_administration_evidence_mutation();
create trigger supplier_configuration_versions_immutable before update or delete on public.supplier_configuration_versions
for each row execute function private.reject_administration_evidence_mutation();
create trigger administration_receipts_immutable before update or delete on public.administration_command_receipts
for each row execute function private.reject_administration_evidence_mutation();

create or replace function private.guard_crm_task_update()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'CRM tasks cannot be deleted' using errcode = '55000'; end if;
  if new.id <> old.id or new.travel_request_id <> old.travel_request_id
    or new.customer_id <> old.customer_id or new.request_version <> old.request_version
    or new.request_hash <> old.request_hash or new.task_type <> old.task_type
    or new.title <> old.title or new.due_at <> old.due_at or new.created_by <> old.created_by
    or new.created_at <> old.created_at
  then raise exception 'CRM task authority identity is immutable' using errcode = '55000'; end if;
  if old.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal CRM tasks are immutable' using errcode = '55000';
  end if;
  if new.current_version <> old.current_version + 1 or new.current_hash = old.current_hash
    or not exists (
      select 1 from public.crm_task_events e
      where e.task_id = new.id and e.event_version = new.current_version
        and e.event_hash = new.current_hash and e.previous_event_hash = old.current_hash
        and e.canonical_payload->>'status' = new.status
        and (e.canonical_payload->>'ownerId') is not distinct from new.owner_id::text
    )
  then raise exception 'CRM task update requires the next immutable event' using errcode = '55000'; end if;
  if not (
    new.status = old.status
    or (old.status = 'OPEN' and new.status in ('IN_PROGRESS', 'DONE', 'CANCELLED'))
    or (old.status = 'IN_PROGRESS' and new.status in ('DONE', 'CANCELLED'))
  ) then raise exception 'invalid CRM task transition' using errcode = '55000'; end if;
  return new;
end;
$$;

create trigger crm_tasks_guarded before update or delete on public.crm_tasks
for each row execute function private.guard_crm_task_update();

create or replace function private.guard_supplier_registry_update()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Supplier registry entries cannot be deleted' using errcode = '55000'; end if;
  if new.id <> old.id or new.code <> old.code or new.created_at <> old.created_at
  then raise exception 'Supplier identity is immutable' using errcode = '55000'; end if;
  if new.current_version <> old.current_version + 1 or new.current_hash = old.current_hash
    or not exists (
      select 1 from public.supplier_configuration_versions v
      where v.supplier_id = new.id and v.version_number = new.current_version
        and v.configuration_hash = new.current_hash and v.previous_version_hash = old.current_hash
        and v.code = new.code and v.status = new.status
    )
  then raise exception 'Supplier change requires the next immutable version' using errcode = '55000'; end if;
  return new;
end;
$$;

create trigger supplier_registry_guarded before update or delete on public.supplier_registry
for each row execute function private.guard_supplier_registry_update();

create or replace function private.administration_denial_result(
  p_command_id uuid, p_command_name text, p_actor_id uuid, p_actor_session_id uuid,
  p_actor_aal text, p_reason_code text, p_entity_type text, p_entity_id text,
  p_payload_hash text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
    'denied', p_reason_code, coalesce(p_entity_type, 'administration_command'),
    coalesce(p_entity_id, p_command_id::text),
    case when p_payload_hash ~ '^[0-9a-f]{64}$' then p_payload_hash else repeat('0', 64) end,
    jsonb_build_object('authorityDomainsUnaffected', true)
  );
  return jsonb_build_object('status', 'denied', 'reasonCode', p_reason_code);
end;
$$;

create or replace function public.execute_administration_command(
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
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing public.administration_command_receipts%rowtype;
  v_task public.crm_tasks%rowtype;
  v_request public.travel_requests%rowtype;
  v_supplier public.supplier_registry%rowtype;
  v_task_id uuid;
  v_supplier_id uuid;
  v_owner_id uuid;
  v_expected_version integer;
  v_expected_hash text;
  v_event jsonb;
  v_event_hash text;
  v_configuration jsonb;
  v_configuration_hash text;
  v_event_version integer;
  v_event_type text;
  v_task_status text;
  v_actor_role text;
  v_revoked_before timestamptz;
  v_result jsonb;
  v_due_at timestamptz;
  v_authority_hash text;
begin
  select * into v_existing from public.administration_command_receipts
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_name <> p_command_name or v_existing.payload_hash <> p_payload_hash then
      return private.administration_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'IDEMPOTENCY_CONFLICT', null, null, p_payload_hash
      );
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in (
    'crm.task.create', 'crm.task.claim', 'crm.task.status.set', 'crm.task.reassign', 'crm.task.cancel',
    'supplier.configuration.create', 'supplier.configuration.revise'
  ) then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'UNREGISTERED_COMMAND', null, null, p_payload_hash
    );
  end if;
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_payload) <> 'object' or p_actor_session_id is null
    or p_actor_issued_at is null or p_actor_aal <> 'aal2'
  then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'AAL2_COMMAND_CONTEXT_REQUIRED', null, null, p_payload_hash
    );
  end if;
  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, null, p_payload_hash
    );
  end if;
  select revoked_before into v_revoked_before from public.user_session_security where user_id = p_actor_id;
  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, null, p_payload_hash
    );
  end if;
  select role into v_actor_role from public.role_assignments
  where user_id = p_actor_id and active
    and role in ('staff', 'manager', 'finance', 'admin', 'founder')
  order by case role when 'founder' then 1 when 'admin' then 2 when 'manager' then 3 when 'finance' then 4 else 5 end
  limit 1;
  if v_actor_role is null then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'ADMINISTRATION_AUTHORITY_REQUIRED', null, null, p_payload_hash
    );
  end if;
  if p_command_name in ('crm.task.reassign', 'crm.task.cancel', 'supplier.configuration.create', 'supplier.configuration.revise')
    and v_actor_role not in ('manager', 'admin', 'founder')
  then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'ELEVATED_ADMINISTRATION_AUTHORITY_REQUIRED', null, null, p_payload_hash
    );
  end if;
  if (select count(*) from public.administration_command_receipts
      where actor_id = p_actor_id and created_at >= now() - interval '1 hour') >= 120
  then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'RATE_LIMITED', null, null, p_payload_hash
    );
  end if;

  begin
    v_task_id := nullif(p_payload->>'taskId', '')::uuid;
    v_supplier_id := nullif(p_payload->>'supplierId', '')::uuid;
    v_expected_version := nullif(p_payload->>'expectedVersion', '')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return private.administration_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'INVALID_IDENTIFIER', null, null, p_payload_hash
    );
  end;
  v_expected_hash := p_payload->>'expectedHash';

  if p_command_name like 'crm.task.%' then
    v_event := p_payload->'taskEventPayload';
    v_event_hash := p_payload->>'taskEventHash';
    if jsonb_typeof(v_event) <> 'object' or v_event_hash !~ '^[0-9a-f]{64}$'
      or v_event->>'schemaVersion' <> 'crm-task-event-v1'
      or v_event->>'taskId' is null or v_event->>'travelRequestId' is null
      or (v_event->>'travelRequestVersion') !~ '^[1-9][0-9]*$'
      or (v_event->>'travelRequestHash') !~ '^[0-9a-f]{64}$'
      or v_event->>'customerId' is null or (v_event->>'eventVersion') !~ '^[1-9][0-9]*$'
      or coalesce(v_event->>'previousEventHash', '') !~ '^(|[0-9a-f]{64})$'
      or v_event->>'eventType' not in ('TASK_CREATED', 'TASK_CLAIMED', 'TASK_REASSIGNED', 'TASK_STATUS_CHANGED', 'TASK_CANCELLED')
      or v_event->>'taskType' not in ('CUSTOMER_FOLLOW_UP', 'DOCUMENT_REVIEW', 'PAYMENT_FOLLOW_UP', 'SUPPLIER_CHECK', 'BOOKING_FOLLOW_UP', 'SUPPORT_HANDOFF', 'OTHER')
      or char_length(btrim(coalesce(v_event->>'title', ''))) not between 5 and 120
      or v_event->>'status' not in ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')
      or char_length(btrim(coalesce(v_event->>'note', ''))) not between 8 and 500
      or v_event->'authorityDomainsUnaffected' <> 'true'::jsonb
    then
      return private.administration_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_CRM_TASK_EVENT', 'crm_task', coalesce(v_task_id::text, null), p_payload_hash
      );
    end if;
    begin
      v_task_id := (v_event->>'taskId')::uuid;
      v_owner_id := nullif(v_event->>'ownerId', '')::uuid;
      v_due_at := (v_event->>'dueAt')::timestamptz;
      v_event_version := (v_event->>'eventVersion')::integer;
    exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      return private.administration_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_CRM_TASK_EVENT', 'crm_task', coalesce(v_task_id::text, null), p_payload_hash
      );
    end;
    v_event_type := v_event->>'eventType';
    v_task_status := v_event->>'status';

    if p_command_name = 'crm.task.create' then
      if v_event_version <> 1 or coalesce(v_event->>'previousEventHash', '') <> ''
        or v_event_type <> 'TASK_CREATED' or v_task_status <> 'OPEN' or v_due_at <= now()
      then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_CRM_TASK_STATE', 'crm_task', v_task_id::text, p_payload_hash
        );
      end if;
      select * into v_request from public.travel_requests
      where id = (v_event->>'travelRequestId')::uuid and status <> 'DRAFT';
      if not found or v_request.customer_id::text <> v_event->>'customerId'
        or v_request.current_version <> (v_event->>'travelRequestVersion')::integer
        or not exists (
          select 1 from public.travel_request_versions rv
          where rv.travel_request_id = v_request.id and rv.version_number = v_request.current_version
            and rv.payload_hash = v_event->>'travelRequestHash'
        )
      then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'EXACT_TRAVEL_REQUEST_REQUIRED', 'travel_request', v_event->>'travelRequestId', p_payload_hash
        );
      end if;
      if v_owner_id is not null and not exists (
        select 1 from public.role_assignments
        where user_id = v_owner_id and active and role in ('staff', 'manager', 'finance', 'admin', 'founder')
      ) then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'ACTIVE_TASK_OWNER_REQUIRED', 'crm_task', v_task_id::text, p_payload_hash
        );
      end if;
      if v_actor_role in ('staff', 'finance') and v_owner_id is not null and v_owner_id <> p_actor_id then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'TASK_SELF_ASSIGNMENT_ONLY', 'crm_task', v_task_id::text, p_payload_hash
        );
      end if;
      insert into public.crm_tasks (
        id, travel_request_id, customer_id, request_version, request_hash,
        task_type, title, owner_id, status, due_at, current_hash, created_by
      ) values (
        v_task_id, v_request.id, v_request.customer_id, v_request.current_version,
        v_event->>'travelRequestHash', v_event->>'taskType', btrim(v_event->>'title'),
        v_owner_id, 'OPEN', v_due_at, v_event_hash, p_actor_id
      );
    else
      select * into v_task from public.crm_tasks where id = v_task_id for update;
      if not found then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'CRM_TASK_NOT_FOUND', 'crm_task', v_task_id::text, p_payload_hash
        );
      end if;
      if v_expected_version is null or v_expected_hash !~ '^[0-9a-f]{64}$'
        or v_task.current_version <> v_expected_version or v_task.current_hash <> v_expected_hash
        or v_event_version <> v_task.current_version + 1
        or v_event->>'previousEventHash' <> v_task.current_hash
      then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'STALE_CRM_TASK_VERSION', 'crm_task', v_task_id::text, p_payload_hash
        );
      end if;
      if v_event->>'travelRequestId' <> v_task.travel_request_id::text
        or (v_event->>'travelRequestVersion')::integer <> v_task.request_version
        or v_event->>'travelRequestHash' <> v_task.request_hash
        or v_event->>'customerId' <> v_task.customer_id::text
        or v_event->>'taskType' <> v_task.task_type or btrim(v_event->>'title') <> v_task.title
        or v_due_at <> v_task.due_at
      then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'CRM_TASK_IDENTITY_MISMATCH', 'crm_task', v_task_id::text, p_payload_hash
        );
      end if;
      if p_command_name = 'crm.task.claim' then
        if v_task.status in ('DONE', 'CANCELLED') or v_task.owner_id is not null
          or v_event_type <> 'TASK_CLAIMED' or v_owner_id <> p_actor_id or v_task_status <> v_task.status
        then
          return private.administration_denial_result(
            p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
            'INVALID_TASK_CLAIM_STATE', 'crm_task', v_task_id::text, p_payload_hash
          );
        end if;
      elsif p_command_name = 'crm.task.status.set' then
        if v_task.status in ('DONE', 'CANCELLED') or v_event_type <> 'TASK_STATUS_CHANGED'
          or v_owner_id is distinct from v_task.owner_id or v_task_status not in ('IN_PROGRESS', 'DONE')
          or v_task_status = v_task.status
          or (v_task.owner_id is distinct from p_actor_id and v_actor_role not in ('manager', 'admin', 'founder'))
        then
          return private.administration_denial_result(
            p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
            'TASK_OWNER_OR_STATE_REQUIRED', 'crm_task', v_task_id::text, p_payload_hash
          );
        end if;
      elsif p_command_name = 'crm.task.reassign' then
        if v_task.status in ('DONE', 'CANCELLED') or v_event_type <> 'TASK_REASSIGNED'
          or v_owner_id is null or v_owner_id is not distinct from v_task.owner_id
          or v_task_status <> v_task.status or not exists (
            select 1 from public.role_assignments where user_id = v_owner_id and active
              and role in ('staff', 'manager', 'finance', 'admin', 'founder')
          )
        then
          return private.administration_denial_result(
            p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
            'INVALID_TASK_REASSIGNMENT', 'crm_task', v_task_id::text, p_payload_hash
          );
        end if;
      else
        if v_task.status in ('DONE', 'CANCELLED') or v_event_type <> 'TASK_CANCELLED'
          or v_owner_id is distinct from v_task.owner_id or v_task_status <> 'CANCELLED'
        then
          return private.administration_denial_result(
            p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
            'INVALID_TASK_CANCELLATION', 'crm_task', v_task_id::text, p_payload_hash
          );
        end if;
      end if;
    end if;

    insert into public.crm_task_events (
      id, task_id, event_version, previous_event_hash, event_type, note,
      canonical_payload, event_hash, actor_id, actor_session_id, actor_aal
    ) values (
      p_command_id, v_task_id, v_event_version,
      nullif(v_event->>'previousEventHash', ''), v_event_type, btrim(v_event->>'note'),
      v_event, v_event_hash, p_actor_id, p_actor_session_id, p_actor_aal
    );
    if p_command_name <> 'crm.task.create' then
      update public.crm_tasks set
        owner_id = v_owner_id, status = v_task_status,
        current_version = v_event_version, current_hash = v_event_hash,
        completed_at = case when v_task_status = 'DONE' then now() else null end,
        cancelled_at = case when v_task_status = 'CANCELLED' then now() else null end,
        updated_at = now()
      where id = v_task_id;
    end if;
    v_authority_hash := v_event_hash;
    v_result := jsonb_strip_nulls(jsonb_build_object(
      'status', 'accepted', 'commandName', p_command_name, 'taskId', v_task_id,
      'taskStatus', v_task_status, 'ownerId', v_owner_id,
      'versionNumber', v_event_version, 'authorityHash', v_event_hash
    ));

  else
    v_configuration := p_payload->'configurationPayload';
    v_configuration_hash := p_payload->>'configurationHash';
    if jsonb_typeof(v_configuration) <> 'object' or v_configuration_hash !~ '^[0-9a-f]{64}$'
      or v_configuration->>'schemaVersion' <> 'supplier-configuration-v1'
      or v_configuration->>'supplierId' is null or (v_configuration->>'versionNumber') !~ '^[1-9][0-9]*$'
      or coalesce(v_configuration->>'previousVersionHash', '') !~ '^(|[0-9a-f]{64})$'
      or v_configuration->>'code' !~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'
      or char_length(btrim(coalesce(v_configuration->>'displayName', ''))) not between 2 and 120
      or v_configuration->>'serviceCategory' not in ('FLIGHT', 'HOTEL', 'TRANSFER', 'INSURANCE', 'TOUR', 'VISA_SUPPORT', 'OTHER')
      or v_configuration->>'operationalChannel' not in ('EMAIL', 'PHONE', 'PORTAL', 'MESSAGING', 'MANUAL')
      or v_configuration->>'status' not in ('ACTIVE', 'PAUSED')
      or char_length(coalesce(v_configuration->>'operationsNote', '')) > 500
      or char_length(btrim(coalesce(v_configuration->>'reason', ''))) not between 8 and 500
      or v_configuration->'containsCredentials' <> 'false'::jsonb
    then
      return private.administration_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_SUPPLIER_CONFIGURATION', 'supplier', coalesce(v_supplier_id::text, null), p_payload_hash
      );
    end if;
    begin
      v_supplier_id := (v_configuration->>'supplierId')::uuid;
      v_event_version := (v_configuration->>'versionNumber')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return private.administration_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_SUPPLIER_CONFIGURATION', 'supplier', null, p_payload_hash
      );
    end;
    if p_command_name = 'supplier.configuration.create' then
      if v_event_version <> 1 or coalesce(v_configuration->>'previousVersionHash', '') <> '' then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_SUPPLIER_CONFIGURATION_STATE', 'supplier', v_supplier_id::text, p_payload_hash
        );
      end if;
      insert into public.supplier_registry (id, code, status, current_version, current_hash)
      values (v_supplier_id, v_configuration->>'code', v_configuration->>'status', 1, v_configuration_hash);
    else
      select * into v_supplier from public.supplier_registry where id = v_supplier_id for update;
      if not found then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'SUPPLIER_CONFIGURATION_NOT_FOUND', 'supplier', v_supplier_id::text, p_payload_hash
        );
      end if;
      if v_expected_version is null or v_expected_hash !~ '^[0-9a-f]{64}$'
        or v_supplier.current_version <> v_expected_version or v_supplier.current_hash <> v_expected_hash
        or v_event_version <> v_supplier.current_version + 1
        or v_configuration->>'previousVersionHash' <> v_supplier.current_hash
        or v_configuration->>'code' <> v_supplier.code
      then
        return private.administration_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'STALE_SUPPLIER_CONFIGURATION', 'supplier', v_supplier_id::text, p_payload_hash
        );
      end if;
    end if;
    insert into public.supplier_configuration_versions (
      supplier_id, version_number, previous_version_hash, code, display_name,
      service_category, operational_channel, status, operations_note,
      canonical_payload, configuration_hash, reason, created_by, actor_session_id, actor_aal
    ) values (
      v_supplier_id, v_event_version, nullif(v_configuration->>'previousVersionHash', ''),
      v_configuration->>'code', btrim(v_configuration->>'displayName'),
      v_configuration->>'serviceCategory', v_configuration->>'operationalChannel',
      v_configuration->>'status', coalesce(v_configuration->>'operationsNote', ''),
      v_configuration, v_configuration_hash, btrim(v_configuration->>'reason'),
      p_actor_id, p_actor_session_id, p_actor_aal
    );
    if p_command_name = 'supplier.configuration.revise' then
      update public.supplier_registry set
        status = v_configuration->>'status', current_version = v_event_version,
        current_hash = v_configuration_hash, updated_at = now()
      where id = v_supplier_id;
    end if;
    v_authority_hash := v_configuration_hash;
    v_result := jsonb_build_object(
      'status', 'accepted', 'commandName', p_command_name, 'supplierId', v_supplier_id,
      'versionNumber', v_event_version, 'authorityHash', v_configuration_hash
    );
  end if;

  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal, p_command_name,
    'accepted', null,
    case when p_command_name like 'crm.task.%' then 'crm_task' else 'supplier' end,
    case when p_command_name like 'crm.task.%' then v_task_id::text else v_supplier_id::text end,
    v_authority_hash,
    jsonb_build_object('actorRole', v_actor_role, 'authorityDomainsUnaffected', true)
  );
  insert into public.administration_command_receipts (
    idempotency_key, command_id, command_name, actor_id, payload_hash, response, expires_at
  ) values (
    p_idempotency_key, p_command_id, p_command_name, p_actor_id, p_payload_hash,
    v_result, now() + interval '24 hours'
  );
  return v_result;
exception when unique_violation then
  select response into v_result from public.administration_command_receipts
  where idempotency_key = p_idempotency_key and command_name = p_command_name
    and payload_hash = p_payload_hash;
  if found then return v_result; end if;
  raise;
end;
$$;

create view public.membership_plan_catalogue
with (security_invoker = true)
as
select p.plan_code, p.audience, p.display_order, v.display_name, v.currency,
  v.monthly_minor, v.annual_minor, v.pricing_model, v.version_number, v.payload_hash
from public.membership_plans p
join public.membership_plan_versions v
  on v.plan_code = p.plan_code and v.version_number = p.current_version and v.payload_hash = p.current_hash
where p.status = 'ACTIVE';

create view public.supplier_configuration_catalogue
with (security_invoker = true)
as
select r.id, r.code, v.display_name, v.service_category, v.operational_channel,
  r.status, v.operations_note, r.current_version, r.current_hash, r.updated_at
from public.supplier_registry r
join public.supplier_configuration_versions v
  on v.supplier_id = r.id and v.version_number = r.current_version
  and v.configuration_hash = r.current_hash;

create view public.administration_crm_pipeline
with (security_invoker = true)
as
select
  tr.id as travel_request_id,
  tr.customer_id,
  tr.current_version as request_version,
  trv.payload_hash as request_hash,
  tr.assigned_staff_id as request_owner_id,
  case
    when b.status = 'VOUCHER_ISSUED' then 'VOUCHER_ISSUED'
    when b.status in ('CREATED', 'SUPPLIER_EXECUTED') then 'BOOKING_OPERATIONS'
    when b.id is not null then 'BOOKING_VERIFICATION'
    when pr.status = 'READY_FOR_BOOKING' then 'PAYMENT_READY'
    when pr.id is not null then 'PAYMENT_PENDING'
    when cq.status = 'ACCEPTED' then 'CUSTOMER_ACCEPTED'
    when cq.status = 'PUBLISHED' then 'PROPOSAL_PUBLISHED'
    when cq.status in ('PENDING_APPROVAL', 'APPROVED') then 'COMMERCIAL_APPROVAL'
    when cq.id is not null then 'COMMERCIAL_DRAFT'
    else 'TRAVEL_REQUEST_INTAKE'
  end::text as stage_code,
  coalesce(b.status, pr.status, cq.status, tr.status)::text as authority_status,
  coalesce(
    b.booking_authority_hash, pr.readiness_evaluation_hash, pr.allocation_hash,
    pr.current_verification_hash, pr.current_evidence_hash, cq.current_hash,
    cq.source_request_hash, trv.payload_hash
  )::text as authority_hash,
  greatest(tr.updated_at, cq.updated_at, pr.updated_at, b.updated_at) as changed_at
from public.travel_requests tr
join public.travel_request_versions trv
  on trv.travel_request_id = tr.id and trv.version_number = tr.current_version
left join public.commercial_quotations cq on cq.travel_request_id = tr.id
left join public.payment_requests pr on pr.quotation_id = cq.id
left join public.bookings b on b.payment_request_id = pr.id
where tr.status <> 'DRAFT';

create view public.administration_team_directory
with (security_invoker = true)
as
select ra.user_id,
  coalesce(nullif(btrim(p.display_name), ''), 'TEAM_MEMBER')::text as display_name,
  string_agg(ra.role, ', ' order by ra.role)::text as roles
from public.role_assignments ra
left join public.profiles p on p.id = ra.user_id
where ra.active and ra.role in ('staff', 'manager', 'finance', 'admin', 'founder')
group by ra.user_id, p.display_name;

create or replace view public.founder_source_freshness
with (security_invoker = true)
as
select 1::integer as source_order, 'TRAVEL_REQUEST'::text as source_code,
  case when count(*) = 0 then 'NO_RECORDS' else 'AVAILABLE' end::text as source_status,
  count(*)::bigint as record_count, max(updated_at) as last_changed_at
from public.travel_requests
union all
select 2, 'COMMERCIAL', case when count(*) = 0 then 'NO_RECORDS' else 'AVAILABLE' end,
  count(*)::bigint, max(updated_at) from public.commercial_quotations
union all
select 3, 'PAYMENT', case when count(*) = 0 then 'NO_RECORDS' else 'AVAILABLE' end,
  count(*)::bigint, max(updated_at) from public.payment_requests
union all
select 4, 'BOOKING', case when count(*) = 0 then 'NO_RECORDS' else 'AVAILABLE' end,
  count(*)::bigint, max(updated_at) from public.bookings
union all
select 5, 'SUPPORT', case when count(*) = 0 then 'NO_RECORDS' else 'AVAILABLE' end,
  count(*)::bigint, max(updated_at) from public.support_cases
union all
select 6, 'MEMBERSHIP', 'NOT_IMPLEMENTED', 0::bigint, null::timestamptz
union all
select 7, 'AI_ACTIVITY_AND_COST', 'NOT_IMPLEMENTED', 0::bigint, null::timestamptz
union all
select 8, 'CASH_LEDGER', 'NOT_IMPLEMENTED', 0::bigint, null::timestamptz
union all
select 9, 'REVENUE_LEDGER', 'NOT_IMPLEMENTED', 0::bigint, null::timestamptz
union all
select 10, 'SYSTEM_MONITORING', 'NOT_IMPLEMENTED', 0::bigint, null::timestamptz;

alter table public.membership_plans enable row level security;
alter table public.membership_plans force row level security;
alter table public.membership_plan_versions enable row level security;
alter table public.membership_plan_versions force row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_tasks force row level security;
alter table public.crm_task_events enable row level security;
alter table public.crm_task_events force row level security;
alter table public.supplier_registry enable row level security;
alter table public.supplier_registry force row level security;
alter table public.supplier_configuration_versions enable row level security;
alter table public.supplier_configuration_versions force row level security;
alter table public.administration_command_receipts enable row level security;
alter table public.administration_command_receipts force row level security;

create policy membership_plans_public_active_select on public.membership_plans
for select to anon, authenticated using (status = 'ACTIVE');
create policy membership_versions_public_current_select on public.membership_plan_versions
for select to anon, authenticated using (exists (
  select 1 from public.membership_plans p where p.plan_code = membership_plan_versions.plan_code
    and p.current_version = membership_plan_versions.version_number
    and p.current_hash = membership_plan_versions.payload_hash and p.status = 'ACTIVE'
));
create policy crm_tasks_aal2_operations_select on public.crm_tasks
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.role_assignments where user_id = (select auth.uid()) and active
      and role in ('staff', 'manager', 'finance', 'admin', 'founder')
  )
);
create policy crm_task_events_aal2_operations_select on public.crm_task_events
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.role_assignments where user_id = (select auth.uid()) and active
      and role in ('staff', 'manager', 'finance', 'admin', 'founder')
  )
);
create policy supplier_registry_aal2_operations_select on public.supplier_registry
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.role_assignments where user_id = (select auth.uid()) and active
      and role in ('staff', 'manager', 'finance', 'admin', 'founder')
  )
);
create policy supplier_versions_aal2_operations_select on public.supplier_configuration_versions
for select to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2' and exists (
    select 1 from public.role_assignments where user_id = (select auth.uid()) and active
      and role in ('staff', 'manager', 'finance', 'admin', 'founder')
  )
);

revoke all on table public.membership_plans from public, anon, authenticated;
revoke all on table public.membership_plan_versions from public, anon, authenticated;
grant select on table public.membership_plans to anon, authenticated;
grant select on table public.membership_plan_versions to anon, authenticated;
revoke all on table public.crm_tasks from public, anon, authenticated;
revoke all on table public.crm_task_events from public, anon, authenticated;
grant select on table public.crm_tasks to authenticated;
grant select on table public.crm_task_events to authenticated;
revoke all on table public.supplier_registry from public, anon, authenticated;
revoke all on table public.supplier_configuration_versions from public, anon, authenticated;
grant select on table public.supplier_registry to authenticated;
grant select on table public.supplier_configuration_versions to authenticated;
revoke all on table public.administration_command_receipts from public, anon, authenticated;

grant select on table public.membership_plans to service_role;
grant select on table public.membership_plan_versions to service_role;
grant select, insert, update on table public.crm_tasks to service_role;
grant select, insert on table public.crm_task_events to service_role;
grant select, insert, update on table public.supplier_registry to service_role;
grant select, insert on table public.supplier_configuration_versions to service_role;
grant select, insert on table public.administration_command_receipts to service_role;

revoke all on table public.membership_plan_catalogue from public, anon, authenticated;
grant select on table public.membership_plan_catalogue to anon, authenticated, service_role;
revoke all on table public.supplier_configuration_catalogue from public, anon, authenticated;
revoke all on table public.administration_crm_pipeline from public, anon, authenticated;
revoke all on table public.administration_team_directory from public, anon, authenticated;
grant select on table public.supplier_configuration_catalogue to service_role;
grant select on table public.administration_crm_pipeline to service_role;
grant select on table public.administration_team_directory to service_role;

revoke all on function private.reject_administration_evidence_mutation() from public, anon, authenticated;
revoke all on function private.guard_crm_task_update() from public, anon, authenticated;
revoke all on function private.guard_supplier_registry_update() from public, anon, authenticated;
revoke all on function private.administration_denial_result(uuid, text, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function private.administration_denial_result(uuid, text, uuid, uuid, text, text, text, text, text)
  to service_role;
revoke all on function public.execute_administration_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.execute_administration_command(uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text)
  to service_role;

comment on view public.administration_crm_pipeline is
  'Task 011 service-only journey stage derived from domain authority; the stage itself grants no authority.';
comment on table public.crm_tasks is
  'Task 011 accountable operational tasks bound to an exact Travel Request version; tasks cannot change domain authority.';
comment on table public.membership_plan_versions is
  'Task 011 immutable Founder-ratified launch prices only; no unapproved Membership benefits are stored.';
comment on table public.supplier_configuration_versions is
  'Task 011 bounded manual Supplier configuration history; contains no credentials, integration or booking authority.';
