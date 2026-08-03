begin;

select plan(24);

select has_table('public', 'user_session_security', 'user session cutoffs exist');
select has_table('public', 'session_revocations', 'individual session revocations exist');
select has_table('public', 'staff_invitations', 'staff invitations exist');
select has_table('public', 'command_receipts', 'durable command receipts exist');
select has_table('public', 'authority_audit_events', 'authority audit events exist');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.user_session_security'::regclass),
  'user session security has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.session_revocations'::regclass),
  'session revocations has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.staff_invitations'::regclass),
  'staff invitations has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.command_receipts'::regclass),
  'command receipts has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.authority_audit_events'::regclass),
  'authority events has forced RLS'
);

select policies_are(
  'public',
  'user_session_security',
  array['user_session_security_select_own'],
  'session cutoff rows expose only own-read policy'
);
select policies_are(
  'public',
  'session_revocations',
  array['session_revocations_select_own'],
  'session revocation rows expose only own-read policy'
);
select policies_are('public', 'staff_invitations', array[]::text[], 'staff invitations expose no client policy');
select policies_are('public', 'command_receipts', array[]::text[], 'command receipts expose no client policy');
select policies_are('public', 'authority_audit_events', array[]::text[], 'authority events expose no client policy');

select function_privs_are(
  'public',
  'execute_access_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'authenticated',
  array[]::text[],
  'authenticated cannot execute Founder access commands'
);
select function_privs_are(
  'public',
  'execute_access_command',
  array['uuid', 'text', 'text', 'uuid', 'uuid', 'text', 'timestamp with time zone', 'jsonb', 'text'],
  'service_role',
  array['EXECUTE'],
  'only the server service role receives execute authority'
);

insert into auth.users (id, email)
values
  ('50000000-0000-4000-8000-000000000001'::uuid, 'task003-one@voyara.example'),
  ('50000000-0000-4000-8000-000000000002'::uuid, 'task003-two@voyara.example');

set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-4000-8000-000000000001';

select results_eq(
  'select count(*) from public.user_session_security',
  array[1::bigint],
  'Customer sees only their session cutoff row'
);
select results_eq(
  'select count(*) from public.session_revocations',
  array[0::bigint],
  'Customer sees no unrelated revoked session'
);
select throws_ok('select * from public.staff_invitations', '42501', null, 'Customer cannot read staff invitations');
select throws_ok('select * from public.command_receipts', '42501', null, 'Customer cannot read command receipts');
select throws_ok('select * from public.authority_audit_events', '42501', null, 'Customer cannot read authority history');
select throws_ok(
  $$select public.execute_access_command(
    '60000000-0000-4000-8000-000000000001', 'forbidden-command-001', 'role.assign',
    '50000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
    'aal2', now(), '{"userId":"50000000-0000-4000-8000-000000000001","role":"founder"}'::jsonb,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  '42501',
  null,
  'Customer cannot call the service-only access command'
);

reset role;
select is(
  (select count(*) from public.role_assignments where user_id in (
    '50000000-0000-4000-8000-000000000001'::uuid,
    '50000000-0000-4000-8000-000000000002'::uuid
  ) and role = 'customer'),
  2::bigint,
  'ordinary signups receive only Customer authority'
);

select * from finish();
rollback;
