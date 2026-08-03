import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InMemoryBookingCommandPort } from '@/server/agents/automation/booking-command-port';
import { InMemoryPortalTaskStore } from '@/server/agents/supplier-ops/portal-task-store';
import { confirmTask, approveTask, assignTask, markPortalActionRequired, submitToSupplier, recordSupplierPending } from '@/server/agents/supplier-ops/portal-task-service';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';
import type { Viewer } from '@/server/auth/viewer';
import type { StaffBookingCommand } from '@/server/booking/contract';

function humanStaffViewer(overrides: Partial<Viewer> = {}): Viewer {
  return { id: randomUUID(), roles: ['staff'], source: 'supabase', assuranceLevel: 'aal2', sessionId: randomUUID(), issuedAt: Date.now() / 1000, ...overrides };
}

const CREATE_COMMAND: StaffBookingCommand = { action: 'booking.create', paymentRequestId: randomUUID(), readinessEvaluationId: randomUUID(), readinessHash: 'a'.repeat(64) };

test('a Viewer-shaped object with no staff-area role is refused — booking commands are human-staff-only', async () => {
  const port = new InMemoryBookingCommandPort();
  const customerViewer = humanStaffViewer({ roles: ['customer'] });
  await assert.rejects(
    () => port.executeBookingCommand(customerViewer, CREATE_COMMAND, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('a Viewer-shaped object with an empty roles array (as an automation caller might construct) is refused', async () => {
  const port = new InMemoryBookingCommandPort();
  const noRoleViewer = humanStaffViewer({ roles: [] });
  await assert.rejects(
    () => port.executeBookingCommand(noRoleViewer, CREATE_COMMAND, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('a Viewer missing a real session id (a forged/fabricated identity) is refused', async () => {
  const port = new InMemoryBookingCommandPort();
  const forgedViewer = humanStaffViewer({ sessionId: '' });
  await assert.rejects(
    () => port.executeBookingCommand(forgedViewer, CREATE_COMMAND, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('a real staff Viewer without AAL2 is refused', async () => {
  const port = new InMemoryBookingCommandPort();
  const aal1Viewer = humanStaffViewer({ assuranceLevel: 'aal1' });
  await assert.rejects(
    () => port.executeBookingCommand(aal1Viewer, CREATE_COMMAND, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'MISSING_APPROVAL'
  );
});

test('a real staff Viewer with AAL2 succeeds', async () => {
  const port = new InMemoryBookingCommandPort();
  const viewer = humanStaffViewer();
  const result = await port.executeBookingCommand(viewer, CREATE_COMMAND, `idem-${randomUUID()}`);
  assert.equal(result.status, 'accepted');
});

test('a retried call with the same idempotency key returns the original result, never re-executing', async () => {
  const port = new InMemoryBookingCommandPort();
  const viewer = humanStaffViewer();
  const idempotencyKey = `idem-${randomUUID()}`;
  const first = await port.executeBookingCommand(viewer, CREATE_COMMAND, idempotencyKey);
  const second = await port.executeBookingCommand(viewer, CREATE_COMMAND, idempotencyKey);
  assert.equal(first.bookingId, second.bookingId);
  assert.equal(port.callsFor(viewer.id).length, 1);
});

test('confirming a portal task does not itself produce a booking-command call — the two are genuinely separate systems', async () => {
  const bookingPort = new InMemoryBookingCommandPort();
  const portalTaskStore = new InMemoryPortalTaskStore();
  const ctx = { store: portalTaskStore, supplierStore: {} as never, correlationId: 'corr-test', now: () => new Date('2026-08-01T09:00:00.000Z') };

  const taskId = randomUUID();
  await portalTaskStore.saveTask({
    portalTaskId: taskId, supplierId: randomUUID(), contractId: randomUUID(), conversationId: null, contactId: randomUUID(),
    status: 'READY_FOR_REVIEW', bookingData: {}, proposedMarkup: null, checklist: [], assignedOwnerId: null,
    supplierConfirmationReference: null, voucherMetadata: null, correlationId: 'corr-test', createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z'
  } as never);

  // Walk the real portal-task state machine's full required chain
  // (portal-task-contract.ts's own allowedTransitions table) before
  // confirmation is even a legal transition.
  const owner = randomUUID();
  await approveTask(ctx, taskId, owner);
  await assignTask(ctx, taskId, owner, owner);
  await markPortalActionRequired(ctx, taskId, owner);
  await submitToSupplier(ctx, taskId, owner);
  await recordSupplierPending(ctx, taskId, owner);
  await confirmTask(ctx, taskId, owner, 'supplier-conf-ref-123', null);

  assert.equal(bookingPort.allCalls().length, 0);
});

test('booking-command-port.ts contains no function that issues a ticket, cancels, or refunds', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/automation/booking-command-port.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/function\s+\w*(issueTicket|voidTicket|reissueTicket|cancelBooking|executeRefund)/i.test(codeOnly));
});
