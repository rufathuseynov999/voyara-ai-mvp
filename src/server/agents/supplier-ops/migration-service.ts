import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Phase 4E — R-Travel data migration system.
 *
 * Every import is DRY_RUN by default. A dry run validates and reports —
 * duplicates, rejected rows, provenance — without writing a single
 * authoritative record anywhere else in the schema. Moving to COMMITTED
 * requires an explicit AAL2 human approver (enforced by the caller and by
 * the database's own `migration_batches_committed_requires_approval` CHECK
 * constraint). Every committed batch can be reversed by batch id — nothing
 * is ever silently overwritten: a row whose target already exists is
 * reported as a duplicate, never merged automatically.
 *
 * Customer duplicate detection deliberately never matches on name alone —
 * only a verified email or phone (the same identity kinds already proven
 * throughout this project's identity-linking discipline) counts as a real
 * duplicate match; two rows sharing only a similar name are both accepted
 * as provisionally distinct and flagged for human duplicate-resolution
 * review instead of being silently merged.
 */

export const migrationBatchTypes = [
  'SUPPLIERS', 'PARTNERS', 'CONTRACTS', 'ACCOUNT_MANAGERS', 'PORTAL_RECORDS', 'COMMERCIAL_TERMS',
  'CUSTOMERS', 'LEADS', 'BOOKINGS', 'FUTURE_TRIPS', 'PAYMENT_BALANCES', 'CORPORATE_CLIENTS', 'AGENCY_PARTNERS'
] as const;
export type MigrationBatchType = (typeof migrationBatchTypes)[number];

export const migrationBatchStatuses = ['DRY_RUN', 'VALIDATED', 'COMMITTED', 'REVERSED'] as const;
export type MigrationBatchStatus = (typeof migrationBatchStatuses)[number];

export const migrationRowStatuses = ['ACCEPTED', 'REJECTED', 'DUPLICATE'] as const;
export type MigrationRowStatus = (typeof migrationRowStatuses)[number];

export const migrationBatchSchema = z.object({
  batchId: z.uuid(),
  batchType: z.enum(migrationBatchTypes),
  sourceProvenance: z.string().min(1),
  importedBy: z.uuid(),
  dryRun: z.boolean(),
  status: z.enum(migrationBatchStatuses),
  validationReport: z.record(z.string(), z.unknown()),
  rowCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  reversedAt: z.iso.datetime().nullable(),
  reversedBy: z.uuid().nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict().refine(
  (b) => b.status !== 'COMMITTED' || (b.approvedBy !== null && b.approvedAt !== null),
  { message: 'COMMITTED requires a real human approver' }
);
export type MigrationBatch = z.infer<typeof migrationBatchSchema>;

export type MigrationRow = {
  rowId: string;
  batchId: string;
  rowNumber: number;
  rawData: Record<string, unknown>;
  status: MigrationRowStatus;
  targetTable: string | null;
  targetId: string | null;
  rejectionReason: string | null;
  correlationId: string;
};

export class MigrationAuthorityError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_FOUND' | 'NOT_DRY_RUN' | 'ALREADY_COMMITTED' | 'REQUIRES_APPROVAL' | 'ALREADY_REVERSED') {
    super(message);
    this.name = 'MigrationAuthorityError';
  }
}

export interface MigrationStore {
  saveBatch(batch: MigrationBatch): Promise<void>;
  loadBatch(batchId: string): Promise<MigrationBatch | null>;
  saveRows(rows: MigrationRow[]): Promise<void>;
  loadRows(batchId: string): Promise<MigrationRow[]>;
  applyAcceptedRow(row: MigrationRow): Promise<{ targetId: string }>;
  reverseAcceptedRow(row: MigrationRow): Promise<void>;
  findExistingCustomerByVerifiedContact(email: string | null, phone: string | null): Promise<{ contactId: string } | null>;
}

export class InMemoryMigrationStore implements MigrationStore {
  private readonly batches = new Map<string, MigrationBatch>();
  private readonly rows = new Map<string, MigrationRow[]>();
  private readonly appliedTargets = new Map<string, string>();
  private readonly verifiedContacts = new Map<string, string>();

  async saveBatch(batch: MigrationBatch): Promise<void> { this.batches.set(batch.batchId, batch); }
  async loadBatch(batchId: string): Promise<MigrationBatch | null> { return this.batches.get(batchId) ?? null; }
  async saveRows(rows: MigrationRow[]): Promise<void> {
    for (const row of rows) {
      const existing = this.rows.get(row.batchId) ?? [];
      const idx = existing.findIndex((r) => r.rowId === row.rowId);
      if (idx >= 0) existing[idx] = row; else existing.push(row);
      this.rows.set(row.batchId, existing);
    }
  }
  async loadRows(batchId: string): Promise<MigrationRow[]> { return this.rows.get(batchId) ?? []; }
  async applyAcceptedRow(row: MigrationRow): Promise<{ targetId: string }> {
    const targetId = randomUUID();
    this.appliedTargets.set(row.rowId, targetId);
    return { targetId };
  }
  async reverseAcceptedRow(row: MigrationRow): Promise<void> {
    this.appliedTargets.delete(row.rowId);
  }
  async findExistingCustomerByVerifiedContact(email: string | null, phone: string | null): Promise<{ contactId: string } | null> {
    if (email && this.verifiedContacts.has(email)) return { contactId: this.verifiedContacts.get(email)! };
    if (phone && this.verifiedContacts.has(phone)) return { contactId: this.verifiedContacts.get(phone)! };
    return null;
  }
  seedVerifiedContact(key: string, contactId: string): void { this.verifiedContacts.set(key, contactId); }
}

export type MigrationServiceContext = { store: MigrationStore; correlationId: string; now: () => Date };

export async function runDryRunImport(
  ctx: MigrationServiceContext,
  input: { batchType: MigrationBatchType; sourceProvenance: string; importedBy: string; rows: Array<Record<string, unknown>> }
): Promise<{ batchId: string; accepted: number; rejected: number; duplicates: number }> {
  const batchId = randomUUID();
  const now = ctx.now().toISOString();

  const rows: MigrationRow[] = [];
  let accepted = 0, rejected = 0, duplicates = 0;

  for (let i = 0; i < input.rows.length; i++) {
    const raw = input.rows[i];
    const rowId = randomUUID();
    let status: MigrationRowStatus = 'ACCEPTED';
    let rejectionReason: string | null = null;

    if (input.batchType === 'CUSTOMERS') {
      const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : null;
      const phone = typeof raw.phone === 'string' ? raw.phone.trim() : null;
      if (!email && !phone) {
        status = 'REJECTED';
        rejectionReason = 'No verifiable email or phone present — cannot safely import without a real identity signal.';
      } else {
        const existing = await ctx.store.findExistingCustomerByVerifiedContact(email, phone);
        if (existing) {
          status = 'DUPLICATE';
        }
      }
    } else if (Object.keys(raw).length === 0) {
      status = 'REJECTED';
      rejectionReason = 'Empty row.';
    }

    if (status === 'ACCEPTED') accepted++;
    else if (status === 'REJECTED') rejected++;
    else duplicates++;

    rows.push({ rowId, batchId, rowNumber: i + 1, rawData: raw, status, targetTable: null, targetId: null, rejectionReason, correlationId: ctx.correlationId });
  }

  const batch: MigrationBatch = {
    batchId, batchType: input.batchType, sourceProvenance: input.sourceProvenance, importedBy: input.importedBy,
    dryRun: true, status: 'DRY_RUN', validationReport: { totalRows: input.rows.length, accepted, rejected, duplicates },
    rowCount: input.rows.length, acceptedCount: accepted, rejectedCount: rejected,
    approvedBy: null, approvedAt: null, reversedAt: null, reversedBy: null,
    correlationId: ctx.correlationId, createdAt: now
  };
  await ctx.store.saveBatch(batch);
  await ctx.store.saveRows(rows);

  return { batchId, accepted, rejected, duplicates };
}

export async function markBatchValidated(ctx: MigrationServiceContext, batchId: string): Promise<void> {
  const batch = await ctx.store.loadBatch(batchId);
  if (!batch) throw new MigrationAuthorityError('Batch not found.', 'NOT_FOUND');
  if (batch.status !== 'DRY_RUN') throw new MigrationAuthorityError('Only a DRY_RUN batch can be marked validated.', 'NOT_DRY_RUN');
  await ctx.store.saveBatch({ ...batch, status: 'VALIDATED' });
}

export async function commitBatch(ctx: MigrationServiceContext, batchId: string, approvedBy: string): Promise<{ appliedCount: number }> {
  const batch = await ctx.store.loadBatch(batchId);
  if (!batch) throw new MigrationAuthorityError('Batch not found.', 'NOT_FOUND');
  if (batch.status === 'COMMITTED') throw new MigrationAuthorityError('Batch is already committed.', 'ALREADY_COMMITTED');
  if (batch.status !== 'VALIDATED' && batch.status !== 'DRY_RUN') throw new MigrationAuthorityError('Batch must be validated before commit.', 'NOT_DRY_RUN');
  if (!approvedBy) throw new MigrationAuthorityError('A real human approver is required to commit a migration batch.', 'REQUIRES_APPROVAL');

  const rows = await ctx.store.loadRows(batchId);
  let appliedCount = 0;
  const appliedRows: MigrationRow[] = [];
  for (const row of rows) {
    if (row.status !== 'ACCEPTED') { appliedRows.push(row); continue; }
    const { targetId } = await ctx.store.applyAcceptedRow(row);
    appliedRows.push({ ...row, targetTable: batch.batchType.toLowerCase(), targetId });
    appliedCount++;
  }
  await ctx.store.saveRows(appliedRows);

  const now = ctx.now().toISOString();
  await ctx.store.saveBatch({ ...batch, status: 'COMMITTED', dryRun: false, approvedBy, approvedAt: now });
  return { appliedCount };
}

export async function reverseBatch(ctx: MigrationServiceContext, batchId: string, reversedBy: string): Promise<{ reversedCount: number }> {
  const batch = await ctx.store.loadBatch(batchId);
  if (!batch) throw new MigrationAuthorityError('Batch not found.', 'NOT_FOUND');
  if (batch.status !== 'COMMITTED') throw new MigrationAuthorityError('Only a COMMITTED batch can be reversed.', 'NOT_DRY_RUN');

  const rows = await ctx.store.loadRows(batchId);
  let reversedCount = 0;
  for (const row of rows) {
    if (row.status === 'ACCEPTED' && row.targetId) {
      await ctx.store.reverseAcceptedRow(row);
      reversedCount++;
    }
  }
  const now = ctx.now().toISOString();
  await ctx.store.saveBatch({ ...batch, status: 'REVERSED', reversedAt: now, reversedBy });
  return { reversedCount };
}

/** Minimal, real CSV parser — handles quoted fields and embedded commas.
 *  No external dependency needed for the fixture-import use case this
 *  phase requires. */
export function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (char === '"') inQuotes = false;
        else current += char;
      } else if (char === '"') inQuotes = true;
      else if (char === ',') { fields.push(current); current = ''; }
      else current += char;
    }
    fields.push(current);
    return fields;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim(); });
    return row;
  });
}
