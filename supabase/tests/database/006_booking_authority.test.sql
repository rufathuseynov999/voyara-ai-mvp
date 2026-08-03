begin;

select plan(25);

select has_table('public', 'bookings', 'Booking aggregate exists');
select has_table('public', 'supplier_booking_executions', 'human Supplier execution evidence exists');
select has_table('public', 'supplier_confirmations', 'Supplier Confirmation evidence exists');
select has_table('public', 'booking_work_receipts', 'Booking Work Receipts exist');
select has_table('public', 'booking_command_receipts', 'Booking idempotency receipts exist');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.bookings'::regclass), 'Bookings have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.supplier_booking_executions'::regclass), 'Supplier executions have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.supplier_confirmations'::regclass), 'Supplier Confirmations have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.booking_work_receipts'::regclass), 'Booking Work Receipts have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.booking_command_receipts'::regclass), 'Booking command receipts have forced RLS');

select policies_are('public', 'bookings', array['bookings_select_customer_or_aal2_operations'], 'Customer-safe Bookings are owner-readable');
select policies_are('public', 'supplier_booking_executions', array['supplier_executions_select_aal2_operations'], 'Supplier execution evidence is operations-only');
select policies_are('public', 'supplier_confirmations', array['supplier_confirmations_select_aal2_operations'], 'Supplier Confirmation evidence is operations-only');
select policies_are('public', 'booking_work_receipts', array['booking_work_receipts_select_customer_or_aal2_operations'], 'safe Booking Work Receipts are owner-readable');
select policies_are('public', 'booking_command_receipts', array[]::text[], 'Booking command receipts expose no client policy');

select function_privs_are(
  'public', 'execute_booking_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'authenticated', array[]::text[],
  'authenticated clients cannot execute Booking authority commands'
);
select function_privs_are(
  'public', 'execute_booking_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'service_role', array['EXECUTE'],
  'only the server service role can execute Booking commands'
);

select trigger_is('public', 'bookings', 'bookings_guarded', 'private', 'guard_booking_update', 'Booking transitions are guarded');
select trigger_is('public', 'supplier_booking_executions', 'supplier_booking_executions_immutable', 'private', 'reject_booking_evidence_mutation', 'Supplier executions are immutable');
select trigger_is('public', 'supplier_confirmations', 'supplier_confirmations_immutable', 'private', 'reject_booking_evidence_mutation', 'Supplier Confirmations are immutable');
select trigger_is('public', 'booking_work_receipts', 'booking_work_receipts_immutable', 'private', 'reject_booking_evidence_mutation', 'Booking Work Receipts are immutable');

select has_column('public', 'bookings', 'readiness_evaluation_hash', 'Booking retains exact financial-readiness hash');
select has_column('public', 'bookings', 'quotation_hash', 'Booking retains exact accepted quotation hash');
select has_column('public', 'supplier_booking_executions', 'execution_hash', 'Supplier execution retains an exact hash');
select has_column('public', 'supplier_confirmations', 'confirmation_hash', 'Supplier Confirmation retains an exact hash');

select * from finish();
rollback;
