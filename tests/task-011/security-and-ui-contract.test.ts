import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('retained CRM route loads authoritative administration after AAL2 and keeps its existing queue', async () => {
  const [page, component, route, queries] = await Promise.all([
    readFile('src/app/[locale]/staff/crm/page.tsx', 'utf8'),
    readFile('src/components/administration-workspace.tsx', 'utf8'),
    readFile('src/app/api/v1/staff/administration/route.ts', 'utf8'),
    readFile('src/server/administration/queries.ts', 'utf8')
  ]);
  assert.match(page, /loadStaffTravelRequestQueue/);
  assert.match(page, /loadAdministrationSnapshot/);
  assert.match(page, /requireAssuranceLevel\(locale, viewer, 'aal2'/);
  assert.match(page, /TravelRequestQueue/);
  assert.match(page, /AdministrationWorkspace/);
  assert.doesNotMatch(page, /ScreenPreview/);
  assert.match(queries, /import 'server-only'/);
  assert.match(queries, /createAdminSupabaseClient/);
  assert.match(route, /isSameOrigin/);
  assert.match(route, /AAL2_REQUIRED/);
  assert.match(route, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(route, /REQUEST_TOO_LARGE/);
  assert.match(component, /aria-labelledby="administration-title"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /disabled=\{!live/);
  assert.doesNotMatch(component, /localStorage|sessionStorage/);
});

test('database exposure is explicit, RLS-backed and has no browser write grant', async () => {
  const migration = await readFile(
    'supabase/migrations/20260718123000_task011_administration_vertical_slice.sql',
    'utf8'
  );
  assert.equal((migration.match(/with \(security_invoker = true\)/g) ?? []).length, 5);
  assert.match(migration, /alter table public\.crm_tasks force row level security/);
  assert.match(migration, /alter table public\.supplier_registry force row level security/);
  assert.match(migration, /grant select on table public\.membership_plan_catalogue to anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.execute_administration_command[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).* to (anon|authenticated)/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /api[_-]?key|password|secret[_-]?key/i);
});

test('localised administration catalogues have exact parity and approved prices only', async () => {
  const catalogues = await Promise.all(['az', 'ru', 'en'].map(async (locale) =>
    JSON.parse(await readFile(`src/i18n/messages/${locale}.json`, 'utf8')) as Record<string, unknown>
  ));
  const keyShape = (value: unknown): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      key, ...keyShape(child).map((nested) => `${key}.${nested}`)
    ]).sort();
  };
  assert.deepEqual(keyShape(catalogues[0]), keyShape(catalogues[1]));
  assert.deepEqual(keyShape(catalogues[0]), keyShape(catalogues[2]));
  for (const catalogue of catalogues) {
    const administration = JSON.stringify(catalogue.administration);
    assert.match(administration, /POSTGRESQL/);
    assert.match(administration, /BLOCK|blok|блок/i);
  }
  const memberships = await readFile('src/lib/memberships.ts', 'utf8');
  assert.match(memberships, /monthlyAzn: 19, annualAzn: 190/);
  assert.match(memberships, /monthlyAzn: 299, annualAzn: 2990/);
  assert.match(memberships, /monthlyAzn: 149/);
  assert.match(memberships, /monthlyAzn: 599/);
  assert.match(memberships, /name: 'Enterprise', monthlyAzn: null/);
});

test('public price cards read the exact PostgreSQL catalogue with a hash-checked approved fallback', async () => {
  const [landing, queries] = await Promise.all([
    readFile('src/app/[locale]/page.tsx', 'utf8'),
    readFile('src/server/administration/queries.ts', 'utf8')
  ]);
  assert.match(landing, /loadPublicMembershipCatalogue/);
  assert.doesNotMatch(landing, /from '@\/lib\/memberships'/);
  assert.match(queries, /membership_plan_catalogue/);
  assert.match(queries, /expectedHashes/);
  assert.match(queries, /approvedMembershipCatalogue/);
});

test('approval limits and Refunds are explicit blocked states, not implemented commands', async () => {
  const [contract, component, reportSource] = await Promise.all([
    readFile('src/server/administration/contract.ts', 'utf8'),
    readFile('src/components/administration-workspace.tsx', 'utf8'),
    readFile('docs/task-001/VOYARA-FOUNDER-DECISION-REGISTER.md', 'utf8')
  ]);
  assert.match(contract, /approvalLimits: 'NOT_CONFIGURED'/);
  assert.match(contract, /refunds: 'BLOCKED_PENDING_FOUNDER_POLICY'/);
  assert.match(component, /messages\.refundsBody/);
  assert.doesNotMatch(contract, /refund\.request|refund\.approve|refund\.execute/);
  assert.match(reportSource, /FDR-002/);
});
