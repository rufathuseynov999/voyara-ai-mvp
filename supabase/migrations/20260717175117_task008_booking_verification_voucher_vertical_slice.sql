-- VOYARA AI Task 008: separate human Booking Verification, append-only
-- correction evidence, versioned Voucher preparation and human Voucher issue.
-- Supplier Confirmation remains evidence, not Verification. A Voucher draft is
-- not issued and is never Customer-readable until the exact version is issued.

alter table public.supplier_confirmations
  drop constraint if exists supplier_confirmations_booking_id_key,
  drop constraint if exists supplier_confirmations_execution_id_key;

alter table public.supplier_confirmations
  add column confirmation_version integer not null default 1,
  add column supersedes_confirmation_id uuid,
  add column supersedes_confirmation_hash text,
  add column rejection_verification_id uuid,
  add column rejection_verification_hash text,
  add constraint supplier_confirmations_version_check check (confirmation_version > 0),
  add constraint supplier_confirmations_lineage_check check (
    (confirmation_version = 1
      and supersedes_confirmation_id is null
      and supersedes_confirmation_hash is null
      and rejection_verification_id is null
      and rejection_verification_hash is null)
    or (confirmation_version > 1
      and supersedes_confirmation_id is not null
      and supersedes_confirmation_hash ~ '^[0-9a-f]{64}$'
      and rejection_verification_id is not null
      and rejection_verification_hash ~ '^[0-9a-f]{64}$')
  );

create unique index supplier_confirmations_booking_version_key
  on public.supplier_confirmations (booking_id, confirmation_version);

drop trigger bookings_guarded on public.bookings;
drop function private.guard_booking_update();

alter table public.bookings
  drop constraint bookings_status_check,
  drop constraint bookings_state_pointer_check;

alter table public.bookings
  add column current_verification_review_id uuid,
  add column current_verification_id uuid,
  add column current_verification_hash text,
  add column voucher_id uuid,
  add column voucher_version integer,
  add column voucher_hash text,
  add column verification_started_at timestamptz,
  add column verified_at timestamptz,
  add column voucher_issued_at timestamptz,
  add constraint bookings_task008_status_check check (status in (
    'CREATED', 'SUPPLIER_EXECUTED', 'SUPPLIER_CONFIRMED',
    'UNDER_VERIFICATION', 'VERIFICATION_REJECTED', 'BOOKING_VERIFIED',
    'VOUCHER_DRAFTED', 'VOUCHER_ISSUED'
  )),
  add constraint bookings_verification_pointer_check check (
    (current_verification_id is null and current_verification_hash is null)
    or (current_verification_id is not null and current_verification_hash ~ '^[0-9a-f]{64}$')
  ),
  add constraint bookings_voucher_pointer_check check (
    (voucher_id is null and voucher_version is null and voucher_hash is null)
    or (voucher_id is not null and voucher_version > 0 and voucher_hash ~ '^[0-9a-f]{64}$')
  ),
  add constraint bookings_task008_state_pointer_check check (
    (status = 'CREATED'
      and current_execution_id is null and supplier_confirmation_id is null
      and current_verification_review_id is null and current_verification_id is null
      and voucher_id is null and supplier_executed_at is null
      and supplier_confirmed_at is null and verification_started_at is null
      and verified_at is null and voucher_issued_at is null)
    or (status = 'SUPPLIER_EXECUTED'
      and current_execution_id is not null and supplier_confirmation_id is null
      and current_verification_review_id is null and current_verification_id is null
      and voucher_id is null and supplier_executed_at is not null
      and supplier_confirmed_at is null and verification_started_at is null
      and verified_at is null and voucher_issued_at is null)
    or (status = 'SUPPLIER_CONFIRMED'
      and current_execution_id is not null and supplier_confirmation_id is not null
      and current_verification_review_id is null and current_verification_id is null
      and voucher_id is null and supplier_executed_at is not null
      and supplier_confirmed_at is not null and verification_started_at is null
      and verified_at is null and voucher_issued_at is null)
    or (status = 'UNDER_VERIFICATION'
      and current_execution_id is not null and supplier_confirmation_id is not null
      and current_verification_review_id is not null and current_verification_id is null
      and voucher_id is null and supplier_executed_at is not null
      and supplier_confirmed_at is not null and verification_started_at is not null
      and verified_at is null and voucher_issued_at is null)
    or (status = 'VERIFICATION_REJECTED'
      and current_execution_id is not null and supplier_confirmation_id is not null
      and current_verification_review_id is not null and current_verification_id is not null
      and voucher_id is null and supplier_executed_at is not null
      and supplier_confirmed_at is not null and verification_started_at is not null
      and verified_at is null and voucher_issued_at is null)
    or (status = 'BOOKING_VERIFIED'
      and current_execution_id is not null and supplier_confirmation_id is not null
      and current_verification_review_id is not null and current_verification_id is not null
      and voucher_id is null and supplier_executed_at is not null
      and supplier_confirmed_at is not null and verification_started_at is not null
      and verified_at is not null and voucher_issued_at is null)
    or (status = 'VOUCHER_DRAFTED'
      and current_execution_id is not null and supplier_confirmation_id is not null
      and current_verification_review_id is not null and current_verification_id is not null
      and voucher_id is not null and supplier_executed_at is not null
      and supplier_confirmed_at is not null and verification_started_at is not null
      and verified_at is not null and voucher_issued_at is null)
    or (status = 'VOUCHER_ISSUED'
      and current_execution_id is not null and supplier_confirmation_id is not null
      and current_verification_review_id is not null and current_verification_id is not null
      and voucher_id is not null and supplier_executed_at is not null
      and supplier_confirmed_at is not null and verification_started_at is not null
      and verified_at is not null and voucher_issued_at is not null)
  );

create table public.booking_verification_reviews (
  id uuid primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  booking_authority_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  execution_id uuid not null,
  execution_hash text not null,
  supplier_confirmation_id uuid not null,
  supplier_confirmation_version integer not null,
  supplier_confirmation_hash text not null,
  reviewer_id uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  started_at timestamptz not null default now(),
  unique (booking_id, id),
  unique (
    booking_id, id, execution_id, execution_hash,
    supplier_confirmation_id, supplier_confirmation_hash
  ),
  foreign key (booking_id, booking_authority_hash)
    references public.bookings (id, booking_authority_hash) on delete restrict,
  foreign key (booking_id, execution_id, execution_hash)
    references public.supplier_booking_executions
      (booking_id, id, execution_hash) on delete restrict,
  foreign key (booking_id, supplier_confirmation_id, supplier_confirmation_hash)
    references public.supplier_confirmations
      (booking_id, id, confirmation_hash) on delete restrict,
  constraint booking_verification_reviews_authority_hash_check
    check (booking_authority_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_verification_reviews_execution_hash_check
    check (execution_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_verification_reviews_confirmation_version_check
    check (supplier_confirmation_version > 0),
  constraint booking_verification_reviews_confirmation_hash_check
    check (supplier_confirmation_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_verification_reviews_aal_check check (actor_aal = 'aal2')
);

create table public.booking_verification_decisions (
  id uuid primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  booking_authority_hash text not null,
  review_id uuid not null unique,
  customer_id uuid not null references auth.users (id) on delete restrict,
  execution_id uuid not null,
  execution_hash text not null,
  supplier_confirmation_id uuid not null,
  supplier_confirmation_version integer not null,
  supplier_confirmation_hash text not null,
  decision text not null,
  reason text not null,
  canonical_payload jsonb not null,
  verification_hash text not null,
  decided_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  decided_at timestamptz not null default now(),
  unique (booking_id, id, verification_hash),
  foreign key (
    booking_id, review_id, execution_id, execution_hash,
    supplier_confirmation_id, supplier_confirmation_hash
  ) references public.booking_verification_reviews (
    booking_id, id, execution_id, execution_hash,
    supplier_confirmation_id, supplier_confirmation_hash
  ) on delete restrict,
  foreign key (booking_id, booking_authority_hash)
    references public.bookings (id, booking_authority_hash) on delete restrict,
  constraint booking_verification_decisions_authority_hash_check
    check (booking_authority_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_verification_decisions_execution_hash_check
    check (execution_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_verification_decisions_confirmation_version_check
    check (supplier_confirmation_version > 0),
  constraint booking_verification_decisions_confirmation_hash_check
    check (supplier_confirmation_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_verification_decisions_decision_check
    check (decision in ('VERIFY', 'REJECT')),
  constraint booking_verification_decisions_reason_check
    check (char_length(btrim(reason)) between 8 and 500),
  constraint booking_verification_decisions_payload_check
    check (jsonb_typeof(canonical_payload) = 'object'),
  constraint booking_verification_decisions_hash_check
    check (verification_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_verification_decisions_aal_check check (actor_aal = 'aal2')
);

alter table public.supplier_confirmations
  add constraint supplier_confirmations_supersedes_fk
    foreign key (booking_id, supersedes_confirmation_id, supersedes_confirmation_hash)
    references public.supplier_confirmations (booking_id, id, confirmation_hash)
    on delete restrict,
  add constraint supplier_confirmations_rejection_fk
    foreign key (booking_id, rejection_verification_id, rejection_verification_hash)
    references public.booking_verification_decisions (booking_id, id, verification_hash)
    on delete restrict;

create table public.vouchers (
  id uuid primary key,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  locale text not null,
  status text not null default 'DRAFT',
  current_version integer not null,
  current_hash text not null,
  issued_version integer,
  issued_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz,
  unique (id, booking_id),
  constraint vouchers_locale_check check (locale in ('az', 'ru', 'en')),
  constraint vouchers_status_check check (status in ('DRAFT', 'ISSUED')),
  constraint vouchers_current_version_check check (current_version > 0),
  constraint vouchers_current_hash_check check (current_hash ~ '^[0-9a-f]{64}$'),
  constraint vouchers_issue_pointer_check check (
    (status = 'DRAFT' and issued_version is null and issued_hash is null and issued_at is null)
    or (status = 'ISSUED' and issued_version = current_version
      and issued_hash = current_hash and issued_at is not null)
  )
);

create table public.voucher_versions (
  voucher_id uuid not null,
  version_number integer not null,
  booking_id uuid not null,
  booking_authority_hash text not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  verification_id uuid not null,
  verification_hash text not null,
  execution_id uuid not null,
  execution_hash text not null,
  supplier_confirmation_id uuid not null,
  supplier_confirmation_version integer not null,
  supplier_confirmation_hash text not null,
  quotation_id uuid not null references public.commercial_quotations (id) on delete restrict,
  quotation_version integer not null,
  quotation_hash text not null,
  locale text not null,
  canonical_payload jsonb not null,
  voucher_hash text not null,
  preparation_source text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  created_at timestamptz not null default now(),
  primary key (voucher_id, version_number),
  unique (voucher_id, version_number, voucher_hash),
  unique (booking_id, voucher_id, version_number, voucher_hash),
  foreign key (voucher_id, booking_id)
    references public.vouchers (id, booking_id) on delete restrict,
  foreign key (booking_id, booking_authority_hash)
    references public.bookings (id, booking_authority_hash) on delete restrict,
  foreign key (booking_id, verification_id, verification_hash)
    references public.booking_verification_decisions
      (booking_id, id, verification_hash) on delete restrict,
  foreign key (booking_id, execution_id, execution_hash)
    references public.supplier_booking_executions
      (booking_id, id, execution_hash) on delete restrict,
  foreign key (booking_id, supplier_confirmation_id, supplier_confirmation_hash)
    references public.supplier_confirmations
      (booking_id, id, confirmation_hash) on delete restrict,
  constraint voucher_versions_version_check check (version_number > 0),
  constraint voucher_versions_authority_hash_check
    check (booking_authority_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_versions_verification_hash_check
    check (verification_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_versions_execution_hash_check
    check (execution_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_versions_confirmation_version_check
    check (supplier_confirmation_version > 0),
  constraint voucher_versions_confirmation_hash_check
    check (supplier_confirmation_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_versions_quotation_version_check check (quotation_version > 0),
  constraint voucher_versions_quotation_hash_check
    check (quotation_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_versions_locale_check check (locale in ('az', 'ru', 'en')),
  constraint voucher_versions_payload_check check (jsonb_typeof(canonical_payload) = 'object'),
  constraint voucher_versions_hash_check check (voucher_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_versions_source_check
    check (preparation_source in ('HUMAN', 'AI_ASSISTED')),
  constraint voucher_versions_aal_check check (actor_aal = 'aal2')
);

create table public.voucher_issuance_events (
  id uuid primary key,
  voucher_id uuid not null,
  version_number integer not null,
  voucher_hash text not null,
  booking_id uuid not null,
  customer_id uuid not null references auth.users (id) on delete restrict,
  verification_id uuid not null,
  verification_hash text not null,
  issued_by uuid not null references auth.users (id) on delete restrict,
  actor_session_id uuid not null,
  actor_aal text not null,
  issued_at timestamptz not null default now(),
  foreign key (voucher_id, version_number, voucher_hash)
    references public.voucher_versions
      (voucher_id, version_number, voucher_hash) on delete restrict,
  foreign key (booking_id, verification_id, verification_hash)
    references public.booking_verification_decisions
      (booking_id, id, verification_hash) on delete restrict,
  constraint voucher_issuance_version_check check (version_number > 0),
  constraint voucher_issuance_hash_check check (voucher_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_issuance_verification_hash_check
    check (verification_hash ~ '^[0-9a-f]{64}$'),
  constraint voucher_issuance_aal_check check (actor_aal = 'aal2')
);

create table public.fulfilment_work_receipts (
  command_id uuid primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  customer_id uuid not null references auth.users (id) on delete restrict,
  action text not null,
  actor_role text not null,
  from_status text not null,
  to_status text not null,
  authority_hash text not null,
  occurred_at timestamptz not null default now(),
  constraint fulfilment_work_receipts_action_check check (action in (
    'booking.verification.start', 'booking.verify',
    'supplier_confirmation.correct', 'voucher.draft.create', 'voucher.issue'
  )),
  constraint fulfilment_work_receipts_role_check check (actor_role in (
    'staff', 'manager', 'admin', 'founder'
  )),
  constraint fulfilment_work_receipts_status_check check (
    from_status in (
      'SUPPLIER_CONFIRMED', 'UNDER_VERIFICATION', 'VERIFICATION_REJECTED',
      'BOOKING_VERIFIED', 'VOUCHER_DRAFTED'
    ) and to_status in (
      'SUPPLIER_CONFIRMED', 'UNDER_VERIFICATION', 'VERIFICATION_REJECTED',
      'BOOKING_VERIFIED', 'VOUCHER_DRAFTED', 'VOUCHER_ISSUED'
    )
  ),
  constraint fulfilment_work_receipts_hash_check
    check (authority_hash ~ '^[0-9a-f]{64}$')
);

create table public.fulfilment_command_receipts (
  idempotency_key text primary key,
  command_id uuid not null unique,
  command_name text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint fulfilment_command_receipts_key_check
    check (char_length(idempotency_key) between 12 and 160),
  constraint fulfilment_command_receipts_name_check check (command_name in (
    'booking.verification.start', 'booking.verify',
    'supplier_confirmation.correct', 'voucher.draft.create', 'voucher.issue'
  )),
  constraint fulfilment_command_receipts_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint fulfilment_command_receipts_response_check
    check (jsonb_typeof(response) = 'object'),
  constraint fulfilment_command_receipts_expiry_check check (expires_at > created_at)
);

create index booking_verification_reviews_booking_idx
  on public.booking_verification_reviews (booking_id, started_at desc);
create index booking_verification_decisions_booking_idx
  on public.booking_verification_decisions (booking_id, decided_at desc);
create index vouchers_customer_issued_idx
  on public.vouchers (customer_id, issued_at desc);
create index fulfilment_work_receipts_booking_idx
  on public.fulfilment_work_receipts (booking_id, occurred_at, command_id);
create index fulfilment_command_receipts_actor_idx
  on public.fulfilment_command_receipts (actor_id, created_at desc);

alter table public.bookings
  add constraint bookings_current_verification_review_fk
    foreign key (id, current_verification_review_id)
    references public.booking_verification_reviews (booking_id, id) on delete restrict,
  add constraint bookings_current_verification_fk
    foreign key (id, current_verification_id, current_verification_hash)
    references public.booking_verification_decisions
      (booking_id, id, verification_hash) on delete restrict,
  add constraint bookings_current_voucher_fk
    foreign key (id, voucher_id, voucher_version, voucher_hash)
    references public.voucher_versions
      (booking_id, voucher_id, version_number, voucher_hash) on delete restrict;

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
    or new.updated_at < old.updated_at
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
    or (old.status = 'SUPPLIER_CONFIRMED' and new.status = 'UNDER_VERIFICATION'
      and new.current_execution_id = old.current_execution_id
      and new.current_execution_hash = old.current_execution_hash
      and new.supplier_confirmation_id = old.supplier_confirmation_id
      and new.supplier_confirmation_hash = old.supplier_confirmation_hash
      and old.current_verification_review_id is null
      and new.current_verification_review_id is not null
      and new.current_verification_id is null)
    or (old.status = 'UNDER_VERIFICATION'
      and new.status in ('VERIFICATION_REJECTED', 'BOOKING_VERIFIED')
      and new.current_execution_id = old.current_execution_id
      and new.current_execution_hash = old.current_execution_hash
      and new.supplier_confirmation_id = old.supplier_confirmation_id
      and new.supplier_confirmation_hash = old.supplier_confirmation_hash
      and new.current_verification_review_id = old.current_verification_review_id
      and old.current_verification_id is null and new.current_verification_id is not null)
    or (old.status = 'VERIFICATION_REJECTED' and new.status = 'SUPPLIER_CONFIRMED'
      and new.current_execution_id = old.current_execution_id
      and new.current_execution_hash = old.current_execution_hash
      and new.supplier_confirmation_id <> old.supplier_confirmation_id
      and new.supplier_confirmation_hash <> old.supplier_confirmation_hash
      and new.current_verification_review_id is null
      and new.current_verification_id is null and new.voucher_id is null)
    or (old.status = 'BOOKING_VERIFIED' and new.status = 'VOUCHER_DRAFTED'
      and new.current_execution_id = old.current_execution_id
      and new.supplier_confirmation_id = old.supplier_confirmation_id
      and new.current_verification_id = old.current_verification_id
      and old.voucher_id is null and new.voucher_id is not null)
    or (old.status = 'VOUCHER_DRAFTED' and new.status = 'VOUCHER_DRAFTED'
      and new.current_execution_id = old.current_execution_id
      and new.supplier_confirmation_id = old.supplier_confirmation_id
      and new.current_verification_id = old.current_verification_id
      and new.voucher_id = old.voucher_id
      and new.voucher_version = old.voucher_version + 1
      and new.voucher_hash <> old.voucher_hash)
    or (old.status = 'VOUCHER_DRAFTED' and new.status = 'VOUCHER_ISSUED'
      and new.current_execution_id = old.current_execution_id
      and new.supplier_confirmation_id = old.supplier_confirmation_id
      and new.current_verification_id = old.current_verification_id
      and new.voucher_id = old.voucher_id
      and new.voucher_version = old.voucher_version
      and new.voucher_hash = old.voucher_hash
      and old.voucher_issued_at is null and new.voucher_issued_at is not null)
  then
    return new;
  end if;

  raise exception 'invalid or non-monotonic booking transition' using errcode = '55000';
end;
$$;

create trigger bookings_guarded
before update on public.bookings
for each row execute function private.guard_booking_update();

create or replace function private.guard_voucher_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id <> old.id or new.booking_id <> old.booking_id
    or new.customer_id <> old.customer_id or new.locale <> old.locale
    or new.created_at <> old.created_at or new.updated_at < old.updated_at
  then
    raise exception 'voucher identity is immutable' using errcode = '55000';
  end if;
  if (old.status = 'DRAFT' and new.status = 'DRAFT'
      and new.current_version = old.current_version + 1
      and new.current_hash <> old.current_hash
      and new.issued_version is null and new.issued_hash is null and new.issued_at is null)
    or (old.status = 'DRAFT' and new.status = 'ISSUED'
      and new.current_version = old.current_version
      and new.current_hash = old.current_hash
      and new.issued_version = old.current_version
      and new.issued_hash = old.current_hash
      and new.issued_at is not null)
  then
    return new;
  end if;
  raise exception 'invalid voucher transition' using errcode = '55000';
end;
$$;

create trigger booking_verification_reviews_immutable
before update or delete on public.booking_verification_reviews
for each row execute function private.reject_booking_evidence_mutation();
create trigger booking_verification_decisions_immutable
before update or delete on public.booking_verification_decisions
for each row execute function private.reject_booking_evidence_mutation();
create trigger voucher_versions_immutable
before update or delete on public.voucher_versions
for each row execute function private.reject_booking_evidence_mutation();
create trigger voucher_issuance_events_immutable
before update or delete on public.voucher_issuance_events
for each row execute function private.reject_booking_evidence_mutation();
create trigger fulfilment_work_receipts_immutable
before update or delete on public.fulfilment_work_receipts
for each row execute function private.reject_booking_evidence_mutation();
create trigger vouchers_guarded
before update on public.vouchers
for each row execute function private.guard_voucher_update();

create or replace function private.is_valid_booking_verification_payload(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_payload) = 'object'
    and p_payload->>'schemaVersion' = 'booking-verification-v1'
    and coalesce(p_payload->>'bookingId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'bookingAuthorityHash', '') ~ '^[0-9a-f]{64}$'
    and coalesce(p_payload->>'reviewId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'executionId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'executionHash', '') ~ '^[0-9a-f]{64}$'
    and coalesce(p_payload->>'supplierConfirmationId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(p_payload->>'supplierConfirmationVersion', '') ~ '^[1-9][0-9]*$'
    and coalesce(p_payload->>'supplierConfirmationHash', '') ~ '^[0-9a-f]{64}$'
    and p_payload->>'decision' in ('VERIFY', 'REJECT')
    and char_length(btrim(coalesce(p_payload->>'reason', ''))) between 8 and 500
    and jsonb_typeof(p_payload->'checks') = 'object'
    and p_payload#>>'{checks,customerDetailsMatch}' in ('true', 'false')
    and p_payload#>>'{checks,datesAndServicesMatch}' in ('true', 'false')
    and p_payload#>>'{checks,supplierReferenceValidated}' in ('true', 'false')
    and p_payload#>>'{checks,priceAndTermsMatch}' in ('true', 'false')
    and p_payload->>'declarationConfirmed' = 'true'
    and (
      (p_payload->>'decision' = 'VERIFY'
        and p_payload#>>'{checks,customerDetailsMatch}' = 'true'
        and p_payload#>>'{checks,datesAndServicesMatch}' = 'true'
        and p_payload#>>'{checks,supplierReferenceValidated}' = 'true'
        and p_payload#>>'{checks,priceAndTermsMatch}' = 'true')
      or (p_payload->>'decision' = 'REJECT'
        and (
          p_payload#>>'{checks,customerDetailsMatch}' = 'false'
          or p_payload#>>'{checks,datesAndServicesMatch}' = 'false'
          or p_payload#>>'{checks,supplierReferenceValidated}' = 'false'
          or p_payload#>>'{checks,priceAndTermsMatch}' = 'false'
        ))
    );
$$;

create or replace function private.is_valid_supplier_confirmation_correction_payload(p_payload jsonb)
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
    or p_payload->>'schemaVersion' <> 'supplier-confirmation-correction-v1'
    or coalesce(p_payload->>'bookingId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'executionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'executionHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload->>'supersedesConfirmationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'supersedesConfirmationHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload->>'rejectedVerificationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'rejectedVerificationHash', '') !~ '^[0-9a-f]{64}$'
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

create or replace function private.is_valid_voucher_payload(p_payload jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'schemaVersion' <> 'voucher-v1'
    or coalesce(p_payload->>'voucherId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'versionNumber', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_payload->>'bookingId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'bookingAuthorityHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload->>'verificationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'verificationHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload->>'executionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'executionHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload->>'supplierConfirmationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'supplierConfirmationVersion', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_payload->>'supplierConfirmationHash', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload->>'quotationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_payload->>'quotationVersion', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_payload->>'quotationHash', '') !~ '^[0-9a-f]{64}$'
    or p_payload->>'locale' not in ('az', 'ru', 'en')
    or p_payload->>'preparationSource' not in ('HUMAN', 'AI_ASSISTED')
    or jsonb_typeof(p_payload->'supplier') <> 'object'
    or char_length(btrim(coalesce(p_payload#>>'{supplier,name}', ''))) not between 2 and 120
    or char_length(btrim(coalesce(p_payload#>>'{supplier,confirmationReference}', ''))) not between 3 and 120
    or char_length(btrim(coalesce(p_payload#>>'{supplier,confirmationSummary}', ''))) not between 3 and 500
    or jsonb_typeof(p_payload->'trip') <> 'object'
    or char_length(btrim(coalesce(p_payload#>>'{trip,title}', ''))) not between 3 and 120
    or char_length(btrim(coalesce(p_payload#>>'{trip,summary}', ''))) not between 3 and 500
    or jsonb_typeof(p_payload->'services') <> 'array'
    or jsonb_array_length(p_payload->'services') not between 1 and 20
    or char_length(btrim(coalesce(p_payload->>'supportContact', ''))) not between 3 and 120
    or char_length(coalesce(p_payload->>'customerNotes', '')) > 500
    or p_payload->>'declarationConfirmed' <> 'true'
    or exists (
      select 1 from jsonb_array_elements(p_payload->'services') as service
      where jsonb_typeof(service) <> 'object'
        or coalesce(service->>'sequence', '') !~ '^[1-9][0-9]*$'
        or service->>'category' not in ('FLIGHT', 'HOTEL', 'TRANSFER', 'ACTIVITY', 'OTHER')
        or char_length(btrim(coalesce(service->>'title', ''))) not between 2 and 120
        or char_length(btrim(coalesce(service->>'details', ''))) not between 3 and 500
        or char_length(coalesce(service->>'customerReference', '')) > 120
        or (coalesce(service->>'serviceDate', '') <> ''
          and service->>'serviceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    )
  then
    return false;
  end if;
  return true;
end;
$$;

create or replace function private.fulfilment_denial_result(
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
    p_command_name, 'denied', p_reason_code, 'booking',
    coalesce(p_entity_id, p_command_id::text),
    case when p_payload_hash ~ '^[0-9a-f]{64}$' then p_payload_hash else repeat('0', 64) end,
    '{}'::jsonb
  );
  return jsonb_build_object('status', 'denied', 'reasonCode', p_reason_code);
end;
$$;

create or replace function public.execute_fulfilment_command(
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
  v_existing public.fulfilment_command_receipts%rowtype;
  v_booking public.bookings%rowtype;
  v_execution public.supplier_booking_executions%rowtype;
  v_confirmation public.supplier_confirmations%rowtype;
  v_review public.booking_verification_reviews%rowtype;
  v_decision public.booking_verification_decisions%rowtype;
  v_voucher public.vouchers%rowtype;
  v_voucher_version public.voucher_versions%rowtype;
  v_booking_id uuid;
  v_execution_id uuid;
  v_confirmation_id uuid;
  v_review_id uuid;
  v_verification_id uuid;
  v_voucher_id uuid;
  v_execution_hash text;
  v_confirmation_hash text;
  v_verification_hash text;
  v_voucher_hash text;
  v_canonical_payload jsonb;
  v_from_status text;
  v_to_status text;
  v_authority_hash text;
  v_actor_role text;
  v_decision_name text;
  v_confirmation_version integer;
  v_voucher_version_number integer;
  v_revoked_before timestamptz;
  v_result jsonb;
begin
  select * into v_existing from public.fulfilment_command_receipts
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_name <> p_command_name or v_existing.payload_hash <> p_payload_hash then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'IDEMPOTENCY_CONFLICT', null, p_payload_hash
      );
    end if;
    return v_existing.response;
  end if;

  if p_command_name not in (
    'booking.verification.start', 'booking.verify',
    'supplier_confirmation.correct', 'voucher.draft.create', 'voucher.issue'
  ) then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'UNREGISTERED_COMMAND', null, p_payload_hash
    );
  end if;
  if p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_payload) <> 'object'
  then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'INVALID_PAYLOAD', null, p_payload_hash
    );
  end if;
  if p_actor_session_id is null or p_actor_issued_at is null or p_actor_aal <> 'aal2' then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'AAL2_REQUIRED', null, p_payload_hash
    );
  end if;
  if exists (
    select 1 from public.session_revocations
    where session_id = p_actor_session_id and user_id = p_actor_id
  ) then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;
  select revoked_before into v_revoked_before from public.user_session_security
  where user_id = p_actor_id;
  if v_revoked_before is not null and p_actor_issued_at <= v_revoked_before then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'SESSION_REVOKED', null, p_payload_hash
    );
  end if;

  if p_command_name in ('supplier_confirmation.correct', 'voucher.draft.create') then
    select role into v_actor_role from public.role_assignments
    where user_id = p_actor_id and role in ('staff', 'manager', 'admin', 'founder') and active
    order by case role when 'founder' then 1 when 'admin' then 2 when 'manager' then 3 else 4 end
    limit 1;
    if v_actor_role is null then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'BOOKING_OPERATIONS_AUTHORITY_REQUIRED', null, p_payload_hash
      );
    end if;
  else
    select role into v_actor_role from public.role_assignments
    where user_id = p_actor_id and role in ('manager', 'admin', 'founder') and active
    order by case role when 'founder' then 1 when 'admin' then 2 else 3 end
    limit 1;
    if v_actor_role is null then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'BOOKING_VERIFICATION_AUTHORITY_REQUIRED', null, p_payload_hash
      );
    end if;
  end if;

  if (
    select count(*) from public.fulfilment_command_receipts
    where actor_id = p_actor_id and created_at >= now() - interval '1 hour'
  ) >= 120 then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'RATE_LIMITED', null, p_payload_hash
    );
  end if;

  begin
    v_booking_id := nullif(p_payload->>'bookingId', '')::uuid;
    v_execution_id := nullif(p_payload->>'executionId', '')::uuid;
    v_confirmation_id := nullif(p_payload->>'supplierConfirmationId', '')::uuid;
    v_review_id := nullif(p_payload->>'reviewId', '')::uuid;
    v_verification_id := nullif(p_payload->>'verificationId', '')::uuid;
    v_voucher_id := nullif(p_payload->>'voucherId', '')::uuid;
    v_confirmation_version := nullif(p_payload->>'supplierConfirmationVersion', '')::integer;
    v_voucher_version_number := nullif(p_payload->>'versionNumber', '')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_IDENTIFIER', null, p_payload_hash
      );
  end;
  v_execution_hash := p_payload->>'executionHash';
  v_confirmation_hash := p_payload->>'supplierConfirmationHash';
  v_verification_hash := p_payload->>'verificationHash';
  v_voucher_hash := p_payload->>'voucherHash';

  if v_booking_id is null then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'BOOKING_REQUIRED', null, p_payload_hash
    );
  end if;
  select * into v_booking from public.bookings where id = v_booking_id for update;
  if not found then
    return private.fulfilment_denial_result(
      p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
      'BOOKING_NOT_FOUND', v_booking_id::text, p_payload_hash
    );
  end if;

  if p_command_name = 'booking.verification.start' then
    if v_booking.status <> 'SUPPLIER_CONFIRMED'
      or v_execution_id is null or v_execution_hash !~ '^[0-9a-f]{64}$'
      or v_confirmation_id is null or v_confirmation_version is null
      or v_confirmation_hash !~ '^[0-9a-f]{64}$'
      or v_booking.current_execution_id <> v_execution_id
      or v_booking.current_execution_hash <> v_execution_hash
      or v_booking.supplier_confirmation_id <> v_confirmation_id
      or v_booking.supplier_confirmation_hash <> v_confirmation_hash
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_SUPPLIER_CONFIRMATION_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    select * into v_execution from public.supplier_booking_executions
    where booking_id = v_booking_id and id = v_execution_id and execution_hash = v_execution_hash;
    select * into v_confirmation from public.supplier_confirmations
    where booking_id = v_booking_id and id = v_confirmation_id
      and confirmation_version = v_confirmation_version
      and confirmation_hash = v_confirmation_hash;
    if v_execution.id is null or v_confirmation.id is null
      or p_actor_id in (v_execution.executed_by, v_confirmation.captured_by)
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        case when v_execution.id is null or v_confirmation.id is null
          then 'EXACT_SUPPLIER_CONFIRMATION_REQUIRED'
          else 'INDEPENDENT_VERIFIER_REQUIRED' end,
        v_booking_id::text, p_payload_hash
      );
    end if;
    v_review_id := p_command_id;
    insert into public.booking_verification_reviews (
      id, booking_id, booking_authority_hash, customer_id,
      execution_id, execution_hash, supplier_confirmation_id,
      supplier_confirmation_version, supplier_confirmation_hash,
      reviewer_id, actor_session_id, actor_aal
    ) values (
      v_review_id, v_booking_id, v_booking.booking_authority_hash, v_booking.customer_id,
      v_execution_id, v_execution_hash, v_confirmation_id,
      v_confirmation_version, v_confirmation_hash,
      p_actor_id, p_actor_session_id, p_actor_aal
    );
    v_from_status := 'SUPPLIER_CONFIRMED';
    v_to_status := 'UNDER_VERIFICATION';
    v_authority_hash := v_confirmation_hash;
    update public.bookings set status = v_to_status,
      current_verification_review_id = v_review_id,
      verification_started_at = now(), updated_at = now()
    where id = v_booking_id;

  elsif p_command_name = 'booking.verify' then
    if v_booking.status <> 'UNDER_VERIFICATION'
      or v_review_id is null or v_review_id <> v_booking.current_verification_review_id
      or v_execution_id <> v_booking.current_execution_id
      or v_execution_hash <> v_booking.current_execution_hash
      or v_confirmation_id <> v_booking.supplier_confirmation_id
      or v_confirmation_hash <> v_booking.supplier_confirmation_hash
      or v_confirmation_version is null
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_VERIFICATION_REVIEW_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    select * into v_review from public.booking_verification_reviews
    where booking_id = v_booking_id and id = v_review_id
      and execution_id = v_execution_id and execution_hash = v_execution_hash
      and supplier_confirmation_id = v_confirmation_id
      and supplier_confirmation_version = v_confirmation_version
      and supplier_confirmation_hash = v_confirmation_hash;
    select * into v_execution from public.supplier_booking_executions
    where booking_id = v_booking_id and id = v_execution_id and execution_hash = v_execution_hash;
    select * into v_confirmation from public.supplier_confirmations
    where booking_id = v_booking_id and id = v_confirmation_id
      and confirmation_version = v_confirmation_version
      and confirmation_hash = v_confirmation_hash;
    if v_review.id is null or v_review.reviewer_id <> p_actor_id
      or v_execution.id is null or v_confirmation.id is null
      or p_actor_id in (v_execution.executed_by, v_confirmation.captured_by)
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INDEPENDENT_VERIFIER_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    v_canonical_payload := p_payload->'verificationPayload';
    v_verification_hash := p_payload->>'verificationHash';
    if v_verification_hash is null or v_verification_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_booking_verification_payload(v_canonical_payload)
      or v_canonical_payload->>'bookingId' <> v_booking_id::text
      or v_canonical_payload->>'bookingAuthorityHash' <> v_booking.booking_authority_hash
      or v_canonical_payload->>'reviewId' <> v_review_id::text
      or v_canonical_payload->>'executionId' <> v_execution_id::text
      or v_canonical_payload->>'executionHash' <> v_execution_hash
      or v_canonical_payload->>'supplierConfirmationId' <> v_confirmation_id::text
      or (v_canonical_payload->>'supplierConfirmationVersion')::integer <> v_confirmation_version
      or v_canonical_payload->>'supplierConfirmationHash' <> v_confirmation_hash
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_BOOKING_VERIFICATION', v_booking_id::text, p_payload_hash
      );
    end if;
    v_decision_name := v_canonical_payload->>'decision';
    v_verification_id := p_command_id;
    insert into public.booking_verification_decisions (
      id, booking_id, booking_authority_hash, review_id, customer_id,
      execution_id, execution_hash, supplier_confirmation_id,
      supplier_confirmation_version, supplier_confirmation_hash,
      decision, reason, canonical_payload, verification_hash,
      decided_by, actor_session_id, actor_aal
    ) values (
      v_verification_id, v_booking_id, v_booking.booking_authority_hash, v_review_id,
      v_booking.customer_id, v_execution_id, v_execution_hash, v_confirmation_id,
      v_confirmation_version, v_confirmation_hash, v_decision_name,
      btrim(v_canonical_payload->>'reason'), v_canonical_payload, v_verification_hash,
      p_actor_id, p_actor_session_id, p_actor_aal
    );
    v_from_status := 'UNDER_VERIFICATION';
    v_to_status := case when v_decision_name = 'VERIFY'
      then 'BOOKING_VERIFIED' else 'VERIFICATION_REJECTED' end;
    v_authority_hash := v_verification_hash;
    update public.bookings set status = v_to_status,
      current_verification_id = v_verification_id,
      current_verification_hash = v_verification_hash,
      verified_at = case when v_decision_name = 'VERIFY' then now() else null end,
      updated_at = now()
    where id = v_booking_id;

  elsif p_command_name = 'supplier_confirmation.correct' then
    if v_booking.status <> 'VERIFICATION_REJECTED'
      or v_execution_id <> v_booking.current_execution_id
      or v_execution_hash <> v_booking.current_execution_hash
      or v_confirmation_id <> v_booking.supplier_confirmation_id
      or v_confirmation_hash <> v_booking.supplier_confirmation_hash
      or v_verification_id <> v_booking.current_verification_id
      or v_verification_hash <> v_booking.current_verification_hash
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_REJECTED_CONFIRMATION_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    select * into v_execution from public.supplier_booking_executions
    where booking_id = v_booking_id and id = v_execution_id and execution_hash = v_execution_hash;
    select * into v_confirmation from public.supplier_confirmations
    where booking_id = v_booking_id and id = v_confirmation_id and confirmation_hash = v_confirmation_hash;
    select * into v_decision from public.booking_verification_decisions
    where booking_id = v_booking_id and id = v_verification_id
      and verification_hash = v_verification_hash and decision = 'REJECT'
      and supplier_confirmation_id = v_confirmation_id
      and supplier_confirmation_hash = v_confirmation_hash;
    if v_execution.id is null or v_confirmation.id is null or v_decision.id is null then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_REJECTED_CONFIRMATION_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    v_canonical_payload := p_payload->'confirmationPayload';
    v_authority_hash := p_payload->>'correctedConfirmationHash';
    if v_authority_hash is null or v_authority_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_supplier_confirmation_correction_payload(v_canonical_payload)
      or v_canonical_payload->>'bookingId' <> v_booking_id::text
      or v_canonical_payload->>'executionId' <> v_execution_id::text
      or v_canonical_payload->>'executionHash' <> v_execution_hash
      or v_canonical_payload->>'supersedesConfirmationId' <> v_confirmation_id::text
      or v_canonical_payload->>'supersedesConfirmationHash' <> v_confirmation_hash
      or v_canonical_payload->>'rejectedVerificationId' <> v_verification_id::text
      or v_canonical_payload->>'rejectedVerificationHash' <> v_verification_hash
      or v_canonical_payload->>'supplierName' <> v_execution.supplier_name
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_SUPPLIER_CONFIRMATION_CORRECTION', v_booking_id::text, p_payload_hash
      );
    end if;
    v_confirmation_version := v_confirmation.confirmation_version + 1;
    insert into public.supplier_confirmations (
      id, booking_id, execution_id, execution_hash, customer_id, supplier_name,
      channel, confirmation_reference, canonical_payload, confirmation_hash,
      supplier_confirmed_at, captured_by, actor_session_id, actor_aal,
      confirmation_version, supersedes_confirmation_id, supersedes_confirmation_hash,
      rejection_verification_id, rejection_verification_hash
    ) values (
      p_command_id, v_booking_id, v_execution_id, v_execution_hash,
      v_booking.customer_id, v_execution.supplier_name,
      v_canonical_payload->>'channel', btrim(v_canonical_payload->>'confirmationReference'),
      v_canonical_payload, v_authority_hash,
      (v_canonical_payload->>'confirmedAt')::timestamptz,
      p_actor_id, p_actor_session_id, p_actor_aal,
      v_confirmation_version, v_confirmation_id, v_confirmation_hash,
      v_verification_id, v_verification_hash
    );
    v_from_status := 'VERIFICATION_REJECTED';
    v_to_status := 'SUPPLIER_CONFIRMED';
    v_confirmation_id := p_command_id;
    v_confirmation_hash := v_authority_hash;
    update public.bookings set status = v_to_status,
      supplier_confirmation_id = v_confirmation_id,
      supplier_confirmation_hash = v_confirmation_hash,
      current_verification_review_id = null,
      current_verification_id = null, current_verification_hash = null,
      verification_started_at = null, verified_at = null,
      supplier_confirmed_at = now(), updated_at = now()
    where id = v_booking_id;

  elsif p_command_name = 'voucher.draft.create' then
    if v_booking.status not in ('BOOKING_VERIFIED', 'VOUCHER_DRAFTED')
      or v_verification_id <> v_booking.current_verification_id
      or v_verification_hash <> v_booking.current_verification_hash
      or v_execution_id <> v_booking.current_execution_id
      or v_execution_hash <> v_booking.current_execution_hash
      or v_confirmation_id <> v_booking.supplier_confirmation_id
      or v_confirmation_hash <> v_booking.supplier_confirmation_hash
      or v_confirmation_version is null
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'VERIFIED_BOOKING_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    select * into v_decision from public.booking_verification_decisions
    where booking_id = v_booking_id and id = v_verification_id
      and verification_hash = v_verification_hash and decision = 'VERIFY';
    select * into v_execution from public.supplier_booking_executions
    where booking_id = v_booking_id and id = v_execution_id and execution_hash = v_execution_hash;
    select * into v_confirmation from public.supplier_confirmations
    where booking_id = v_booking_id and id = v_confirmation_id
      and confirmation_version = v_confirmation_version
      and confirmation_hash = v_confirmation_hash;
    if v_decision.id is null or v_execution.id is null or v_confirmation.id is null then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'VERIFIED_BOOKING_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    v_canonical_payload := p_payload->'voucherPayload';
    v_voucher_hash := p_payload->>'voucherHash';
    if v_voucher_id is null or v_voucher_version_number is null
      or v_voucher_hash is null or v_voucher_hash !~ '^[0-9a-f]{64}$'
      or not private.is_valid_voucher_payload(v_canonical_payload)
      or v_canonical_payload->>'voucherId' <> v_voucher_id::text
      or (v_canonical_payload->>'versionNumber')::integer <> v_voucher_version_number
      or v_canonical_payload->>'bookingId' <> v_booking_id::text
      or v_canonical_payload->>'bookingAuthorityHash' <> v_booking.booking_authority_hash
      or v_canonical_payload->>'verificationId' <> v_verification_id::text
      or v_canonical_payload->>'verificationHash' <> v_verification_hash
      or v_canonical_payload->>'executionId' <> v_execution_id::text
      or v_canonical_payload->>'executionHash' <> v_execution_hash
      or v_canonical_payload->>'supplierConfirmationId' <> v_confirmation_id::text
      or (v_canonical_payload->>'supplierConfirmationVersion')::integer <> v_confirmation_version
      or v_canonical_payload->>'supplierConfirmationHash' <> v_confirmation_hash
      or v_canonical_payload->>'quotationId' <> v_booking.quotation_id::text
      or (v_canonical_payload->>'quotationVersion')::integer <> v_booking.quotation_version
      or v_canonical_payload->>'quotationHash' <> v_booking.quotation_hash
      or v_canonical_payload->>'locale' <> v_booking.locale
      or v_canonical_payload#>>'{supplier,name}' <> v_confirmation.supplier_name
      or v_canonical_payload#>>'{supplier,confirmationReference}' <> v_confirmation.confirmation_reference
      or v_canonical_payload#>>'{supplier,confirmationSummary}' <> v_confirmation.canonical_payload->>'serviceSummary'
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'INVALID_VOUCHER_VERSION', v_booking_id::text, p_payload_hash
      );
    end if;
    if v_booking.status = 'BOOKING_VERIFIED' then
      if v_voucher_version_number <> 1 or v_booking.voucher_id is not null
        or exists (select 1 from public.vouchers where booking_id = v_booking_id)
      then
        return private.fulfilment_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_VOUCHER_VERSION', v_booking_id::text, p_payload_hash
        );
      end if;
      insert into public.vouchers (
        id, booking_id, customer_id, locale, current_version, current_hash
      ) values (
        v_voucher_id, v_booking_id, v_booking.customer_id, v_booking.locale,
        v_voucher_version_number, v_voucher_hash
      );
    else
      select * into v_voucher from public.vouchers
      where id = v_booking.voucher_id and booking_id = v_booking_id for update;
      if not found or v_voucher.status <> 'DRAFT'
        or v_voucher_id <> v_voucher.id
        or v_voucher_version_number <> v_voucher.current_version + 1
      then
        return private.fulfilment_denial_result(
          p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
          'INVALID_VOUCHER_VERSION', v_booking_id::text, p_payload_hash
        );
      end if;
      update public.vouchers set current_version = v_voucher_version_number,
        current_hash = v_voucher_hash, updated_at = now()
      where id = v_voucher_id;
    end if;
    insert into public.voucher_versions (
      voucher_id, version_number, booking_id, booking_authority_hash, customer_id,
      verification_id, verification_hash, execution_id, execution_hash,
      supplier_confirmation_id, supplier_confirmation_version, supplier_confirmation_hash,
      quotation_id, quotation_version, quotation_hash, locale, canonical_payload,
      voucher_hash, preparation_source, created_by, actor_session_id, actor_aal
    ) values (
      v_voucher_id, v_voucher_version_number, v_booking_id, v_booking.booking_authority_hash,
      v_booking.customer_id, v_verification_id, v_verification_hash,
      v_execution_id, v_execution_hash, v_confirmation_id, v_confirmation_version,
      v_confirmation_hash, v_booking.quotation_id, v_booking.quotation_version,
      v_booking.quotation_hash, v_booking.locale, v_canonical_payload, v_voucher_hash,
      v_canonical_payload->>'preparationSource', p_actor_id, p_actor_session_id, p_actor_aal
    );
    v_from_status := v_booking.status;
    v_to_status := 'VOUCHER_DRAFTED';
    v_authority_hash := v_voucher_hash;
    update public.bookings set status = v_to_status,
      voucher_id = v_voucher_id, voucher_version = v_voucher_version_number,
      voucher_hash = v_voucher_hash, updated_at = now()
    where id = v_booking_id;

  else
    if v_booking.status <> 'VOUCHER_DRAFTED'
      or v_voucher_id <> v_booking.voucher_id
      or v_voucher_version_number <> v_booking.voucher_version
      or v_voucher_hash <> v_booking.voucher_hash
      or v_verification_id <> v_booking.current_verification_id
      or v_verification_hash <> v_booking.current_verification_hash
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_VOUCHER_VERSION_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    select * into v_voucher from public.vouchers
    where id = v_voucher_id and booking_id = v_booking_id for update;
    select * into v_voucher_version from public.voucher_versions
    where voucher_id = v_voucher_id and version_number = v_voucher_version_number
      and voucher_hash = v_voucher_hash and verification_id = v_verification_id
      and verification_hash = v_verification_hash;
    select * into v_decision from public.booking_verification_decisions
    where booking_id = v_booking_id and id = v_verification_id
      and verification_hash = v_verification_hash and decision = 'VERIFY';
    if v_voucher.id is null or v_voucher.status <> 'DRAFT'
      or v_voucher.current_version <> v_voucher_version_number
      or v_voucher.current_hash <> v_voucher_hash
      or v_voucher_version.voucher_id is null or v_decision.id is null
    then
      return private.fulfilment_denial_result(
        p_command_id, p_command_name, p_actor_id, p_actor_session_id, p_actor_aal,
        'EXACT_VOUCHER_VERSION_REQUIRED', v_booking_id::text, p_payload_hash
      );
    end if;
    insert into public.voucher_issuance_events (
      id, voucher_id, version_number, voucher_hash, booking_id, customer_id,
      verification_id, verification_hash, issued_by, actor_session_id, actor_aal
    ) values (
      p_command_id, v_voucher_id, v_voucher_version_number, v_voucher_hash,
      v_booking_id, v_booking.customer_id, v_verification_id, v_verification_hash,
      p_actor_id, p_actor_session_id, p_actor_aal
    );
    update public.vouchers set status = 'ISSUED',
      issued_version = current_version, issued_hash = current_hash,
      issued_at = now(), updated_at = now()
    where id = v_voucher_id;
    v_from_status := 'VOUCHER_DRAFTED';
    v_to_status := 'VOUCHER_ISSUED';
    v_authority_hash := v_voucher_hash;
    update public.bookings set status = v_to_status,
      voucher_issued_at = now(), updated_at = now()
    where id = v_booking_id;
  end if;

  insert into public.fulfilment_work_receipts (
    command_id, booking_id, customer_id, action, actor_role,
    from_status, to_status, authority_hash
  ) values (
    p_command_id, v_booking_id, v_booking.customer_id, p_command_name,
    v_actor_role, v_from_status, v_to_status, v_authority_hash
  );

  v_result := jsonb_strip_nulls(jsonb_build_object(
    'status', 'accepted', 'commandName', p_command_name,
    'bookingId', v_booking_id, 'bookingStatus', v_to_status,
    'reviewId', v_review_id, 'verificationId', v_verification_id,
    'verificationHash', v_verification_hash,
    'supplierConfirmationId', v_confirmation_id,
    'supplierConfirmationVersion', v_confirmation_version,
    'supplierConfirmationHash', v_confirmation_hash,
    'voucherId', v_voucher_id, 'voucherVersion', v_voucher_version_number,
    'voucherHash', v_voucher_hash, 'workReceiptId', p_command_id
  ));
  perform private.append_authority_event(
    p_command_id, p_actor_id, p_actor_session_id, p_actor_aal,
    p_command_name, 'accepted', null, 'booking', v_booking_id::text,
    v_authority_hash,
    jsonb_build_object(
      'fromStatus', v_from_status, 'toStatus', v_to_status,
      'actorRole', v_actor_role, 'quotationId', v_booking.quotation_id,
      'quotationHash', v_booking.quotation_hash
    )
  );
  insert into public.fulfilment_command_receipts (
    idempotency_key, command_id, command_name, actor_id,
    payload_hash, response, expires_at
  ) values (
    p_idempotency_key, p_command_id, p_command_name, p_actor_id,
    p_payload_hash, v_result, now() + interval '24 hours'
  );
  return v_result;
exception
  when unique_violation then
    select response into v_result from public.fulfilment_command_receipts
    where idempotency_key = p_idempotency_key
      and command_name = p_command_name and payload_hash = p_payload_hash;
    if found then return v_result; end if;
    raise;
end;
$$;

alter table public.booking_verification_reviews enable row level security;
alter table public.booking_verification_reviews force row level security;
alter table public.booking_verification_decisions enable row level security;
alter table public.booking_verification_decisions force row level security;
alter table public.vouchers enable row level security;
alter table public.vouchers force row level security;
alter table public.voucher_versions enable row level security;
alter table public.voucher_versions force row level security;
alter table public.voucher_issuance_events enable row level security;
alter table public.voucher_issuance_events force row level security;
alter table public.fulfilment_work_receipts enable row level security;
alter table public.fulfilment_work_receipts force row level security;
alter table public.fulfilment_command_receipts enable row level security;
alter table public.fulfilment_command_receipts force row level security;

create policy booking_verification_reviews_select_aal2_operations
on public.booking_verification_reviews for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'admin', 'founder') and active
  )
);

create policy booking_verification_decisions_select_aal2_operations
on public.booking_verification_decisions for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'admin', 'founder') and active
  )
);

create policy vouchers_select_issued_owner_or_aal2_operations
on public.vouchers for select to authenticated
using (
  (customer_id = (select auth.uid()) and status = 'ISSUED')
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'admin', 'founder') and active
    )
  )
);

create policy voucher_versions_select_issued_owner_or_aal2_operations
on public.voucher_versions for select to authenticated
using (
  (
    customer_id = (select auth.uid())
    and exists (
      select 1 from public.vouchers
      where id = voucher_versions.voucher_id
        and booking_id = voucher_versions.booking_id
        and customer_id = (select auth.uid())
        and status = 'ISSUED'
        and issued_version = voucher_versions.version_number
        and issued_hash = voucher_versions.voucher_hash
    )
  )
  or (
    (select auth.jwt()->>'aal') = 'aal2'
    and exists (
      select 1 from public.role_assignments
      where user_id = (select auth.uid())
        and role in ('staff', 'manager', 'admin', 'founder') and active
    )
  )
);

create policy voucher_issuance_events_select_aal2_operations
on public.voucher_issuance_events for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'admin', 'founder') and active
  )
);

create policy fulfilment_work_receipts_select_aal2_operations
on public.fulfilment_work_receipts for select to authenticated
using (
  (select auth.jwt()->>'aal') = 'aal2'
  and exists (
    select 1 from public.role_assignments
    where user_id = (select auth.uid())
      and role in ('staff', 'manager', 'admin', 'founder') and active
  )
);

revoke all on table public.bookings from anon, authenticated;
grant select (
  id, payment_request_id, readiness_evaluation_id, readiness_evaluation_hash,
  acceptance_id, quotation_id, quotation_version, quotation_hash, customer_id,
  locale, currency, amount_minor, status, booking_authority_hash,
  current_execution_id, current_execution_hash, supplier_confirmation_id,
  supplier_confirmation_hash,
  created_at, updated_at, supplier_executed_at, supplier_confirmed_at,
  verification_started_at, verified_at, voucher_issued_at
) on table public.bookings to authenticated;

revoke all on table public.booking_verification_reviews from anon, authenticated;
grant select on table public.booking_verification_reviews to authenticated;
revoke all on table public.booking_verification_decisions from anon, authenticated;
grant select on table public.booking_verification_decisions to authenticated;
revoke all on table public.vouchers from anon, authenticated;
grant select on table public.vouchers to authenticated;
revoke all on table public.voucher_versions from anon, authenticated;
grant select on table public.voucher_versions to authenticated;
revoke all on table public.voucher_issuance_events from anon, authenticated;
grant select on table public.voucher_issuance_events to authenticated;
revoke all on table public.fulfilment_work_receipts from anon, authenticated;
grant select on table public.fulfilment_work_receipts to authenticated;
revoke all on table public.fulfilment_command_receipts from anon, authenticated;

grant select, insert on table public.booking_verification_reviews to service_role;
grant select, insert on table public.booking_verification_decisions to service_role;
grant select, insert, update on table public.vouchers to service_role;
grant select, insert on table public.voucher_versions to service_role;
grant select, insert on table public.voucher_issuance_events to service_role;
grant select, insert on table public.fulfilment_work_receipts to service_role;
grant select, insert on table public.fulfilment_command_receipts to service_role;

revoke all on function private.guard_booking_update() from public, anon, authenticated;
revoke all on function private.guard_voucher_update() from public, anon, authenticated;
revoke all on function private.is_valid_booking_verification_payload(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_valid_supplier_confirmation_correction_payload(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_valid_voucher_payload(jsonb)
  from public, anon, authenticated;
grant execute on function private.is_valid_booking_verification_payload(jsonb) to service_role;
grant execute on function private.is_valid_supplier_confirmation_correction_payload(jsonb) to service_role;
grant execute on function private.is_valid_voucher_payload(jsonb) to service_role;
revoke all on function private.fulfilment_denial_result(
  uuid, text, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.fulfilment_denial_result(
  uuid, text, uuid, uuid, text, text, text, text
) to service_role;
revoke all on function public.execute_fulfilment_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) from public, anon, authenticated;
grant execute on function public.execute_fulfilment_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) to service_role;

comment on table public.booking_verification_reviews is
  'Human review start bound to the exact Booking, Supplier execution and Supplier Confirmation.';
comment on table public.booking_verification_decisions is
  'Immutable human Booking Verification or rejection evidence. Supplier Confirmation alone is not Verification.';
comment on table public.voucher_versions is
  'Immutable Customer-safe Voucher versions bound to the exact verified Booking evidence.';
comment on table public.voucher_issuance_events is
  'Human Voucher issuance of one exact version and SHA-256 hash.';
comment on function public.execute_fulfilment_command(
  uuid, text, text, uuid, uuid, text, timestamptz, jsonb, text
) is
  'Service-secret-only gateway separating human Booking Verification, Voucher preparation and human issue.';
