begin;

select plan(37);

select has_table('public', 'commercial_approval_policy_versions', 'versioned approval policy exists');
select has_table('public', 'commercial_approval_policy_state', 'active approval policy pointer exists');
select has_table('public', 'commercial_quotations', 'commercial quotation aggregate exists');
select has_table('public', 'quotation_versions', 'immutable quotation versions exist');
select has_table('public', 'commercial_approval_decisions', 'exact human decisions exist');
select has_table('public', 'published_proposals', 'immutable Customer publication exists');
select has_table('public', 'customer_quotation_acceptances', 'exact Customer Acceptance exists');
select has_table('public', 'commercial_work_receipts', 'commercial Work Receipts exist');
select has_table('public', 'commercial_command_receipts', 'commercial idempotency receipts exist');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.commercial_approval_policy_versions'::regclass), 'policy versions have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.commercial_approval_policy_state'::regclass), 'policy state has forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.commercial_quotations'::regclass), 'quotation aggregates have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.quotation_versions'::regclass), 'quotation versions have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.commercial_approval_decisions'::regclass), 'approval decisions have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.published_proposals'::regclass), 'published proposals have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.customer_quotation_acceptances'::regclass), 'Customer Acceptances have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.commercial_work_receipts'::regclass), 'Work Receipts have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.commercial_command_receipts'::regclass), 'command receipts have forced RLS');

select policies_are('public', 'commercial_approval_policy_versions', array['commercial_policy_versions_select_aal2_staff'], 'policy versions are AAL2 staff-readable only');
select policies_are('public', 'commercial_approval_policy_state', array['commercial_policy_state_select_aal2_staff'], 'policy state is AAL2 staff-readable only');
select policies_are('public', 'commercial_quotations', array['commercial_quotations_select_aal2_staff'], 'quotation aggregate remains internal to AAL2 staff');
select policies_are('public', 'quotation_versions', array['quotation_versions_select_aal2_staff'], 'full quotation content remains internal');
select policies_are('public', 'commercial_approval_decisions', array['commercial_approval_decisions_select_aal2_staff'], 'commercial decisions remain internal');
select policies_are('public', 'published_proposals', array['published_proposals_select_customer_or_aal2_staff'], 'published safe snapshots are owner-readable');
select policies_are('public', 'customer_quotation_acceptances', array['customer_quotation_acceptances_select_customer_or_aal2_staff'], 'Acceptance evidence is owner-readable');
select policies_are('public', 'commercial_work_receipts', array['commercial_work_receipts_select_customer_or_aal2_staff'], 'Work Receipts are owner-readable');
select policies_are('public', 'commercial_command_receipts', array[]::text[], 'commercial command receipts expose no client policy');

select function_privs_are(
  'public', 'execute_commercial_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'authenticated', array[]::text[],
  'authenticated clients cannot execute commercial authority commands'
);
select function_privs_are(
  'public', 'execute_commercial_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'service_role', array['EXECUTE'],
  'only the server service role can execute commercial commands'
);

select trigger_is('public', 'commercial_approval_policy_versions', 'commercial_approval_policy_versions_immutable', 'private', 'reject_commercial_evidence_mutation', 'policy versions are immutable');
select trigger_is('public', 'quotation_versions', 'quotation_versions_immutable', 'private', 'reject_commercial_evidence_mutation', 'quotation versions are immutable');
select trigger_is('public', 'commercial_approval_decisions', 'commercial_approval_decisions_immutable', 'private', 'reject_commercial_evidence_mutation', 'decisions are immutable');
select trigger_is('public', 'published_proposals', 'published_proposals_immutable', 'private', 'reject_commercial_evidence_mutation', 'published proposals are immutable');
select trigger_is('public', 'customer_quotation_acceptances', 'customer_quotation_acceptances_immutable', 'private', 'reject_commercial_evidence_mutation', 'Customer Acceptance is immutable');
select trigger_is('public', 'commercial_work_receipts', 'commercial_work_receipts_immutable', 'private', 'reject_commercial_evidence_mutation', 'Work Receipts are immutable');

select is((select count(*) from public.commercial_approval_policy_state), 1::bigint, 'one active policy pointer is seeded');
select is((select mode from public.commercial_approval_policy_versions where id = (select active_policy_version_id from public.commercial_approval_policy_state)), 'FOUNDER_ONLY', 'launch policy is Founder-only');

select * from finish();
rollback;
