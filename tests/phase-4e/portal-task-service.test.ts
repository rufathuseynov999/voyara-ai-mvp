import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  approveTask, assignTask, confirmTask, markPortalActionRequired, markReadyForReview,
  prepareTask, recordSupplierPending, submitToSupplier, type PortalTaskContext
} from '@/server/agents/supplier-ops/portal-task-service';
import { InMemoryPortalTaskStore } from '@/server/agents/supplier-ops/portal-task-store';
import { InMemorySupplierStore } from '@/server/agents/supplier-ops/in-memory-supplier-store';
import { draftContract, approveAndActivateContract, type ContractServiceContext, type DraftContractInput } from '@/server/agents/supplier-ops/contract-service';
import { PortalTaskAuthorityError } from '@/server/agents/supplier-ops/portal-task-contract';
import { ContractAuthorityError } from '@/server/agents/supplier-ops/contract-authority';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(): PortalTaskContext & { store: InMemoryPortalTaskStore; supplierStore: InMemorySupplierStore } {
  return {
    store: new InMemoryPortalTaskStore(), supplierStore: new InMemorySupplierStore(),
    correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED
  };
}

function baseContractInput(overrides: Partial<DraftContractInput> = {}): DraftContractInput {
  return {
    agreementType: 'NET_RATE', rtravelLegalEntity: 'R-Travel LLC', supplierId: randomUUID(),
    supplierLegalEntity: 'Test Hotel Wholesaler LLC', contractReference: `REF-${randomUUID().slice(0, 8)}`,
    effectiveDate: '2026-01-01', expiryDate: '2027-01-01', renewalConditions: null, territory: 'Azerbaijan',
    productsCovered: ['HOTEL'], pricingStructure: 'NET rate + markup', markupRules: { defaultPercent: 15 },
    minimumAdvertisedPriceRestriction: null, currency: 'AZN', paymentTerms: 'Net 30', depositOrCreditLineRequirement: null,
    cancellationRules: '48h free cancellation', refundResponsibility: 'Supplier', chargebackResponsibility: 'R-Travel',
    bookingVoucherRequirements: null, resalePermissions: {}, voyaraBrandingAllowed: true, rtravelIdentityRequired: true,
    confidentialityRestrictions: null,
    ...overrides
  };
}

async function activeContract(c: ReturnType<typeof ctx>) {
  const contractCtx: ContractServiceContext = { store: c.supplierStore, correlationId: c.correlationId, now: c.now };
  const supplierId = randomUUID();
  const { contractId } = await draftContract(contractCtx, baseContractInput({ supplierId }));
  await approveAndActivateContract(contractCtx, contractId, randomUUID());
  return { supplierId, contractId };
}

test('preparing a task requires the cited contract to be genuinely active', async () => {
  const c = ctx();
  const contractCtx: ContractServiceContext = { store: c.supplierStore, correlationId: c.correlationId, now: c.now };
  const supplierId = randomUUID();
  const { contractId } = await draftContract(contractCtx, baseContractInput({ supplierId }));
  await assert.rejects(
    () => prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof ContractAuthorityError && e.code === 'NOT_ACTIVE'
  );
});

test('preparing a task calculates the proposed markup from the contract\'s own approved rules, not invented', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { portalTaskId } = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: { hotel: 'Test Hotel' }, checklist: [{ step: 'confirm dates', completed: false }] }, `idem-${randomUUID()}`);
  const task = await c.store.loadTask(portalTaskId);
  assert.equal(task?.status, 'DRAFT');
  assert.equal(task?.proposedMarkup, 15);
});

test('a retried prepareTask with the same idempotency key returns the original task, never creates a second one', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const idempotencyKey = `idem-${randomUUID()}`;
  const first = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, idempotencyKey);
  const second = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, idempotencyKey);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.portalTaskId, second.portalTaskId);
});

test('a task cannot skip states — DRAFT cannot jump directly to CONFIRMED', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { portalTaskId } = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, `idem-${randomUUID()}`);
  await assert.rejects(
    () => confirmTask(c, portalTaskId, randomUUID(), 'CONF-12345', null),
    (e: unknown) => e instanceof PortalTaskAuthorityError && e.code === 'INVALID_TRANSITION'
  );
});

test('confirmTask refuses an empty or whitespace-only supplier confirmation reference', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { portalTaskId } = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, `idem-${randomUUID()}`);
  await markReadyForReview(c, portalTaskId);
  const approver = randomUUID();
  await approveTask(c, portalTaskId, approver);
  await assignTask(c, portalTaskId, approver, approver);
  await markPortalActionRequired(c, portalTaskId, approver);
  await submitToSupplier(c, portalTaskId, approver);
  await recordSupplierPending(c, portalTaskId, approver);
  await assert.rejects(
    () => confirmTask(c, portalTaskId, approver, '   ', null),
    (e: unknown) => e instanceof PortalTaskAuthorityError && e.code === 'MISSING_CONFIRMATION'
  );
});

test('only the assigned owner may submit the task to the supplier — a different actor is refused', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { portalTaskId } = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, `idem-${randomUUID()}`);
  await markReadyForReview(c, portalTaskId);
  const owner = randomUUID();
  await approveTask(c, portalTaskId, owner);
  await assignTask(c, portalTaskId, owner, owner);
  await markPortalActionRequired(c, portalTaskId, owner);
  await assert.rejects(
    () => submitToSupplier(c, portalTaskId, randomUUID()),
    (e: unknown) => e instanceof PortalTaskAuthorityError && e.code === 'NOT_ASSIGNED'
  );
});

test('the full happy path reaches CONFIRMED only with a real human owner and real confirmation reference', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { portalTaskId } = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, `idem-${randomUUID()}`);
  await markReadyForReview(c, portalTaskId);
  const owner = randomUUID();
  await approveTask(c, portalTaskId, owner);
  await assignTask(c, portalTaskId, owner, owner);
  await markPortalActionRequired(c, portalTaskId, owner);
  await submitToSupplier(c, portalTaskId, owner);
  await recordSupplierPending(c, portalTaskId, owner);
  await confirmTask(c, portalTaskId, owner, 'HTL-CONF-98765', { voucherNumber: 'V-001' });
  const task = await c.store.loadTask(portalTaskId);
  assert.equal(task?.status, 'CONFIRMED');
  assert.equal(task?.assignedOwnerId, owner);
  assert.equal(task?.supplierConfirmationReference, 'HTL-CONF-98765');
});

test('every state transition is recorded as an append-only task event', async () => {
  const c = ctx();
  const { supplierId, contractId } = await activeContract(c);
  const { portalTaskId } = await prepareTask(c, { supplierId, contractId, contactId: randomUUID(), conversationId: null, bookingData: {}, checklist: [] }, `idem-${randomUUID()}`);
  await markReadyForReview(c, portalTaskId);
  const owner = randomUUID();
  await approveTask(c, portalTaskId, owner);
  const events = c.store.eventsFor(portalTaskId);
  assert.ok(events.some((e) => e.kind === 'TASK_PREPARED'));
  assert.ok(events.some((e) => e.kind === 'TRANSITIONED_TO_READY_FOR_REVIEW'));
  assert.ok(events.some((e) => e.kind === 'TRANSITIONED_TO_APPROVED' && e.actorId === owner));
});

test('no function anywhere in the portal task service reads, stores, or transmits a portal password', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/supplier-ops/portal-task-service.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/password|passwd|portalLogin|login\(/i.test(codeOnly));
});

test('no function anywhere in the portal task service issues a ticket, executes a cancellation, or executes a refund', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/supplier-ops/portal-task-service.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/issueTicket|executeCancellation|executeRefund|voidTicket|reissueTicket/i.test(codeOnly));
});

test('confirmTask is the only exported function whose name contains "confirm"', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/supplier-ops/portal-task-service.ts', import.meta.url), 'utf8');
  const matches = raw.match(/export async function \w*[Cc]onfirm\w*/g) ?? [];
  assert.equal(matches.length, 1);
  assert.ok(matches[0].includes('confirmTask'));
});
