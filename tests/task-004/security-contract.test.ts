import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Task 004 source keeps Travel Request authority server-only and same-origin', async () => {
  const [customerRoute, staffRoute, command, migration] = await Promise.all([
    readFile('src/app/api/v1/travel-requests/route.ts', 'utf8'),
    readFile('src/app/api/v1/staff/travel-requests/route.ts', 'utf8'),
    readFile('src/server/travel-request/command.ts', 'utf8'),
    readFile('supabase/migrations/20260717104504_task004_travel_request_vertical_slice.sql', 'utf8')
  ]);

  assert.match(customerRoute, /isSameOrigin\(request\)/);
  assert.match(customerRoute, /viewer\.roles\.includes\('customer'\)/);
  assert.match(customerRoute, /Idempotency|idempotency-key/i);
  assert.match(customerRoute, /maximumBodyBytes/);
  assert.match(staffRoute, /viewer\.assuranceLevel !== 'aal2'/);
  assert.match(staffRoute, /staffAreaRoles/);
  assert.match(command, /createAdminSupabaseClient/);
  assert.match(command, /sha256\(input\.content\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, />= 30/);
  assert.match(migration, /from authenticated;/);
  assert.match(migration, /to service_role;/);
});

test('Travel Request evidence is immutable, hash-bound and stops before commercial authority', async () => {
  const migration = await readFile('supabase/migrations/20260717104504_task004_travel_request_vertical_slice.sql', 'utf8');
  assert.match(migration, /travel_request_versions_immutable/);
  assert.match(migration, /travel_request_submissions_immutable/);
  assert.match(migration, /travel_request_lifecycle_events_immutable/);
  assert.match(migration, /foreign key \(travel_request_id, version_number, payload_hash\)/);
  assert.match(migration, /'DRAFT', 'SUBMITTED', 'AI_PREPARATION', 'HUMAN_REVIEW'/);
  assert.doesNotMatch(migration, /create table public\.(quotations|payments|bookings|vouchers)/i);
});

test('wizard and queue have responsive, accessible source contracts', async () => {
  const [form, queue, css] = await Promise.all([
    readFile('src/components/travel-request-form.tsx', 'utf8'),
    readFile('src/components/travel-request-queue.tsx', 'utf8'),
    readFile('src/app/globals.css', 'utf8')
  ]);
  assert.match(form, /<fieldset/);
  assert.match(form, /<legend>/);
  assert.match(form, /aria-live="polite"/);
  assert.match(queue, /aria-labelledby=/);
  assert.match(queue, /aria-live="polite"/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.form-grid-two[\s\S]*grid-template-columns: 1fr/);
});
