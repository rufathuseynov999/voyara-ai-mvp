begin;

select plan(22);

select has_view('public', 'founder_financial_metrics', 'Founder financial metric view exists');
select has_view('public', 'founder_decision_queue', 'Founder decision queue view exists');
select has_view('public', 'founder_critical_exceptions', 'Founder exception view exists');
select has_view('public', 'founder_pipeline_summary', 'Founder pipeline view exists');
select has_view('public', 'founder_team_workload', 'Founder workload view exists');
select has_view('public', 'founder_source_freshness', 'Founder source freshness view exists');

select ok('security_invoker=true' = any((select reloptions from pg_class where oid = 'public.founder_financial_metrics'::regclass)), 'financial view invokes caller security');
select ok('security_invoker=true' = any((select reloptions from pg_class where oid = 'public.founder_decision_queue'::regclass)), 'decision view invokes caller security');
select ok('security_invoker=true' = any((select reloptions from pg_class where oid = 'public.founder_critical_exceptions'::regclass)), 'exception view invokes caller security');
select ok('security_invoker=true' = any((select reloptions from pg_class where oid = 'public.founder_pipeline_summary'::regclass)), 'pipeline view invokes caller security');
select ok('security_invoker=true' = any((select reloptions from pg_class where oid = 'public.founder_team_workload'::regclass)), 'workload view invokes caller security');
select ok('security_invoker=true' = any((select reloptions from pg_class where oid = 'public.founder_source_freshness'::regclass)), 'freshness view invokes caller security');

select ok(not exists (
  select 1 from unnest(array[
    'public.founder_financial_metrics', 'public.founder_decision_queue',
    'public.founder_critical_exceptions', 'public.founder_pipeline_summary',
    'public.founder_team_workload', 'public.founder_source_freshness'
  ]) as view_name
  where has_table_privilege('authenticated', view_name, 'select')
), 'authenticated browser sessions cannot select any Founder aggregate view');

select ok(not exists (
  select 1 from unnest(array[
    'public.founder_financial_metrics', 'public.founder_decision_queue',
    'public.founder_critical_exceptions', 'public.founder_pipeline_summary',
    'public.founder_team_workload', 'public.founder_source_freshness'
  ]) as view_name
  where not has_table_privilege('service_role', view_name, 'select')
), 'server service Role can select every Founder aggregate view');

select is((select count(*)::integer from public.founder_financial_metrics), 6, 'six distinct financial concepts are always present');
select ok(exists (
  select 1 from public.founder_financial_metrics
  where metric_code = 'CASH' and availability = 'UNAVAILABLE'
    and amount_minor is null and basis_code = 'NO_CASH_OR_BANK_LEDGER'
), 'Cash is unavailable rather than fabricated without a ledger');
select ok(exists (
  select 1 from public.founder_financial_metrics
  where metric_code = 'REVENUE' and availability = 'UNAVAILABLE'
    and amount_minor is null and basis_code = 'NO_REVENUE_RECOGNITION_LEDGER'
), 'Revenue is unavailable rather than fabricated without a ledger');
select is((select count(*)::integer from public.founder_pipeline_summary), 10, 'ten delivered operational stages are explicit');
select is((select count(*)::integer from public.founder_source_freshness), 10, 'delivered and unavailable data sources are explicit');
select ok(exists (
  select 1 from public.founder_source_freshness
  where source_code = 'MEMBERSHIP' and source_status = 'NOT_IMPLEMENTED'
), 'Membership performance is not invented');
select ok(exists (
  select 1 from public.founder_source_freshness
  where source_code = 'AI_ACTIVITY_AND_COST' and source_status = 'NOT_IMPLEMENTED'
), 'AI activity and cost are not invented');
select ok(exists (
  select 1 from public.founder_source_freshness
  where source_code = 'SYSTEM_MONITORING' and source_status = 'NOT_IMPLEMENTED'
), 'System monitoring is not invented');

select * from finish();
rollback;
