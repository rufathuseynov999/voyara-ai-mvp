begin;

select plan(23);

select has_table('public', 'travel_requests', 'Travel Request lifecycle table exists');
select has_table('public', 'travel_request_versions', 'version evidence table exists');
select has_table('public', 'travel_request_submissions', 'submission evidence table exists');
select has_table('public', 'travel_request_lifecycle_events', 'lifecycle history exists');
select has_table('public', 'travel_request_command_receipts', 'idempotency receipts exist');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.travel_requests'::regclass),
  'Travel Requests have forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.travel_request_versions'::regclass),
  'Travel Request versions have forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.travel_request_submissions'::regclass),
  'Travel Request submissions have forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.travel_request_lifecycle_events'::regclass),
  'Travel Request lifecycle events have forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.travel_request_command_receipts'::regclass),
  'Travel Request command receipts have forced RLS'
);

select policies_are(
  'public', 'travel_requests', array['travel_requests_select_owner_or_aal2_staff'],
  'Travel Requests expose one owner-or-AAL2-staff read policy'
);
select policies_are(
  'public', 'travel_request_versions', array['travel_request_versions_select_owner_or_aal2_staff'],
  'versions expose one owner-or-AAL2-staff read policy'
);
select policies_are(
  'public', 'travel_request_submissions', array['travel_request_submissions_select_owner_or_aal2_staff'],
  'submissions expose one owner-or-AAL2-staff read policy'
);
select policies_are(
  'public', 'travel_request_lifecycle_events', array['travel_request_lifecycle_select_owner_or_aal2_staff'],
  'lifecycle events expose one owner-or-AAL2-staff read policy'
);
select policies_are(
  'public', 'travel_request_command_receipts', array[]::text[],
  'command receipts have no client policy'
);

select function_privs_are(
  'public', 'execute_travel_request_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'authenticated', array[]::text[],
  'authenticated clients cannot execute Travel Request authority commands'
);
select function_privs_are(
  'public', 'execute_travel_request_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'service_role', array['EXECUTE'],
  'only the server service role can execute Travel Request commands'
);

select trigger_is(
  'public', 'travel_request_versions', 'travel_request_versions_immutable',
  'private', 'reject_travel_request_evidence_mutation',
  'version evidence has an immutable trigger'
);
select trigger_is(
  'public', 'travel_request_submissions', 'travel_request_submissions_immutable',
  'private', 'reject_travel_request_evidence_mutation',
  'submission evidence has an immutable trigger'
);
select trigger_is(
  'public', 'travel_request_lifecycle_events', 'travel_request_lifecycle_events_immutable',
  'private', 'reject_travel_request_evidence_mutation',
  'lifecycle evidence has an immutable trigger'
);

select col_is_fk('public', 'travel_requests', 'customer_id', 'Travel Request owner references Auth user');
select col_is_fk('public', 'travel_request_versions', 'customer_id', 'version owner references Auth user');
select col_is_fk('public', 'travel_request_submissions', 'customer_id', 'submission owner references Auth user');

select * from finish();
rollback;
