begin;

select plan(19);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'role_assignments', 'role assignments exist');
select has_table('private', 'command_idempotency', 'private idempotency store exists');
select has_table('private', 'audit_events', 'private audit event store exists');
select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.role_assignments'::regclass),
  'role assignments has forced RLS'
);

select policies_are(
  'public',
  'profiles',
  array['profiles_select_own', 'profiles_update_own'],
  'profiles exposes only the expected policies'
);
select policies_are(
  'public',
  'role_assignments',
  array['role_assignments_select_own'],
  'role assignments exposes only a subject read policy'
);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'rls-one@voyara.example'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'rls-two@voyara.example');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select results_eq(
  'select count(*) from public.profiles',
  array[1::bigint],
  'an authenticated user sees only their profile'
);
select results_eq(
  'select count(*) from public.role_assignments',
  array[1::bigint],
  'an authenticated user sees only their Role assignment'
);
select results_eq(
  $$update public.profiles set display_name = 'Synthetic One' where id = '10000000-0000-4000-8000-000000000001' returning display_name$$,
  array['Synthetic One'::text],
  'a user can update their own permitted profile field'
);
select results_eq(
  $$update public.profiles set display_name = 'Forbidden' where id = '10000000-0000-4000-8000-000000000002' returning display_name$$,
  array[]::text[],
  'a user cannot update another profile'
);
select throws_ok(
  $$insert into public.role_assignments (user_id, role) values ('10000000-0000-4000-8000-000000000001', 'founder')$$,
  '42501',
  null,
  'an authenticated user cannot assign a Role'
);

reset role;
set local role anon;
select throws_ok(
  'select * from public.profiles',
  '42501',
  null,
  'anonymous users cannot read profiles'
);
select throws_ok(
  'select * from public.role_assignments',
  '42501',
  null,
  'anonymous users cannot read Role assignments'
);
select throws_ok(
  'select * from private.audit_events',
  '42501',
  null,
  'anonymous users cannot reach the private audit schema'
);

reset role;
select is(
  (select count(*) from public.profiles where id in (
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid
  )),
  2::bigint,
  'the auth trigger created both profiles'
);
select is(
  (select count(*) from public.role_assignments where role = 'customer' and user_id in (
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid
  )),
  2::bigint,
  'the auth trigger assigned least-privilege Customer Roles'
);

select * from finish();
rollback;
