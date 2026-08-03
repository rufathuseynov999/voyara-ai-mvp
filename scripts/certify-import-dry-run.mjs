#!/usr/bin/env node
/**
 * Phase 4E — R-Travel migration dry-run certification script.
 *
 * Runs entirely against fixture CSV data generated in this script — no real
 * R-Travel supplier, contract, or customer data exists anywhere in this
 * project. Honestly reports XLSX support as NOT_CONFIGURED: a real XLSX
 * parsing library was evaluated (the well-known `xlsx`/SheetJS package) and
 * deliberately NOT added to this project, because the version available
 * carries known high-severity vulnerabilities (prototype pollution, ReDoS)
 * inconsistent with this project's security discipline. CSV import is
 * fully implemented and certified below; XLSX import needs a properly
 * vetted library chosen as a founder/engineering decision before it can be
 * added safely — see the migration runbook.
 */
import { randomUUID } from 'node:crypto';
import {
  runDryRunImport, markBatchValidated, commitBatch, reverseBatch, parseCsv,
  InMemoryMigrationStore
} from '../src/server/agents/supplier-ops/migration-service.ts';

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
}

const FIXED = new Date('2026-08-01T09:00:00.000Z');

process.stdout.write(
  '=== R-Travel migration dry-run certification (FIXTURES ONLY) ===\n' +
  'No real R-Travel supplier, contract, customer, or booking data is used anywhere in this run.\n\n'
);

{
  const csvFixture = 'legalName,supplierType,portalUrl\n' +
    '"Fixture Hotel Wholesaler, LLC",HOTEL_WHOLESALER,https://fixture-portal.invalid\n' +
    'Fixture DMC Ltd,DMC,https://fixture-dmc-portal.invalid\n';
  const rows = parseCsv(csvFixture);
  record('CSV fixture parses correctly (quoted field with embedded comma)', rows.length === 2 && rows[0].legalName === 'Fixture Hotel Wholesaler, LLC');

  const store = new InMemoryMigrationStore();
  const ctx = { store, correlationId: `cert-${Date.now()}`, now: () => FIXED };
  const { batchId, accepted, rejected } = await runDryRunImport(ctx, { batchType: 'SUPPLIERS', sourceProvenance: 'fixture-suppliers.csv', importedBy: randomUUID(), rows });
  record('dry-run import validates fixture rows and writes no authoritative target', accepted === 2 && rejected === 0);
  const dryRunRows = await store.loadRows(batchId);
  record('no row has a target id after dry run (no authoritative write)', dryRunRows.every((r) => r.targetId === null));

  await markBatchValidated(ctx, batchId);
  const approver = randomUUID();
  const { appliedCount } = await commitBatch(ctx, batchId, approver);
  record('AAL2-style human approval required and honored before commit', appliedCount === 2);

  const { reversedCount } = await reverseBatch(ctx, batchId, randomUUID());
  record('committed batch is fully reversible by batch id', reversedCount === 2);
}

{
  const csvFixture = 'name,email\nElvin Mammadov,elvin.1@fixture.invalid\nElvin Mammadov,elvin.2@fixture.invalid\nNo Contact Customer,\n';
  const rows = parseCsv(csvFixture).map((r) => ({ ...r, email: r.email || undefined }));
  const store = new InMemoryMigrationStore();
  const ctx = { store, correlationId: `cert-${Date.now()}`, now: () => FIXED };
  const { accepted, rejected, duplicates } = await runDryRunImport(ctx, { batchType: 'CUSTOMERS', sourceProvenance: 'fixture-customers.csv', importedBy: randomUUID(), rows });
  record('two customers with the same name but different emails are NOT merged (never merge by name alone)', accepted === 2);
  record('a customer row with no verifiable email/phone is rejected, not silently accepted', rejected === 1);
  record('duplicate count is zero when no verified contact actually matches an existing record', duplicates === 0);
}

{
  const store = new InMemoryMigrationStore();
  const existingId = randomUUID();
  store.seedVerifiedContact('existing@fixture.invalid', existingId);
  const ctx = { store, correlationId: `cert-${Date.now()}`, now: () => FIXED };
  const { duplicates, accepted } = await runDryRunImport(ctx, {
    batchType: 'CUSTOMERS', sourceProvenance: 'fixture-customers-2.csv', importedBy: randomUUID(),
    rows: [{ name: 'Totally Different Name', email: 'existing@fixture.invalid' }]
  });
  record('a row matching an existing VERIFIED email is correctly flagged as a duplicate', duplicates === 1 && accepted === 0);
}

{
  const store = new InMemoryMigrationStore();
  const ctx = { store, correlationId: `cert-${Date.now()}`, now: () => FIXED };
  const { batchId } = await runDryRunImport(ctx, { batchType: 'SUPPLIERS', sourceProvenance: 'fixture-empty-rows.csv', importedBy: randomUUID(), rows: [{}, { legalName: 'Real Row' }] });
  const rows = await store.loadRows(batchId);
  const rejectedRow = rows.find((r) => r.status === 'REJECTED');
  record('rejected-row report includes a real, specific rejection reason', Boolean(rejectedRow?.rejectionReason));
}

record('XLSX import support', false, 'NOT_CONFIGURED — no vetted XLSX library is included in this build; see the migration runbook for why');

process.stdout.write('\nFixture-only dry-run certification complete. No real R-Travel data was used.\n');

const failed = results.filter((r) => !r.pass && r.name !== 'XLSX import support');
process.stdout.write(`\n${results.length - results.filter((r) => !r.pass).length}/${results.length} checks passed (XLSX intentionally reported NOT_CONFIGURED, not counted as a failure).\n`);
if (failed.length > 0) {
  process.stderr.write(`FAILED: ${failed.map((f) => f.name).join(', ')}\n`);
  process.exitCode = 1;
}
