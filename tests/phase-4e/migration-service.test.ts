import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  runDryRunImport, markBatchValidated, commitBatch, reverseBatch, parseCsv,
  InMemoryMigrationStore, MigrationAuthorityError, type MigrationServiceContext
} from '@/server/agents/supplier-ops/migration-service';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): MigrationServiceContext & { store: InMemoryMigrationStore } {
  return { store: new InMemoryMigrationStore(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

test('a dry-run import writes no authoritative target for any row', async () => {
  const c = ctx();
  const { batchId, accepted } = await runDryRunImport(c, {
    batchType: 'SUPPLIERS', sourceProvenance: 'r-travel-export-2026-08.csv', importedBy: randomUUID(),
    rows: [{ legalName: 'Test Hotel Wholesaler LLC' }, { legalName: 'Test DMC LLC' }]
  });
  assert.equal(accepted, 2);
  const rows = await c.store.loadRows(batchId);
  assert.ok(rows.every((r) => r.targetId === null));
  const batch = await c.store.loadBatch(batchId);
  assert.equal(batch?.status, 'DRY_RUN');
  assert.equal(batch?.dryRun, true);
});

test('an empty row is rejected with a real reason, not silently accepted', async () => {
  const c = ctx();
  const { rejected } = await runDryRunImport(c, {
    batchType: 'SUPPLIERS', sourceProvenance: 'test.csv', importedBy: randomUUID(), rows: [{}]
  });
  assert.equal(rejected, 1);
});

test('two customer rows with similar names but no verified email/phone are NOT merged — both accepted as provisionally distinct', async () => {
  const c = ctx();
  const { accepted, duplicates } = await runDryRunImport(c, {
    batchType: 'CUSTOMERS', sourceProvenance: 'legacy-crm-export.csv', importedBy: randomUUID(),
    rows: [{ name: 'Elvin Mammadov', email: 'elvin.m1@example.com' }, { name: 'Elvin Mammadov', email: 'elvin.m2@example.com' }]
  });
  assert.equal(accepted, 2);
  assert.equal(duplicates, 0);
});

test('a customer row with a verified email matching an existing contact IS correctly flagged as a duplicate', async () => {
  const c = ctx();
  c.store.seedVerifiedContact('existing@example.com', randomUUID());
  const { accepted, duplicates } = await runDryRunImport(c, {
    batchType: 'CUSTOMERS', sourceProvenance: 'legacy-crm-export.csv', importedBy: randomUUID(),
    rows: [{ name: 'Completely Different Name', email: 'existing@example.com' }]
  });
  assert.equal(duplicates, 1);
  assert.equal(accepted, 0);
});

test('a customer row with neither email nor phone is rejected, never silently accepted without a real identity signal', async () => {
  const c = ctx();
  const { rejected } = await runDryRunImport(c, {
    batchType: 'CUSTOMERS', sourceProvenance: 'legacy-crm-export.csv', importedBy: randomUUID(),
    rows: [{ name: 'No Contact Info Customer' }]
  });
  assert.equal(rejected, 1);
});

test('committing a batch without an approver is refused', async () => {
  const c = ctx();
  const { batchId } = await runDryRunImport(c, { batchType: 'SUPPLIERS', sourceProvenance: 'test.csv', importedBy: randomUUID(), rows: [{ legalName: 'Test Supplier' }] });
  await markBatchValidated(c, batchId);
  await assert.rejects(
    () => commitBatch(c, batchId, ''),
    (e: unknown) => e instanceof MigrationAuthorityError && e.code === 'REQUIRES_APPROVAL'
  );
});

test('committing with a real human approver applies only ACCEPTED rows and marks the batch COMMITTED', async () => {
  const c = ctx();
  const { batchId } = await runDryRunImport(c, {
    batchType: 'SUPPLIERS', sourceProvenance: 'test.csv', importedBy: randomUUID(),
    rows: [{ legalName: 'Supplier A' }, {}]
  });
  await markBatchValidated(c, batchId);
  const approver = randomUUID();
  const { appliedCount } = await commitBatch(c, batchId, approver);
  assert.equal(appliedCount, 1);
  const batch = await c.store.loadBatch(batchId);
  assert.equal(batch?.status, 'COMMITTED');
  assert.equal(batch?.approvedBy, approver);
  const rows = await c.store.loadRows(batchId);
  const acceptedRow = rows.find((r) => r.status === 'ACCEPTED');
  const rejectedRow = rows.find((r) => r.status === 'REJECTED');
  assert.ok(acceptedRow?.targetId);
  assert.equal(rejectedRow?.targetId, null);
});

test('a batch cannot be committed twice', async () => {
  const c = ctx();
  const { batchId } = await runDryRunImport(c, { batchType: 'SUPPLIERS', sourceProvenance: 'test.csv', importedBy: randomUUID(), rows: [{ legalName: 'X' }] });
  await markBatchValidated(c, batchId);
  await commitBatch(c, batchId, randomUUID());
  await assert.rejects(
    () => commitBatch(c, batchId, randomUUID()),
    (e: unknown) => e instanceof MigrationAuthorityError && e.code === 'ALREADY_COMMITTED'
  );
});

test('reversing a committed batch unwinds every applied row and marks the batch REVERSED', async () => {
  const c = ctx();
  const { batchId } = await runDryRunImport(c, {
    batchType: 'SUPPLIERS', sourceProvenance: 'test.csv', importedBy: randomUUID(),
    rows: [{ legalName: 'Supplier A' }, { legalName: 'Supplier B' }]
  });
  await markBatchValidated(c, batchId);
  await commitBatch(c, batchId, randomUUID());
  const { reversedCount } = await reverseBatch(c, batchId, randomUUID());
  assert.equal(reversedCount, 2);
  const batch = await c.store.loadBatch(batchId);
  assert.equal(batch?.status, 'REVERSED');
  assert.ok(batch?.reversedAt);
  assert.ok(batch?.reversedBy);
});

test('a DRY_RUN batch (never committed) cannot be reversed — there is nothing authoritative to undo', async () => {
  const c = ctx();
  const { batchId } = await runDryRunImport(c, { batchType: 'SUPPLIERS', sourceProvenance: 'test.csv', importedBy: randomUUID(), rows: [{ legalName: 'X' }] });
  await assert.rejects(
    () => reverseBatch(c, batchId, randomUUID()),
    (e: unknown) => e instanceof MigrationAuthorityError
  );
});

test('every batch carries real source provenance, never fabricated', async () => {
  const c = ctx();
  const { batchId } = await runDryRunImport(c, { batchType: 'CONTRACTS', sourceProvenance: 'r-travel-legal-team-export-2026-08-01.xlsx', importedBy: randomUUID(), rows: [{ ref: 'C-001' }] });
  const batch = await c.store.loadBatch(batchId);
  assert.equal(batch?.sourceProvenance, 'r-travel-legal-team-export-2026-08-01.xlsx');
});

test('the CSV parser handles quoted fields with embedded commas', () => {
  const rows = parseCsv('legalName,notes\n"Test Hotel, Baku",Some notes\nSimple Supplier,No comma');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].legalName, 'Test Hotel, Baku');
  assert.equal(rows[1].legalName, 'Simple Supplier');
});

test('the CSV parser returns an empty array for empty content', () => {
  assert.deepEqual(parseCsv(''), []);
});
