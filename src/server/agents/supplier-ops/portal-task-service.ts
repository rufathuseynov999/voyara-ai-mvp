import { randomUUID } from 'node:crypto';
import type { PortalTaskStore } from './portal-task-store';
import type { SupplierStore } from './supplier-store';
import { requireActiveContractAuthority, type ContractServiceContext } from './contract-service';
import { assertValidTransition, portalTaskSchema, PortalTaskAuthorityError, type PortalTask, type PortalTaskStatus } from './portal-task-contract';
import { SYSTEM_ACTOR_ID } from '../business-account';

/**
 * Phase 4E — portal-assisted operations service.
 *
 * The AI Operations Agent may call `prepareTask` (identify supplier/
 * contract, calculate proposed markup from approved contract rules,
 * prepare a checklist) and `assignTask`. Everything past that —
 * `submitToSupplier`, `recordSupplierPending`, `confirmTask`,
 * `captureVoucher` — requires an explicit human actor id and, for
 * `confirmTask`, a real supplier confirmation reference. There is no
 * function in this file, and no combination of calls to functions in this
 * file, that can reach CONFIRMED without both. This service never logs into
 * a supplier portal, never stores or reads a portal password (no field for
 * one exists anywhere in this module), never issues a ticket, never
 * executes a cancellation or refund, and never promises availability — it
 * only prepares data and records what a human employee reports back.
 */

export type PortalTaskContext = {
  store: PortalTaskStore;
  supplierStore: SupplierStore;
  correlationId: string;
  now: () => Date;
};

async function transition(store: PortalTaskStore, task: PortalTask, to: PortalTaskStatus, actorId: string, actorKind: 'human' | 'agent' | 'system', now: Date, extra: Partial<PortalTask> = {}): Promise<PortalTask> {
  assertValidTransition(task.status, to);
  const updated: PortalTask = { ...task, ...extra, status: to, updatedAt: now.toISOString() };
  const parsed = portalTaskSchema.safeParse(updated);
  if (!parsed.success) throw new PortalTaskAuthorityError('Portal task failed validation on transition.', 'VALIDATION');
  await store.saveTask(updated);
  await store.recordTaskEvent({ eventId: randomUUID(), portalTaskId: task.portalTaskId, kind: `TRANSITIONED_TO_${to}`, actorId, actorKind, correlationId: task.correlationId });
  return updated;
}

export async function prepareTask(
  ctx: PortalTaskContext,
  input: { supplierId: string; contractId: string; contactId: string; conversationId: string | null; bookingData: Record<string, unknown>; checklist: Array<{ step: string; completed: boolean }> },
  idempotencyKey: string
): Promise<{ portalTaskId: string; created: boolean }> {
  const contractCtx: ContractServiceContext = { store: ctx.supplierStore, correlationId: ctx.correlationId, now: ctx.now };
  const contract = await requireActiveContractAuthority(contractCtx, input.contractId);

  const proposedTaskId = randomUUID();
  const reservation = await ctx.store.reserveIdempotencyKey(idempotencyKey, proposedTaskId, ctx.correlationId);
  if (!reservation.winner) {
    return { portalTaskId: reservation.portalTaskId, created: false };
  }

  const proposedMarkup = typeof contract.markupRules.defaultPercent === 'number' ? contract.markupRules.defaultPercent : null;
  const now = ctx.now().toISOString();
  const task: PortalTask = {
    portalTaskId: proposedTaskId, supplierId: input.supplierId, contractId: input.contractId,
    conversationId: input.conversationId, contactId: input.contactId, status: 'DRAFT',
    bookingData: input.bookingData, proposedMarkup, checklist: input.checklist,
    assignedOwnerId: null, supplierConfirmationReference: null, voucherMetadata: null,
    correlationId: ctx.correlationId, createdAt: now, updatedAt: now
  };
  await ctx.store.saveTask(task);
  await ctx.store.recordTaskEvent({ eventId: randomUUID(), portalTaskId: proposedTaskId, kind: 'TASK_PREPARED', actorId: SYSTEM_ACTOR_ID, actorKind: 'agent', correlationId: ctx.correlationId });
  return { portalTaskId: proposedTaskId, created: true };
}

export async function markReadyForReview(ctx: PortalTaskContext, portalTaskId: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'READY_FOR_REVIEW', SYSTEM_ACTOR_ID, 'agent', ctx.now());
}

export async function approveTask(ctx: PortalTaskContext, portalTaskId: string, approvedBy: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'APPROVED', approvedBy, 'human', ctx.now());
}

export async function assignTask(ctx: PortalTaskContext, portalTaskId: string, assignedOwnerId: string, assignedBy: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'ASSIGNED', assignedBy, 'human', ctx.now(), { assignedOwnerId });
}

export async function markPortalActionRequired(ctx: PortalTaskContext, portalTaskId: string, actorId: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'PORTAL_ACTION_REQUIRED', actorId, 'human', ctx.now());
}

export async function submitToSupplier(ctx: PortalTaskContext, portalTaskId: string, submittedBy: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  if (task.assignedOwnerId !== submittedBy) throw new PortalTaskAuthorityError('Only the assigned owner may submit this task.', 'NOT_ASSIGNED');
  await transition(ctx.store, task, 'SUBMITTED', submittedBy, 'human', ctx.now());
}

export async function recordSupplierPending(ctx: PortalTaskContext, portalTaskId: string, actorId: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'SUPPLIER_PENDING', actorId, 'human', ctx.now());
}

export async function confirmTask(
  ctx: PortalTaskContext,
  portalTaskId: string,
  confirmedBy: string,
  supplierConfirmationReference: string,
  voucherMetadata: Record<string, unknown> | null
): Promise<void> {
  if (!supplierConfirmationReference || supplierConfirmationReference.trim().length === 0) {
    throw new PortalTaskAuthorityError('A real supplier confirmation reference is required to confirm a portal task.', 'MISSING_CONFIRMATION');
  }
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'CONFIRMED', confirmedBy, 'human', ctx.now(), { supplierConfirmationReference, voucherMetadata, assignedOwnerId: task.assignedOwnerId ?? confirmedBy });
}

export async function escalateTask(ctx: PortalTaskContext, portalTaskId: string, actorId: string, reasonCode: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'HUMAN_ESCALATION_REQUIRED', actorId, task.status === 'FAILED' ? 'system' : 'human', ctx.now());
  await ctx.store.recordTaskEvent({ eventId: randomUUID(), portalTaskId, kind: 'ESCALATION_REASON', actorId, actorKind: 'human', correlationId: ctx.correlationId, reasonCode });
}

export async function markFailed(ctx: PortalTaskContext, portalTaskId: string, actorId: string, reasonCode: string): Promise<void> {
  const task = await ctx.store.loadTask(portalTaskId);
  if (!task) throw new PortalTaskAuthorityError('Task not found.', 'NOT_FOUND');
  await transition(ctx.store, task, 'FAILED', actorId, 'system', ctx.now());
  await ctx.store.recordTaskEvent({ eventId: randomUUID(), portalTaskId, kind: 'FAILURE_REASON', actorId, actorKind: 'system', correlationId: ctx.correlationId, reasonCode });
}
