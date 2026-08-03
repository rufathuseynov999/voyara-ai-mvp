-- VOYARA AI Task 010: Founder Command Center authoritative read model.
-- These security-invoker views contain no command authority. They are exposed
-- only to the server-side service Role after application Founder + AAL2 checks.
-- Missing ledgers are represented as UNAVAILABLE, never as fabricated zeroes.

create view public.founder_financial_metrics
with (security_invoker = true)
as
with booked as (
  select
    count(*)::bigint as record_count,
    coalesce(sum(b.amount_minor), 0)::bigint as gbv_minor,
    coalesce(sum(
      case
        when (qv.canonical_payload #>> '{commercial,grossProfitMinor}') ~ '^-?[0-9]+$'
          then (qv.canonical_payload #>> '{commercial,grossProfitMinor}')::bigint
        else 0
      end
    ), 0)::bigint as planned_gp_minor,
    max(b.updated_at) as source_updated_at
  from public.bookings b
  join public.quotation_versions qv
    on qv.quotation_id = b.quotation_id
   and qv.version_number = b.quotation_version
   and qv.payload_hash = b.quotation_hash
), receivables as (
  select
    count(*)::bigint as record_count,
    coalesce(sum(amount_minor), 0)::bigint as amount_minor,
    max(updated_at) as source_updated_at
  from public.payment_requests
  where status in ('REQUESTED', 'EVIDENCE_RECEIVED', 'UNDER_REVIEW', 'EVIDENCE_REJECTED')
), exposure as (
  select
    count(*)::bigint as record_count,
    coalesce(sum(fa.amount_minor), 0)::bigint as amount_minor,
    max(fa.allocated_at) as source_updated_at
  from public.fund_allocations fa
  left join public.bookings b on b.payment_request_id = fa.payment_request_id
  where b.id is null or b.status <> 'VOUCHER_ISSUED'
)
select
  1::integer as display_order,
  'CASH'::text as metric_code,
  'UNAVAILABLE'::text as availability,
  null::bigint as amount_minor,
  'AZN'::text as currency,
  'NO_CASH_OR_BANK_LEDGER'::text as basis_code,
  0::bigint as source_record_count,
  null::timestamptz as source_updated_at
union all
select 2, 'REVENUE', 'UNAVAILABLE', null::bigint, 'AZN',
  'NO_REVENUE_RECOGNITION_LEDGER', 0::bigint, null::timestamptz
union all
select 3, 'GBV', 'AVAILABLE', booked.gbv_minor, 'AZN',
  'BOOKINGS_CREATED_EXCLUDING_NO_STATES', booked.record_count, booked.source_updated_at
from booked
union all
select 4, 'PLANNED_GROSS_PROFIT', 'AVAILABLE', booked.planned_gp_minor, 'AZN',
  'EXACT_BOOKED_QUOTATION_PLANNED_GP_NOT_REALISED_GP', booked.record_count, booked.source_updated_at
from booked
union all
select 5, 'RECEIVABLES', 'AVAILABLE', receivables.amount_minor, 'AZN',
  'OPEN_PAYMENT_REQUESTS_NOT_ACCOUNTING_AR', receivables.record_count, receivables.source_updated_at
from receivables
union all
select 6, 'EXPOSURE', 'AVAILABLE', exposure.amount_minor, 'AZN',
  'ALLOCATED_FUNDS_AWAITING_VOUCHER_ISSUE', exposure.record_count, exposure.source_updated_at
from exposure;

create view public.founder_decision_queue
with (security_invoker = true)
as
with quotation_values as (
  select
    cq.id,
    cq.status,
    cq.updated_at,
    case
      when (qv.canonical_payload #>> '{customer,totalMinor}') ~ '^[0-9]+$'
        then (qv.canonical_payload #>> '{customer,totalMinor}')::bigint
      else null
    end as amount_minor
  from public.commercial_quotations cq
  join public.quotation_versions qv
    on qv.quotation_id = cq.id
   and qv.version_number = cq.current_version
   and qv.payload_hash = cq.current_hash
)
select 20::integer as priority_order, 'COMMERCIAL_APPROVAL'::text as queue_code,
  id as entity_id, status as status_code, amount_minor, 'AZN'::text as currency,
  updated_at as waiting_since, '/staff/approvals'::text as target_path
from quotation_values where status = 'PENDING_APPROVAL'
union all
select 10, 'PAYMENT_REVIEW', id, status, amount_minor, currency,
  coalesce(evidence_received_at, updated_at), '/staff/finance'
from public.payment_requests where status = 'EVIDENCE_RECEIVED'
union all
select 5, 'PAYMENT_VERIFICATION', id, status, amount_minor, currency,
  coalesce(review_started_at, updated_at), '/staff/finance'
from public.payment_requests where status = 'UNDER_REVIEW'
union all
select 15, 'FUNDS_ALLOCATION', id, status, amount_minor, currency,
  coalesce(verified_at, updated_at), '/staff/finance'
from public.payment_requests where status = 'VERIFIED'
union all
select 15, 'FINANCIAL_READINESS', id, status, amount_minor, currency,
  coalesce(allocated_at, updated_at), '/staff/finance'
from public.payment_requests where status = 'ALLOCATED'
union all
select 10, 'BOOKING_VERIFICATION', id, status, amount_minor, currency,
  coalesce(supplier_confirmed_at, updated_at), '/staff/bookings'
from public.bookings where status in ('SUPPLIER_CONFIRMED', 'UNDER_VERIFICATION')
union all
select 10, 'VOUCHER_ISSUE', id, status, amount_minor, currency,
  updated_at, '/staff/bookings'
from public.bookings where status = 'VOUCHER_DRAFTED'
union all
select
  case when priority = 'P1_CRITICAL' then 1 else 3 end,
  'SUPPORT_ESCALATION', id, status, null::bigint, null::text,
  updated_at, '/staff/support'
from public.support_cases
where status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
  and (priority = 'P1_CRITICAL' or escalation_level = 'FOUNDER');

create view public.founder_critical_exceptions
with (security_invoker = true)
as
select
  1::integer as severity_order,
  'PAYMENT_EVIDENCE_REJECTED'::text as exception_code,
  id as entity_id,
  status as status_code,
  'HIGH'::text as severity,
  amount_minor,
  currency,
  updated_at as occurred_at,
  '/staff/finance'::text as target_path
from public.payment_requests where status = 'EVIDENCE_REJECTED'
union all
select 0, 'BOOKING_VERIFICATION_REJECTED', id, status, 'CRITICAL',
  amount_minor, currency, updated_at, '/staff/bookings'
from public.bookings where status = 'VERIFICATION_REJECTED'
union all
select
  case when priority = 'P1_CRITICAL' then 0 else 1 end,
  'SUPPORT_CRITICAL', id, status,
  case when priority = 'P1_CRITICAL' then 'CRITICAL' else 'HIGH' end,
  null::bigint, null::text, updated_at, '/staff/support'
from public.support_cases
where status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
  and (priority = 'P1_CRITICAL' or escalation_level = 'FOUNDER');

create view public.founder_pipeline_summary
with (security_invoker = true)
as
with quotation_values as (
  select
    cq.id,
    cq.status,
    case
      when (qv.canonical_payload #>> '{customer,totalMinor}') ~ '^[0-9]+$'
        then (qv.canonical_payload #>> '{customer,totalMinor}')::bigint
      else null
    end as amount_minor
  from public.commercial_quotations cq
  left join public.quotation_versions qv
    on qv.quotation_id = cq.id
   and qv.version_number = cq.current_version
   and qv.payload_hash = cq.current_hash
)
select 1::integer as stage_order, 'TRAVEL_REQUEST_INTAKE'::text as stage_code,
  count(*)::bigint as item_count, null::bigint as amount_minor, null::text as currency
from public.travel_requests where status in ('SUBMITTED', 'AI_PREPARATION', 'HUMAN_REVIEW')
union all
select 2, 'COMMERCIAL_DRAFT', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from quotation_values where status in ('DRAFT', 'REJECTED')
union all
select 3, 'COMMERCIAL_APPROVAL', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from quotation_values where status in ('PENDING_APPROVAL', 'APPROVED')
union all
select 4, 'PROPOSAL_PUBLISHED', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from quotation_values where status = 'PUBLISHED'
union all
select 5, 'CUSTOMER_ACCEPTED', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from quotation_values where status = 'ACCEPTED'
union all
select 6, 'PAYMENT_PENDING', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from public.payment_requests
where status in ('REQUESTED', 'EVIDENCE_RECEIVED', 'UNDER_REVIEW', 'EVIDENCE_REJECTED', 'VERIFIED', 'ALLOCATED')
union all
select 7, 'PAYMENT_READY', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from public.payment_requests where status = 'READY_FOR_BOOKING'
union all
select 8, 'BOOKING_OPERATIONS', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from public.bookings where status in ('CREATED', 'SUPPLIER_EXECUTED')
union all
select 9, 'BOOKING_VERIFICATION', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from public.bookings
where status in ('SUPPLIER_CONFIRMED', 'UNDER_VERIFICATION', 'VERIFICATION_REJECTED', 'BOOKING_VERIFIED', 'VOUCHER_DRAFTED')
union all
select 10, 'VOUCHER_ISSUED', count(*)::bigint,
  coalesce(sum(amount_minor), 0)::bigint, 'AZN'
from public.bookings where status = 'VOUCHER_ISSUED';

create view public.founder_team_workload
with (security_invoker = true)
as
with active_items as (
  select 'TRAVEL_REQUEST'::text as domain_code, tr.assigned_staff_id as owner_id
  from public.travel_requests tr
  left join public.commercial_quotations cq on cq.travel_request_id = tr.id
  where tr.status = 'HUMAN_REVIEW'
    and (cq.id is null or cq.status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED'))
  union all
  select 'PAYMENT',
    case when pr.status = 'UNDER_REVIEW' then pre.reviewer_id else null end
  from public.payment_requests pr
  left join public.payment_review_events pre
    on pre.payment_request_id = pr.id and pre.id = pr.current_review_id
  where pr.status in ('EVIDENCE_RECEIVED', 'UNDER_REVIEW', 'VERIFIED', 'ALLOCATED')
  union all
  select 'BOOKING', bvr.reviewer_id
  from public.bookings b
  left join public.booking_verification_reviews bvr
    on bvr.booking_id = b.id and bvr.id = b.current_verification_review_id
  where b.status in (
    'CREATED', 'SUPPLIER_EXECUTED', 'SUPPLIER_CONFIRMED',
    'UNDER_VERIFICATION', 'VERIFICATION_REJECTED', 'BOOKING_VERIFIED', 'VOUCHER_DRAFTED'
  )
  union all
  select 'SUPPORT', owner_id
  from public.support_cases
  where status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER')
), active_roles as (
  select user_id, string_agg(role, ', ' order by role) as role_summary
  from public.role_assignments
  where active
  group by user_id
)
select
  ai.owner_id as actor_id,
  case
    when ai.owner_id is null then 'UNASSIGNED'
    else coalesce(p.display_name, 'TEAM_MEMBER')
  end as display_name,
  coalesce(ar.role_summary, 'UNASSIGNED') as role_summary,
  count(*)::bigint as total_items,
  count(*) filter (where ai.domain_code = 'TRAVEL_REQUEST')::bigint as travel_request_items,
  count(*) filter (where ai.domain_code = 'PAYMENT')::bigint as payment_items,
  count(*) filter (where ai.domain_code = 'BOOKING')::bigint as booking_items,
  count(*) filter (where ai.domain_code = 'SUPPORT')::bigint as support_items
from active_items ai
left join public.profiles p on p.id = ai.owner_id
left join active_roles ar on ar.user_id = ai.owner_id
group by ai.owner_id, p.display_name, ar.role_summary;

create view public.founder_source_freshness
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

revoke all on table public.founder_financial_metrics from public, anon, authenticated;
revoke all on table public.founder_decision_queue from public, anon, authenticated;
revoke all on table public.founder_critical_exceptions from public, anon, authenticated;
revoke all on table public.founder_pipeline_summary from public, anon, authenticated;
revoke all on table public.founder_team_workload from public, anon, authenticated;
revoke all on table public.founder_source_freshness from public, anon, authenticated;

grant select on table public.founder_financial_metrics to service_role;
grant select on table public.founder_decision_queue to service_role;
grant select on table public.founder_critical_exceptions to service_role;
grant select on table public.founder_pipeline_summary to service_role;
grant select on table public.founder_team_workload to service_role;
grant select on table public.founder_source_freshness to service_role;

comment on view public.founder_financial_metrics is
  'Task 010 service-only definitions for distinct Founder financial concepts; unavailable ledgers are explicit.';
comment on view public.founder_decision_queue is
  'Task 010 service-only human decision queue derived from authoritative domain states.';
comment on view public.founder_critical_exceptions is
  'Task 010 service-only Payment, Booking and Support exceptions; no autonomous action authority.';
comment on view public.founder_pipeline_summary is
  'Task 010 operational stage snapshot; stages are not a conversion funnel or revenue ledger.';
comment on view public.founder_team_workload is
  'Task 010 current accountable and unassigned work counts across delivered domains.';
comment on view public.founder_source_freshness is
  'Task 010 source availability and freshness; absent launch domains remain NOT_IMPLEMENTED.';
