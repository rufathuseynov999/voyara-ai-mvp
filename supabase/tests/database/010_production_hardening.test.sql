begin;

select plan(11);

select ok(not has_schema_privilege('anon', 'public', 'CREATE'), 'anonymous role cannot create public objects');
select ok(not has_schema_privilege('authenticated', 'public', 'CREATE'), 'authenticated role cannot create public objects');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anonymous role cannot use private authority schema');

select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
    )
), 0, 'public functions have no implicit browser execute authority');

select is((
  select count(*)::integer
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')
    and c.relkind in ('r', 'p')
    and (not c.relrowsecurity or not c.relforcerowsecurity)
), 0, 'every VOYARA table has enabled and forced RLS');

select is((
  select count(*)::integer
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and not coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
), 0, 'every exposed view invokes caller security');

select ok(has_table_privilege('anon', 'public.membership_plan_catalogue', 'SELECT'), 'public Membership prices remain readable');

select is((
  select count(*)::integer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'execute\_%\_command' escape '\'
    and has_function_privilege('service_role', p.oid, 'EXECUTE')
), 8, 'service role retains all eight server command gateways');

select ok(exists (
  select 1
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public' and d.defaclobjtype = 'f'
), 'public function default ACL is explicitly recorded');

select ok(not exists (
  select 1
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where n.nspname = 'public'
    and d.defaclobjtype = 'f'
    and a.grantee = 0
    and a.privilege_type = 'EXECUTE'
), 'future public functions do not grant execute to PUBLIC');

select ok(not exists (
  select 1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and (
      n.nspname <> 'private'
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('anon', p.oid, 'EXECUTE')
    )
), 'security-definer code remains private and unavailable to browser roles');

select * from finish();
rollback;
