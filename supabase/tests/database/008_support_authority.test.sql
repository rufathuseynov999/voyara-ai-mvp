begin;

select plan(23);

select has_table('public', 'support_cases', 'Support case aggregate exists');
select has_table('public', 'support_case_events', 'immutable Support event chain exists');
select has_table('public', 'support_command_receipts', 'Support idempotency receipts exist');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.support_cases'::regclass), 'Support cases have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.support_case_events'::regclass), 'Support events have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.support_command_receipts'::regclass), 'Support receipts have forced RLS');

select policies_are(
  'public', 'support_cases',
  array['support_cases_select_owner_or_aal2_operations'],
  'Support cases are readable only by the Customer owner or AAL2 operations'
);
select policies_are(
  'public', 'support_case_events',
  array['support_case_events_select_customer_safe_owner_or_aal2_operations'],
  'Customers see only Customer-safe events while AAL2 operations sees the complete chain'
);
select policies_are(
  'public', 'support_command_receipts', array[]::text[],
  'Support command receipts expose no client policy'
);

select function_privs_are(
  'public', 'execute_support_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'authenticated', array[]::text[],
  'authenticated clients cannot execute Support authority commands directly'
);
select function_privs_are(
  'public', 'execute_support_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'service_role', array['EXECUTE'],
  'only the server service role can execute Support commands'
);

select trigger_is(
  'public', 'support_case_events', 'support_case_events_immutable',
  'private', 'reject_support_evidence_mutation',
  'Support event evidence is immutable'
);
select trigger_is(
  'public', 'support_command_receipts', 'support_command_receipts_immutable',
  'private', 'reject_support_evidence_mutation',
  'Support command receipts are immutable'
);
select trigger_is(
  'public', 'support_cases', 'support_cases_guarded',
  'private', 'guard_support_case_update',
  'Support case transitions require the next immutable event'
);

select has_column('public', 'support_cases', 'voucher_id', 'Support case retains exact Voucher identifier');
select has_column('public', 'support_cases', 'voucher_version', 'Support case retains exact Voucher version');
select has_column('public', 'support_cases', 'voucher_hash', 'Support case retains exact Voucher SHA-256');
select has_column('public', 'support_cases', 'owner_id', 'Support case retains accountable human owner');
select has_column('public', 'support_cases', 'case_authority_hash', 'Support case retains canonical authority hash');
select has_column('public', 'support_case_events', 'previous_event_hash', 'Support events retain the previous event hash');
select has_column('public', 'support_case_events', 'visibility', 'Support events separate Customer and internal visibility');
select has_column('public', 'support_case_events', 'event_hash', 'Support events retain their own SHA-256');
select has_column('public', 'support_command_receipts', 'payload_hash', 'Support receipts bind the exact command payload');

select * from finish();
rollback;
