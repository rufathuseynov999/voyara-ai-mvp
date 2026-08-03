import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260717144340_task007_booking_supplier_confirmation_vertical_slice.sql';

test('Booking authority is service-only, same-origin, AAL2 and operations-Role constrained', async () => {
  const [migration, route, command, queries] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile('src/app/api/v1/staff/bookings/route.ts', 'utf8'),
    readFile('src/server/booking/command.ts', 'utf8'),
    readFile('src/server/booking/queries.ts', 'utf8')
  ]);
  assert.match(route, /isSameOrigin\(request\)/);
  assert.match(route, /Idempotency-Key/i);
  assert.match(route, /AAL2_REQUIRED/);
  assert.match(route, /staff.*manager.*admin.*founder/s);
  assert.match(route, /BOOKING_OPERATIONS_AUTHORITY_REQUIRED/);
  assert.match(command, /createAdminSupabaseClient/);
  assert.match(command, /execute_booking_command/);
  assert.doesNotMatch(command, /NEXT_PUBLIC_.*SECRET|publishableKey/);
  assert.match(queries, /\.eq\('customer_id', viewer\.id\)/);
  assert.match(queries, /\.eq\('status', 'READY_FOR_BOOKING'\)/);
  assert.match(migration, /revoke all on function public\.execute_booking_command[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.execute_booking_command[\s\S]*to service_role/i);
});

test('Booking, Supplier execution and Supplier Confirmation are immutable separate records', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  for (const table of [
    'bookings',
    'supplier_booking_executions',
    'supplier_confirmations',
    'booking_work_receipts',
    'booking_command_receipts'
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\b`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(migration, new RegExp(`(?:revoke|grant)[\\s\\S]*table public\\.${table}`, 'i'));
  }
  for (const trigger of [
    'bookings_guarded',
    'supplier_booking_executions_immutable',
    'supplier_confirmations_immutable',
    'booking_work_receipts_immutable'
  ]) assert.match(migration, new RegExp(`create trigger ${trigger}`, 'i'));

  assert.match(migration, /Supplier Confirmation is evidence only/i);
  assert.match(migration, /READY_FOR_BOOKING/);
  assert.match(migration, /role in \('staff', 'manager', 'admin', 'founder'\)/);
  assert.doesNotMatch(migration, /create table public\.(booking_verifications|vouchers|credit_approvals|refunds)\b/i);
  assert.doesNotMatch(migration, /supplier_confirmation\.capture[\s\S]*booking\.verify/s);
  assert.doesNotMatch(migration, /amadeus|sabre|travelport|webhook_secret|kubernetes/i);
});

test('retained Trip Room and supporting Booking queue are live, localized, accessible and responsive', async () => {
  const [page, customer, staffPage, staff, styles, en, az, ru] = await Promise.all([
    readFile('src/app/[locale]/(customer)/trip-room/page.tsx', 'utf8'),
    readFile('src/components/customer-trip-room.tsx', 'utf8'),
    readFile('src/app/[locale]/staff/bookings/page.tsx', 'utf8'),
    readFile('src/components/booking-operations-queue.tsx', 'utf8'),
    readFile('src/app/globals.css', 'utf8'),
    readFile('src/i18n/messages/en.json', 'utf8'),
    readFile('src/i18n/messages/az.json', 'utf8'),
    readFile('src/i18n/messages/ru.json', 'utf8')
  ]);
  assert.doesNotMatch(page, /ScreenPreview/);
  assert.match(page, /CustomerTripRoom/);
  assert.match(staffPage, /BookingOperationsQueue/);
  assert.match(customer, /aria-labelledby/);
  assert.match(customer, /SUPPLIER_CONFIRMED/);
  assert.match(staff, /aria-live="polite"/);
  assert.match(staff, /declarationConfirmed/);
  assert.match(staff, /booking\.create/);
  assert.match(staff, /supplier_booking\.complete/);
  assert.match(staff, /supplier_confirmation\.capture/);
  assert.match(staff, /booking\.verify/);
  assert.match(staff, /voucher\.issue/);
  assert.match(styles, /\.booking-timeline/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.booking-facts/s);
  for (const catalogue of [en, az, ru]) {
    assert.match(catalogue, /"bookingCustomer"/);
    assert.match(catalogue, /"bookingStaff"/);
    assert.match(catalogue, /"SUPPLIER_CONFIRMED"/);
  }
});
