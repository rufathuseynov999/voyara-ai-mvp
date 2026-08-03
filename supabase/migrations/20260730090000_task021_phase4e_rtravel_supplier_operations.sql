-- Phase 4E — R-Travel migration, partners, contracts and supplier
-- operations. Additive only. Extends the existing CRM/contacts/
-- conversations/approvals/RLS/audit architecture unchanged — no existing
-- table, column, policy, or function is dropped or altered destructively.
--
-- R-Travel remains the legal merchant, supplier-contract authority, booking
-- authority, invoicing authority, and refund/chargeback authority
-- throughout this schema — every table below is a RECORD of that authority
-- being exercised by a human, never an authority the AI holds itself.

-- ============================================================================
-- 1. Supplier / partner registry
-- ============================================================================

create type public.supplier_type as enum (
  'HOTEL_WHOLESALER', 'DIRECT_HOTEL', 'HOTEL_CHAIN', 'TOUR_OPERATOR', 'DMC',
  'AIRLINE_CONSOLIDATOR', 'GDS_PROVIDER', 'NDC_PROVIDER', 'TRAVEL_AGENCY', 'SUB_AGENCY',
  'TRANSFER_PROVIDER', 'INSURANCE_PROVIDER', 'VISA_SERVICE', 'ACTIVITY_PROVIDER',
  'CAR_RENTAL', 'VIP_CONCIERGE', 'CORPORATE_TRAVEL_PARTNER'
);

create type public.integration_status as enum ('NO_INTEGRATION', 'PORTAL_ONLY', 'API_AVAILABLE', 'API_INTEGRATED');
create type public.contract_status as enum ('DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');
create type public.supplier_risk_status as enum ('LOW', 'MEDIUM', 'HIGH', 'UNDER_REVIEW');

create table public.suppliers (
  id uuid primary key,
  legal_name text not null,
  trading_name text,
  supplier_type public.supplier_type not null,
  countries text[] not null default '{}',
  destinations text[] not null default '{}',
  currencies text[] not null default '{}',
  languages text[] not null default '{}',
  account_manager_id uuid,
  operational_contacts jsonb not null default '[]'::jsonb,
  finance_contacts jsonb not null default '[]'::jsonb,
  emergency_contacts jsonb not null default '[]'::jsonb,
  portal_url text,
  api_available boolean not null default false,
  integration_status public.integration_status not null default 'NO_INTEGRATION',
  contract_status public.contract_status not null default 'DRAFT',
  activation_date date,
  expiry_date date,
  commercial_priority int not null default 0,
  human_owner_id uuid,
  risk_status public.supplier_risk_status not null default 'UNDER_REVIEW',
  notes text,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index suppliers_type_idx on public.suppliers (supplier_type);
create index suppliers_contract_status_idx on public.suppliers (contract_status);

-- Append-only audit journal for every supplier-record change, identical
-- shape/discipline to agent_audit_events / payment_link_events / call_events.
create table public.supplier_events (
  id uuid primary key,
  supplier_id uuid not null references public.suppliers (id),
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  occurred_at timestamptz not null default now()
);
create index supplier_events_supplier_idx on public.supplier_events (supplier_id, occurred_at);

-- ============================================================================
-- 2. Contract authority and versioning
-- ============================================================================

create type public.agreement_type as enum (
  'NET_RATE', 'COMMISSION', 'HYBRID', 'CONSOLIDATOR_FARE', 'GDS_ACCESS', 'FRAMEWORK_AGREEMENT'
);

-- The current, authoritative row per contract. Approval-by-content-hash,
-- identical discipline to message_send_policies / payment_link_requests:
-- `content_hash` is recomputed from the contract's own defining fields and
-- checked before any operation may cite this contract as active authority.
create table public.contracts (
  id uuid primary key,
  agreement_type public.agreement_type not null,
  rtravel_legal_entity text not null,
  supplier_id uuid not null references public.suppliers (id),
  supplier_legal_entity text not null,
  contract_reference text not null unique,
  effective_date date not null,
  expiry_date date,
  renewal_conditions text,
  territory text,
  products_covered text[] not null default '{}',
  pricing_structure text not null,
  markup_rules jsonb not null default '{}'::jsonb,
  minimum_advertised_price_restriction text,
  currency text not null,
  payment_terms text,
  deposit_or_credit_line_requirement text,
  cancellation_rules text,
  refund_responsibility text not null,
  chargeback_responsibility text not null,
  booking_voucher_requirements text,
  resale_permissions jsonb not null default '{}'::jsonb,
  voyara_branding_allowed boolean not null default false,
  rtravel_identity_required boolean not null default true,
  confidentiality_restrictions text,
  status public.contract_status not null default 'DRAFT',
  approved_by uuid,
  approved_at timestamptz,
  content_hash text,
  version int not null default 1,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_active_requires_approval check (
    status <> 'ACTIVE' or (approved_by is not null and approved_at is not null and content_hash is not null)
  )
);

create index contracts_supplier_idx on public.contracts (supplier_id);
create index contracts_status_idx on public.contracts (status);
create index contracts_expiry_idx on public.contracts (expiry_date) where status = 'ACTIVE';

-- Append-only version history — every prior version of a contract's
-- defining fields, immutable once written.
create table public.contract_versions (
  id uuid primary key,
  contract_id uuid not null references public.contracts (id),
  version int not null,
  content_hash text not null,
  snapshot jsonb not null,
  created_by uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (contract_id, version)
);

-- ============================================================================
-- 3. Secure document references
-- ============================================================================

create type public.document_type as enum (
  'CONTRACT', 'AMENDMENT', 'RATE_SHEET', 'COMMISSION_SCHEDULE', 'CANCELLATION_POLICY',
  'SUPPLIER_ONBOARDING_FORM', 'ACCREDITATION', 'INSURANCE_CERTIFICATE', 'IATA_CONSOLIDATOR_DOCUMENT',
  'BANK_DETAILS', 'TAX_DOCUMENT', 'LEGAL_DOCUMENT'
);
create type public.document_classification as enum ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');
create type public.document_review_status as enum ('PENDING_REVIEW', 'REVIEWED', 'FLAGGED', 'EXPIRED');

-- Object-storage REFERENCE only — never the document content itself, and
-- never a public URL. This schema never stores credentials or passwords in
-- any text field here or anywhere else.
create table public.document_references (
  id uuid primary key,
  subject_type text not null,
  subject_id uuid not null,
  document_type public.document_type not null,
  object_storage_key text not null,
  checksum text not null,
  version int not null default 1,
  classification public.document_classification not null default 'CONFIDENTIAL',
  retention_status text not null default 'ACTIVE',
  access_control jsonb not null default '{}'::jsonb,
  uploaded_by uuid not null,
  review_status public.document_review_status not null default 'PENDING_REVIEW',
  expiry_alert_at timestamptz,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint document_references_no_credential_shaped_key check (
    object_storage_key !~* '(password|passwd|secret|api[_-]?key)'
  )
);
create index document_references_subject_idx on public.document_references (subject_type, subject_id);

create table public.document_events (
  id uuid primary key,
  document_id uuid not null references public.document_references (id),
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  occurred_at timestamptz not null default now()
);

-- ============================================================================
-- 4. Portal-assisted operational workflow
-- ============================================================================

create type public.portal_task_status as enum (
  'DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ASSIGNED', 'PORTAL_ACTION_REQUIRED',
  'SUBMITTED', 'SUPPLIER_PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'HUMAN_ESCALATION_REQUIRED'
);

create table public.portal_tasks (
  id uuid primary key,
  supplier_id uuid not null references public.suppliers (id),
  contract_id uuid references public.contracts (id),
  conversation_id uuid references public.conversations (id),
  contact_id uuid not null references public.contacts (id),
  status public.portal_task_status not null default 'DRAFT',
  booking_data jsonb not null default '{}'::jsonb,
  proposed_markup numeric,
  checklist jsonb not null default '[]'::jsonb,
  assigned_owner_id uuid,
  supplier_confirmation_reference text,
  voucher_metadata jsonb,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_tasks_confirmed_requires_evidence check (
    status <> 'CONFIRMED' or (assigned_owner_id is not null and supplier_confirmation_reference is not null)
  )
);
create index portal_tasks_supplier_idx on public.portal_tasks (supplier_id);
create index portal_tasks_status_idx on public.portal_tasks (status);

create table public.portal_task_events (
  id uuid primary key,
  portal_task_id uuid not null references public.portal_tasks (id),
  kind text not null,
  actor_id uuid not null,
  actor_kind text not null,
  correlation_id text not null,
  reason_code text,
  occurred_at timestamptz not null default now()
);

create table public.portal_task_idempotency_keys (
  idempotency_key text primary key,
  portal_task_id uuid not null references public.portal_tasks (id),
  correlation_id text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 5. Hotel / tour / DMC / transfer / excursion / insurance / visa / VIP bookings
-- ============================================================================

create type public.service_type as enum (
  'HOTEL_ONLY', 'TREATMENT_WELLNESS', 'TOUR_PACKAGE', 'DYNAMIC_PACKAGE', 'DMC_SERVICE',
  'TRANSFER', 'EXCURSION', 'INSURANCE', 'VISA', 'VIP_SERVICE'
);
create type public.voucher_status as enum ('NOT_ISSUED', 'ISSUED', 'SENT_TO_CUSTOMER', 'VOID');

create table public.service_bookings (
  id uuid primary key,
  contact_id uuid not null references public.contacts (id),
  proposal_version_id uuid,
  supplier_id uuid not null references public.suppliers (id),
  contract_id uuid not null references public.contracts (id),
  service_type public.service_type not null,
  net_cost_minor_units bigint not null,
  customer_price_minor_units bigint not null,
  currency text not null,
  expected_margin_minor_units bigint not null,
  cancellation_terms text,
  responsible_employee_id uuid not null,
  supplier_confirmation text,
  voucher_status public.voucher_status not null default 'NOT_ISSUED',
  portal_task_id uuid references public.portal_tasks (id),
  correlation_id text not null,
  created_at timestamptz not null default now()
);
create index service_bookings_contact_idx on public.service_bookings (contact_id);
create index service_bookings_supplier_idx on public.service_bookings (supplier_id);

-- ============================================================================
-- 6. Air-ticketing operations (human-controlled only)
-- ============================================================================

create type public.ticketing_status as enum (
  'PNR_HELD', 'PENDING_TICKETING', 'TICKETED', 'VOIDED', 'REISSUED', 'REFUNDED', 'CANCELLED'
);

create table public.air_ticketing_records (
  id uuid primary key,
  contact_id uuid not null references public.contacts (id),
  consolidator_supplier_id uuid not null references public.suppliers (id),
  contract_id uuid not null references public.contracts (id),
  route text not null,
  passenger_names jsonb not null default '[]'::jsonb,
  fare_basis text,
  baggage text,
  ticketing_deadline timestamptz,
  pnr_reference text,
  net_fare_minor_units bigint not null,
  taxes_minor_units bigint not null default 0,
  service_fee_minor_units bigint not null default 0,
  customer_price_minor_units bigint not null,
  currency text not null,
  ticketing_status public.ticketing_status not null default 'PNR_HELD',
  change_refund_conditions text,
  human_ticketing_owner_id uuid,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint air_ticketing_ticketed_requires_human_owner check (
    ticketing_status = 'PNR_HELD' or human_ticketing_owner_id is not null
  )
);
create index air_ticketing_contact_idx on public.air_ticketing_records (contact_id);

-- ============================================================================
-- 7. R-Travel data migration batches (reversible, human-approved)
-- ============================================================================

create type public.migration_batch_type as enum (
  'SUPPLIERS', 'PARTNERS', 'CONTRACTS', 'ACCOUNT_MANAGERS', 'PORTAL_RECORDS', 'COMMERCIAL_TERMS',
  'CUSTOMERS', 'LEADS', 'BOOKINGS', 'FUTURE_TRIPS', 'PAYMENT_BALANCES', 'CORPORATE_CLIENTS', 'AGENCY_PARTNERS'
);
create type public.migration_batch_status as enum ('DRY_RUN', 'VALIDATED', 'COMMITTED', 'REVERSED');
create type public.migration_row_status as enum ('ACCEPTED', 'REJECTED', 'DUPLICATE');

create table public.migration_batches (
  id uuid primary key,
  batch_type public.migration_batch_type not null,
  source_provenance text not null,
  imported_by uuid not null,
  dry_run boolean not null default true,
  status public.migration_batch_status not null default 'DRY_RUN',
  validation_report jsonb not null default '{}'::jsonb,
  row_count int not null default 0,
  accepted_count int not null default 0,
  rejected_count int not null default 0,
  approved_by uuid,
  approved_at timestamptz,
  reversed_at timestamptz,
  reversed_by uuid,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  constraint migration_batches_committed_requires_approval check (
    status <> 'COMMITTED' or (approved_by is not null and approved_at is not null)
  ),
  constraint migration_batches_reversed_state check (
    (reversed_at is null and reversed_by is null) or (status = 'REVERSED' and reversed_at is not null and reversed_by is not null)
  )
);

create table public.migration_rows (
  id uuid primary key,
  batch_id uuid not null references public.migration_batches (id),
  row_number int not null,
  raw_data jsonb not null,
  status public.migration_row_status not null,
  target_table text,
  target_id uuid,
  rejection_reason text,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, row_number)
);
create index migration_rows_batch_idx on public.migration_rows (batch_id);

-- ============================================================================
-- RLS: forced on every new table. AAL2 staff read; no direct authenticated
-- write policy anywhere (service-role store only) — identical discipline to
-- every prior migration in this project.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'suppliers', 'supplier_events', 'contracts', 'contract_versions',
    'document_references', 'document_events', 'portal_tasks', 'portal_task_events',
    'portal_task_idempotency_keys', 'service_bookings', 'air_ticketing_records',
    'migration_batches', 'migration_rows'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      $policy$create policy %I_select_aal2_staff on public.%I
        for select to authenticated
        using (
          (select auth.jwt()->>'aal') = 'aal2'
          and exists (select 1 from public.role_assignments where user_id = (select auth.uid()) and role in ('staff','manager','finance','admin','founder') and active)
        )$policy$,
      t, t
    );
  end loop;
end $$;
