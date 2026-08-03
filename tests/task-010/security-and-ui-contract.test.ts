import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Founder page uses the authoritative server query and retains Founder-only AAL2 access', async () => {
  const [page, layout, queries, admin] = await Promise.all([
    readFile('src/app/[locale]/staff/founder/page.tsx', 'utf8'),
    readFile('src/app/[locale]/staff/layout.tsx', 'utf8'),
    readFile('src/server/founder/queries.ts', 'utf8'),
    readFile('src/lib/supabase/admin.ts', 'utf8')
  ]);
  assert.match(page, /requireViewerRole\(locale, \['founder'\]/);
  assert.match(page, /loadFounderCommandCenter\(viewer\)/);
  assert.doesNotMatch(page, /ScreenPreview/);
  assert.match(layout, /requireAssuranceLevel\(locale, viewer, 'aal2'/);
  assert.match(queries, /import 'server-only'/);
  assert.match(queries, /viewer\.source === 'demo'/);
  assert.match(queries, /viewer\.assuranceLevel !== 'aal2'/);
  assert.match(queries, /viewer\.roles\.includes\('founder'\)/);
  assert.match(queries, /createAdminSupabaseClient/);
  assert.match(admin, /secretKey/);
});

test('Founder SQL views are security-invoker, service-only, and disclose missing ledgers', async () => {
  const migration = await readFile(
    'supabase/migrations/20260718090140_task010_founder_command_center_read_model.sql',
    'utf8'
  );
  assert.equal((migration.match(/with \(security_invoker = true\)/g) ?? []).length, 6);
  assert.equal((migration.match(/revoke all on table public\.founder_/g) ?? []).length, 6);
  assert.equal((migration.match(/grant select on table public\.founder_.* to service_role;/g) ?? []).length, 6);
  assert.match(migration, /'CASH'.*'UNAVAILABLE'/s);
  assert.match(migration, /'REVENUE'.*'UNAVAILABLE'/s);
  assert.match(migration, /NO_CASH_OR_BANK_LEDGER/);
  assert.match(migration, /NO_REVENUE_RECOGNITION_LEDGER/);
  assert.match(migration, /OPEN_PAYMENT_REQUESTS_NOT_ACCOUNTING_AR/);
  assert.match(migration, /EXACT_BOOKED_QUOTATION_PLANNED_GP_NOT_REALISED_GP/);
  assert.doesNotMatch(migration, /mrr|arr|ltv|cac/i);
});

test('retained Founder UI exposes source, freshness, unavailable states and human queue links accessibly', async () => {
  const [component, css] = await Promise.all([
    readFile('src/components/founder-command-center.tsx', 'utf8'),
    readFile('src/app/globals.css', 'utf8')
  ]);
  assert.match(component, /<main className="screen-page founder-command-center" id="main-content" tabIndex=\{-1\}>/);
  assert.match(component, /aria-labelledby="founder-decisions-title"/);
  assert.match(component, /role="status"/);
  assert.match(component, /snapshot\.sourceFreshness/);
  assert.match(component, /snapshot\.metrics/);
  assert.match(component, /dictionary\.founderAccess/);
  assert.doesNotMatch(component, /useState|useEffect|localStorage|sessionStorage/);
  assert.match(css, /\.founder-metric-grid/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.founder-metric-grid/);
  assert.match(css, /\.founder-decision-card \.button[\s\S]*width: 100%/);
});

test('AZ, RU and EN Founder catalogues have exact parity and approved unavailable-domain labels', async () => {
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
    const founder = JSON.stringify(catalogue.founderCommand);
    assert.match(founder, /MEMBERSHIP/);
    assert.match(founder, /AI_ACTIVITY_AND_COST/);
    assert.match(founder, /SYSTEM_MONITORING/);
    assert.match(founder, /NO_CASH_OR_BANK_LEDGER/);
    assert.match(founder, /NO_REVENUE_RECOGNITION_LEDGER/);
  }
});

test('Founder read model has no command path and cannot grant AI or browser authority', async () => {
  const [contract, queries, component, migration] = await Promise.all([
    readFile('src/server/founder/contract.ts', 'utf8'),
    readFile('src/server/founder/queries.ts', 'utf8'),
    readFile('src/components/founder-command-center.tsx', 'utf8'),
    readFile('supabase/migrations/20260718090140_task010_founder_command_center_read_model.sql', 'utf8')
  ]);
  const combined = `${contract}\n${queries}\n${component}`;
  assert.doesNotMatch(combined, /fetch\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(migration, /create (or replace )?function/i);
  assert.doesNotMatch(migration, /grant .*authenticated/i);
  assert.doesNotMatch(migration, /ai_agent/i);
});
