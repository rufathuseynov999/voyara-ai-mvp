import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260717175117_task008_booking_verification_voucher_vertical_slice.sql';

test('Fulfilment commands are same-origin, AAL2, Role-constrained and service-only', async () => {
  const [migration, route, command] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile('src/app/api/v1/staff/fulfilment/route.ts', 'utf8'),
    readFile('src/server/fulfilment/command.ts', 'utf8')
  ]);
  assert.match(route, /isSameOrigin\(request\)/);
  assert.match(route, /Idempotency-Key/i);
  assert.match(route, /maximumBodyBytes\s*=\s*65_536/);
  assert.match(route, /AAL2_REQUIRED/);
  assert.match(route, /staff.*manager.*admin.*founder/s);
  assert.match(command, /createAdminSupabaseClient/);
  assert.match(command, /execute_fulfilment_command/);
  assert.match(command, /p_payload_hash:\s*sha256\(input\)/);
  assert.doesNotMatch(command, /NEXT_PUBLIC_.*SECRET|publishableKey/);
  assert.match(migration, /revoke all on function public\.execute_fulfilment_command[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.execute_fulfilment_command[\s\S]*to service_role/i);
  assert.match(migration, /role in \('manager', 'admin', 'founder'\)/);
  assert.match(migration, /INDEPENDENT_VERIFIER_REQUIRED/);
});

test('Verification, correction, Voucher versions and issue evidence are immutable and exact-hash-bound', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  for (const table of [
    'booking_verification_reviews',
    'booking_verification_decisions',
    'vouchers',
    'voucher_versions',
    'voucher_issuance_events',
    'fulfilment_work_receipts',
    'fulfilment_command_receipts'
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\b`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(migration, new RegExp(`(?:revoke|grant)[\\s\\S]*table public\\.${table}`, 'i'));
  }
  for (const trigger of [
    'booking_verification_reviews_immutable',
    'booking_verification_decisions_immutable',
    'voucher_versions_immutable',
    'voucher_issuance_events_immutable',
    'fulfilment_work_receipts_immutable',
    'vouchers_guarded'
  ]) assert.match(migration, new RegExp(`create trigger ${trigger}`, 'i'));

  assert.match(migration, /Supplier Confirmation remains evidence, not Verification/i);
  assert.match(migration, /supplier-confirmation-correction-v1/);
  assert.match(migration, /supersedes_confirmation_id/);
  assert.match(migration, /rejection_verification_id/);
  assert.match(migration, /VERIFICATION_REJECTED/);
  assert.match(migration, /VOUCHER_DRAFTED/);
  assert.match(migration, /VOUCHER_ISSUED/);
  assert.doesNotMatch(migration, /amadeus|sabre|travelport|kubernetes|public bucket/i);
});

test('Customer Voucher delivery is owner-isolated and only the exact issued version is readable', async () => {
  const [migration, queries, customer, staff] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile('src/server/booking/queries.ts', 'utf8'),
    readFile('src/components/customer-trip-room.tsx', 'utf8'),
    readFile('src/components/booking-operations-queue.tsx', 'utf8')
  ]);
  assert.match(migration, /customer_id = \(select auth\.uid\(\)\) and status = 'ISSUED'/i);
  assert.match(migration, /issued_version = voucher_versions\.version_number/i);
  assert.match(migration, /issued_hash = voucher_versions\.voucher_hash/i);
  assert.match(queries, /\.eq\('customer_id', viewer\.id\)/);
  assert.match(queries, /voucherCanonicalPayloadSchema\.safeParse/);
  assert.match(queries, /sha256\(payload\.data\)/);
  assert.match(customer, /className="customer-voucher"/);
  assert.match(customer, /aria-labelledby/);
  assert.match(customer, /privateDelivery/);
  assert.match(staff, /booking\.verification\.start/);
  assert.match(staff, /booking\.verify/);
  assert.match(staff, /supplier_confirmation\.correct/);
  assert.match(staff, /voucher\.draft\.create/);
  assert.match(staff, /voucher\.issue/);
  assert.match(staff, /aria-live="polite"/);
});

test('AZ, RU and EN catalogues have complete Task 008 key parity and no mixed-state fallback', async () => {
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
    assert.match(serialized, /VOUCHER_ISSUED/);
    assert.match(serialized, /privateDelivery/);
    assert.match(serialized, /independentVerifierRequired/);
  }
});
