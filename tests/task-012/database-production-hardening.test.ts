import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

async function setupDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  `);
  for (const migration of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
  }
  return database;
}

test('PostgreSQL final hardening denies implicit browser authority and retains explicit public catalogue access', async () => {
  const database = await setupDatabase();
  try {
    const schemas = await database.query<{
      anon_create: boolean;
      authenticated_create: boolean;
      anon_private_usage: boolean;
    }>(`select
      has_schema_privilege('anon', 'public', 'CREATE') as anon_create,
      has_schema_privilege('authenticated', 'public', 'CREATE') as authenticated_create,
      has_schema_privilege('anon', 'private', 'USAGE') as anon_private_usage`);
    assert.deepEqual(schemas.rows[0], {
      anon_create: false,
      authenticated_create: false,
      anon_private_usage: false
    });

    const browserFunctions = await database.query<{ count: number }>(`
      select count(*)::int as count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (
          has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        )
    `);
    assert.equal(browserFunctions.rows[0].count, 0);

    const tablesWithoutForcedRls = await database.query<{ count: number }>(`
      select count(*)::int as count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private')
        and c.relkind in ('r', 'p')
        and (not c.relrowsecurity or not c.relforcerowsecurity)
    `);
    assert.equal(tablesWithoutForcedRls.rows[0].count, 0);

    const unsafeViews = await database.query<{ count: number }>(`
      select count(*)::int as count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'v'
        and not coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
    `);
    assert.equal(unsafeViews.rows[0].count, 0);

    await database.exec('set role anon');
    const catalogue = await database.query<{ count: number }>(
      'select count(*)::int as count from public.membership_plan_catalogue'
    );
    assert.equal(catalogue.rows[0].count, 8);
    await assert.rejects(database.exec('create table public.unauthorized_object (id int)'), /permission denied/i);
    await database.exec('reset role');

    const definerFunctions = await database.query<{ schema_name: string; function_name: string; browser_execute: boolean }>(`
      select n.nspname as schema_name, p.proname as function_name,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as browser_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
    `);
    assert.deepEqual(definerFunctions.rows, [{
      schema_name: 'private',
      function_name: 'handle_new_auth_user',
      browser_execute: false
    }]);
  } finally {
    await database.close();
  }
});
