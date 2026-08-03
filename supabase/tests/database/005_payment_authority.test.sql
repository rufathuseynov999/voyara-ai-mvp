begin;

select plan(36);

select has_table('public', 'payment_requests', 'Payment request aggregate exists');
select has_table('public', 'payment_evidence_versions', 'unverified Payment evidence versions exist');
select has_table('public', 'payment_review_events', 'human Finance review evidence exists');
select has_table('public', 'payment_verification_decisions', 'human Payment Verification decisions exist');
select has_table('public', 'fund_allocations', 'fund allocation evidence exists');
select has_table('public', 'financial_readiness_evaluations', 'financial readiness evidence exists');
select has_table('public', 'financial_work_receipts', 'financial Work Receipts exist');
select has_table('public', 'financial_command_receipts', 'financial idempotency receipts exist');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payment_requests'::regclass), 'Payment requests have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payment_evidence_versions'::regclass), 'Payment evidence has forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payment_review_events'::regclass), 'Payment reviews have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payment_verification_decisions'::regclass), 'Payment Verification has forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.fund_allocations'::regclass), 'fund allocations have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.financial_readiness_evaluations'::regclass), 'readiness evaluations have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.financial_work_receipts'::regclass), 'financial Work Receipts have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.financial_command_receipts'::regclass), 'financial command receipts have forced RLS');

select policies_are('public', 'payment_requests', array['payment_requests_select_customer_or_aal2_staff'], 'Customer-safe Payment requests are owner-readable');
select policies_are('public', 'payment_evidence_versions', array['payment_evidence_select_aal2_finance'], 'full Payment evidence remains internal');
select policies_are('public', 'payment_review_events', array['payment_reviews_select_aal2_finance'], 'review evidence remains internal');
select policies_are('public', 'payment_verification_decisions', array['payment_verifications_select_aal2_finance'], 'Verification decisions remain internal');
select policies_are('public', 'fund_allocations', array['fund_allocations_select_aal2_finance'], 'allocation evidence remains internal');
select policies_are('public', 'financial_readiness_evaluations', array['financial_readiness_select_aal2_finance'], 'readiness evidence remains internal');
select policies_are('public', 'financial_work_receipts', array['financial_work_receipts_select_customer_or_aal2_finance'], 'safe Work Receipts are owner-readable');
select policies_are('public', 'financial_command_receipts', array[]::text[], 'financial command receipts expose no client policy');

select function_privs_are(
  'public', 'execute_payment_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'authenticated', array[]::text[],
  'authenticated clients cannot execute financial authority commands'
);
select function_privs_are(
  'public', 'execute_payment_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'service_role', array['EXECUTE'],
  'only the server service role can execute financial commands'
);

select trigger_is('public', 'payment_evidence_versions', 'payment_evidence_versions_immutable', 'private', 'reject_financial_evidence_mutation', 'Payment evidence is immutable');
select trigger_is('public', 'payment_review_events', 'payment_review_events_immutable', 'private', 'Payment reviews are immutable');
select trigger_is('public', 'payment_verification_decisions', 'payment_verification_decisions_immutable', 'private', 'Verification decisions are immutable');
select trigger_is('public', 'fund_allocations', 'fund_allocations_immutable', 'private', 'fund allocations are immutable');
select trigger_is('public', 'financial_readiness_evaluations', 'financial_readiness_evaluations_immutable', 'private', 'readiness evaluations are immutable');
select trigger_is('public', 'financial_work_receipts', 'financial_work_receipts_immutable', 'private', 'financial Work Receipts are immutable');

select has_column('public', 'payment_requests', 'quotation_hash', 'Payment requests retain the exact accepted quotation hash');
select has_column('public', 'payment_evidence_versions', 'evidence_hash', 'evidence versions retain an exact hash');
select has_column('public', 'payment_verification_decisions', 'verification_hash', 'Verification decisions retain an exact hash');
select has_column('public', 'fund_allocations', 'allocation_hash', 'fund allocations retain an exact hash');

select * from finish();
rollback;
