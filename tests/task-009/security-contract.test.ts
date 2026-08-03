import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260718074118_task009_support_exception_management_vertical_slice.sql';

test('Support commands are same-origin, bounded, strict and service-secret-only', async () => {
  const [migration, customerRoute, staffRoute, command] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile('src/app/api/v1/customer/support/route.ts', 'utf8'),
    readFile('src/app/api/v1/staff/support/route.ts', 'utf8'),
    readFile('src/server/support/command.ts', 'utf8')
  ]);
  for (const route of [customerRoute, staffRoute]) {
    assert.match(route, /isSameOrigin\(request\)/);
    assert.match(route, /Idempotency-Key/i);
    assert.match(route, /Content-Type/i);
    assert.match(route, /Cache-Control.*no-store/s);
  }
  assert.match(customerRoute, /maximumBodyBytes\s*=\s*32_768/);
  assert.match(staffRoute, /maximumBodyBytes\s*=\s*65_536/);
  assert.match(staffRoute, /AAL2_REQUIRED/);
  assert.match(command, /createAdminSupabaseClient/);
  assert.match(command, /execute_support_command/);
  assert.match(command, /p_payload_hash:\s*sha256\(input\)/);
  assert.doesNotMatch(command, /NEXT_PUBLIC_.*SECRET|publishableKey/);
  assert.match(migration, /revoke all on function public\.execute_support_command[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.execute_support_command[\s\S]*to service_role/i);
});

test('Support records are exact-Voucher-bound, immutable, RLS-isolated and visibility-separated', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  for (const table of ['support_cases', 'support_case_events', 'support_command_receipts']) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\b`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }
  assert.match(migration, /references public\.voucher_versions[\s\S]*booking_id, voucher_id, version_number, voucher_hash/i);
  assert.match(migration, /support_case_events_immutable/i);
  assert.match(migration, /support_cases_guarded/i);
  assert.match(migration, /create unique index support_cases_one_active_booking_idx/i);
  assert.match(migration, /visibility = 'CUSTOMER'/i);
  assert.match(migration, /event_type in \('CASE_CLAIMED', 'PRIORITY_CHANGED', 'CASE_ESCALATED', 'INTERNAL_NOTE'\)[\s\S]*visibility = 'INTERNAL'/i);
  assert.match(migration, /customer_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /\(select auth\.jwt\(\)->>'aal'\) = 'aal2'/i);
  assert.match(migration, /grant select \([\s\S]*occurred_at[\s\S]*\) on table public\.support_case_events to authenticated/i);
  assert.doesNotMatch(migration.match(/grant select \([\s\S]*?\) on table public\.support_case_events to authenticated/i)?.[0] ?? '', /event_hash|actor_session_id/i);
});

test('Support authority cannot mutate Booking, Payment, Voucher, Refund or compensation state', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const functionBody = migration.match(/create or replace function public\.execute_support_command[\s\S]*?\$\$;/i)?.[0] ?? '';
  assert.match(functionBody, /financialAuthorityUnaffected/i);
  assert.doesNotMatch(functionBody, /update public\.(bookings|vouchers|payment_requests|funds_allocations)/i);
  assert.doesNotMatch(functionBody, /insert into public\.(refund|payment_verifications|voucher_issuance_events)/i);
  assert.doesNotMatch(migration, /amadeus|sabre|travelport|kubernetes|public bucket|whatsapp api/i);
});

test('Customer and staff Support interfaces preserve visibility and accessibility boundaries', async () => {
  const [customer, staff, queries] = await Promise.all([
    readFile('src/components/customer-support-panel.tsx', 'utf8'),
    readFile('src/components/support-operations-queue.tsx', 'utf8'),
    readFile('src/server/support/queries.ts', 'utf8')
  ]);
  assert.match(customer, /aria-live="polite"/);
  assert.match(customer, /declarationConfirmed/);
  assert.doesNotMatch(customer, /eventHash|actorId|INTERNAL_NOTE/);
  assert.match(staff, /internal-support-form/);
  assert.match(staff, /financialAuthorityUnaffectedConfirmed/);
  assert.match(staff, /aria-live="polite"/);
  assert.match(queries, /\.eq\('visibility', 'CUSTOMER'\)/);
  assert.match(queries, /viewer\.assuranceLevel !== 'aal2'/);
  assert.match(queries, /createAdminSupabaseClient/);
});

test('AZ, RU and EN catalogues have complete Task 009 key parity', async () => {
  const catalogues = await Promise.all(['az', 'ru', 'en'].map(async (locale) =>
    JSON.parse(await readFile(`src/i18n/messages/${locale}.json`, 'utf8')) as Record<string, unknown>
  ));
  const keyShape = (value: unknown): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      key,
      ...keyShape(child).map((nested) => `${key}.${nested}`)
    ]).sort();
  };
  assert.deepEqual(keyShape(catalogues[0]), keyShape(catalogues[1]));
  assert.deepEqual(keyShape(catalogues[0]), keyShape(catalogues[2]));
  for (const catalogue of catalogues) {
    const serialized = JSON.stringify(catalogue);
    assert.match(serialized, /supportCustomer/);
    assert.match(serialized, /supportStaff/);
    assert.match(serialized, /CASE_RESOLVED/);
  }
});
