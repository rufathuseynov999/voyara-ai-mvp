begin;

select plan(34);

select has_table('public', 'booking_verification_reviews', 'Booking Verification reviews exist');
select has_table('public', 'booking_verification_decisions', 'human Booking Verification decisions exist');
select has_table('public', 'vouchers', 'Voucher aggregate exists');
select has_table('public', 'voucher_versions', 'immutable Voucher versions exist');
select has_table('public', 'voucher_issuance_events', 'human Voucher issuance evidence exists');
select has_table('public', 'fulfilment_work_receipts', 'Fulfilment Work Receipts exist');
select has_table('public', 'fulfilment_command_receipts', 'Fulfilment idempotency receipts exist');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.booking_verification_reviews'::regclass), 'Booking Verification reviews have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.booking_verification_decisions'::regclass), 'Booking Verification decisions have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.vouchers'::regclass), 'Vouchers have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.voucher_versions'::regclass), 'Voucher versions have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.voucher_issuance_events'::regclass), 'Voucher issuance events have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.fulfilment_work_receipts'::regclass), 'Fulfilment Work Receipts have forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.fulfilment_command_receipts'::regclass), 'Fulfilment command receipts have forced RLS');

select policies_are('public', 'booking_verification_reviews', array['booking_verification_reviews_select_aal2_operations'], 'Booking Verification reviews are AAL2-operations-only');
select policies_are('public', 'booking_verification_decisions', array['booking_verification_decisions_select_aal2_operations'], 'Booking Verification decisions are AAL2-operations-only');
select policies_are('public', 'vouchers', array['vouchers_select_issued_owner_or_aal2_operations'], 'only issued Vouchers are Customer-owner-readable');
select policies_are('public', 'voucher_versions', array['voucher_versions_select_issued_owner_or_aal2_operations'], 'only the exact issued Voucher version is Customer-owner-readable');
select policies_are('public', 'voucher_issuance_events', array['voucher_issuance_events_select_aal2_operations'], 'Voucher issuance evidence is AAL2-operations-only');
select policies_are('public', 'fulfilment_work_receipts', array['fulfilment_work_receipts_select_aal2_operations'], 'Fulfilment Work Receipts are AAL2-operations-only');
select policies_are('public', 'fulfilment_command_receipts', array[]::text[], 'Fulfilment command receipts expose no client policy');

select function_privs_are(
  'public', 'execute_fulfilment_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'authenticated', array[]::text[],
  'authenticated clients cannot execute Fulfilment authority commands'
);
select function_privs_are(
  'public', 'execute_fulfilment_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'service_role', array['EXECUTE'],
  'only the server service role can execute Fulfilment commands'
);

select trigger_is('public', 'booking_verification_reviews', 'booking_verification_reviews_immutable', 'private', 'reject_booking_evidence_mutation', 'Booking Verification reviews are immutable');
select trigger_is('public', 'booking_verification_decisions', 'booking_verification_decisions_immutable', 'private', 'reject_booking_evidence_mutation', 'Booking Verification decisions are immutable');
select trigger_is('public', 'voucher_versions', 'voucher_versions_immutable', 'private', 'reject_booking_evidence_mutation', 'Voucher versions are immutable');
select trigger_is('public', 'voucher_issuance_events', 'voucher_issuance_events_immutable', 'private', 'reject_booking_evidence_mutation', 'Voucher issuance events are immutable');
select trigger_is('public', 'fulfilment_work_receipts', 'fulfilment_work_receipts_immutable', 'private', 'reject_booking_evidence_mutation', 'Fulfilment Work Receipts are immutable');
select trigger_is('public', 'vouchers', 'vouchers_guarded', 'private', 'guard_voucher_update', 'Voucher transitions are guarded');

select has_column('public', 'supplier_confirmations', 'confirmation_version', 'Supplier Confirmation correction evidence is versioned');
select has_column('public', 'supplier_confirmations', 'supersedes_confirmation_id', 'correction evidence retains the superseded Confirmation');
select has_column('public', 'bookings', 'current_verification_hash', 'Booking retains the exact Verification hash');
select has_column('public', 'bookings', 'voucher_hash', 'Booking retains the exact Voucher hash');
select has_column('public', 'vouchers', 'issued_hash', 'Voucher aggregate retains the exact issued hash');

select * from finish();
rollback;
