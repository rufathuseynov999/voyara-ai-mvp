import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260717143000_task006_payment_verification_vertical_slice.sql';

test('financial authority is server-only, same-origin, AAL2 and command-specific', async () => {
  const [migration, customerRoute, staffRoute, command] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile('src/app/api/v1/customer/payments/route.ts', 'utf8'),
    readFile('src/app/api/v1/staff/payments/route.ts', 'utf8'),
    readFile('src/server/payment/command.ts', 'utf8')
  ]);

  assert.match(customerRoute, /isSameOrigin\(request\)/);
  assert.match(customerRoute, /Idempotency-Key/i);
  assert.match(customerRoute, /CUSTOMER_REQUIRED/);
  assert.match(staffRoute, /isSameOrigin\(request\)/);
  assert.match(staffRoute, /AAL2_REQUIRED/);
  assert.match(staffRoute, /finance.*admin.*founder/s);
  assert.match(staffRoute, /funds\.allocate.*payment\.evaluate_readiness/s);
  assert.match(staffRoute, /ALLOCATION_AUTHORITY_REQUIRED/);
  assert.match(command, /createAdminSupabaseClient/);
  assert.match(command, /execute_payment_command/);
  assert.doesNotMatch(command, /NEXT_PUBLIC_.*SECRET|publishableKey/);
  assert.match(migration, /revoke all on function public\.execute_payment_command[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.execute_payment_command[\s\S]*to service_role/i);
});

test('Payment evidence, human Verification, allocation and readiness are immutable separate records', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  for (const table of [
    'payment_requests',
    'payment_evidence_versions',
    'payment_review_events',
    'payment_verification_decisions',
    'fund_allocations',
    'financial_readiness_evaluations',
    'financial_work_receipts',
    'financial_command_receipts'
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\b`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }
  for (const trigger of [
    'payment_evidence_versions_immutable',
    'payment_review_events_immutable',
    'payment_verification_decisions_immutable',
    'fund_allocations_immutable',
    'financial_readiness_evaluations_immutable',
    'financial_work_receipts_immutable'
  ]) assert.match(migration, new RegExp(`create trigger ${trigger}`, 'i'));

  assert.match(migration, /Provider or Customer evidence never equals verified Payment/i);
  assert.match(migration, /role in \('finance', 'admin', 'founder'\)/);
  assert.match(migration, /role in \('finance', 'founder'\)/);
  assert.match(migration, /READY_FOR_BOOKING/);
  assert.doesNotMatch(migration, /create table public\.(bookings|supplier_confirmations|vouchers|credit_approvals)\b/i);
  assert.doesNotMatch(migration, /stripe|pasha|kapital|webhook_secret/i);
});

test('retained Payment screen is live, localized, accessible and responsive', async () => {
  const [page, customer, finance, styles, en, az, ru] = await Promise.all([
    readFile('src/app/[locale]/(customer)/payment/page.tsx', 'utf8'),
    readFile('src/components/customer-payment-workspace.tsx', 'utf8'),
    readFile('src/components/finance-payment-queue.tsx', 'utf8'),
    readFile('src/app/globals.css', 'utf8'),
    readFile('src/i18n/messages/en.json', 'utf8'),
    readFile('src/i18n/messages/az.json', 'utf8'),
    readFile('src/i18n/messages/ru.json', 'utf8')
  ]);
  assert.doesNotMatch(page, /ScreenPreview/);
  assert.match(page, /CustomerPaymentWorkspace/);
  assert.match(customer, /aria-labelledby/);
  assert.match(customer, /aria-live="polite"/);
  assert.match(customer, /declarationConfirmed/);
  assert.match(finance, /payment\.review\.start/);
  assert.match(finance, /payment\.verify/);
  assert.match(finance, /funds\.allocate/);
  assert.match(finance, /payment\.evaluate_readiness/);
  assert.match(styles, /\.payment-timeline/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.payment-card/s);
  for (const catalogue of [en, az, ru]) {
    assert.match(catalogue, /"paymentCustomer"/);
    assert.match(catalogue, /"paymentStaff"/);
    assert.match(catalogue, /"READY_FOR_BOOKING"/);
  }
});
