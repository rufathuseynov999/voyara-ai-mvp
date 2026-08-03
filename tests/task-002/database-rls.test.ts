import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const firstUser = '10000000-0000-4000-8000-000000000001';
const secondUser = '10000000-0000-4000-8000-000000000002';

test('the Task 002 migration enforces profile ownership and read-only Role assignments', async () => {
  const database = new PGlite();
  try {
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
      returns uuid
      language sql
      stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);

    const migration = await readFile('supabase/migrations/20260717084526_task002_foundation_security.sql', 'utf8');
    await database.exec(migration);
    await database.exec(`
      insert into auth.users (id, email) values
        ('${firstUser}', 'one@voyara.example'),
        ('${secondUser}', 'two@voyara.example');
    `);

    await database.exec(`set role authenticated; set request.jwt.claim.sub = '${firstUser}';`);
    const ownProfiles = await database.query<{ id: string }>('select id::text as id from public.profiles order by id');
    assert.deepEqual(ownProfiles.rows.map(({ id }) => id), [firstUser]);
    const ownRoles = await database.query<{ role: string }>('select role from public.role_assignments');
    assert.deepEqual(ownRoles.rows.map(({ role }) => role), ['customer']);

    const ownUpdate = await database.query<{ display_name: string }>(
      `update public.profiles set display_name = 'Synthetic One' where id = '${firstUser}' returning display_name`
    );
    assert.equal(ownUpdate.rows[0]?.display_name, 'Synthetic One');
    const forbiddenUpdate = await database.query(
      `update public.profiles set display_name = 'Forbidden' where id = '${secondUser}' returning id`
    );
    assert.equal(forbiddenUpdate.rows.length, 0);

    await assert.rejects(
      database.exec(`insert into public.role_assignments (user_id, role) values ('${firstUser}', 'founder')`),
      /permission denied|row-level security/i
    );
    await assert.rejects(database.query('select * from private.audit_events'), /permission denied/i);

    await database.exec('reset role; set role anon;');
    await assert.rejects(database.query('select * from public.profiles'), /permission denied/i);
    await assert.rejects(database.query('select * from public.role_assignments'), /permission denied/i);

    await database.exec('reset role;');
    const profileCount = await database.query<{ count: number }>(
      `select count(*)::int as count from public.profiles where id in ('${firstUser}', '${secondUser}')`
    );
    assert.equal(profileCount.rows[0]?.count, 2);
  } finally {
    await database.close();
  }
});
