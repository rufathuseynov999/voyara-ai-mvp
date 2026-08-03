import { z } from 'zod';

/**
 * Phase 4E — portal-assisted operations contract.
 *
 * For suppliers without an API, VOYARA's AI Operations Agent may PREPARE
 * everything a human employee needs to complete a supplier-portal action —
 * it never performs the portal action itself. The state machine below is
 * closed; there is no state representing "AI logged in and booked it," and
 * `CONFIRMED` can only be reached with a real human owner and a real
 * supplier confirmation reference on file (also enforced at the database
 * level via `portal_tasks_confirmed_requires_evidence`).
 */

export const portalTaskStatuses = [
  'DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ASSIGNED', 'PORTAL_ACTION_REQUIRED',
  'SUBMITTED', 'SUPPLIER_PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'HUMAN_ESCALATION_REQUIRED'
] as const;
export type PortalTaskStatus = (typeof portalTaskStatuses)[number];

/** Allowed forward transitions. Every edge either requires an explicit
 *  human actor (checked by the service layer, not just this table) or is a
 *  terminal/escalation state. There is no edge from any non-terminal state
 *  directly to CONFIRMED without passing through SUBMITTED/SUPPLIER_PENDING
 *  first — the AI cannot skip the human-verification step. */
export const portalTaskTransitions: Record<PortalTaskStatus, readonly PortalTaskStatus[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'CANCELLED'],
  READY_FOR_REVIEW: ['APPROVED', 'CANCELLED', 'HUMAN_ESCALATION_REQUIRED'],
  APPROVED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PORTAL_ACTION_REQUIRED', 'CANCELLED', 'HUMAN_ESCALATION_REQUIRED'],
  PORTAL_ACTION_REQUIRED: ['SUBMITTED', 'FAILED', 'HUMAN_ESCALATION_REQUIRED'],
  SUBMITTED: ['SUPPLIER_PENDING', 'FAILED'],
  SUPPLIER_PENDING: ['CONFIRMED', 'FAILED', 'HUMAN_ESCALATION_REQUIRED'],
  CONFIRMED: [],
  FAILED: ['HUMAN_ESCALATION_REQUIRED'],
  CANCELLED: [],
  HUMAN_ESCALATION_REQUIRED: ['ASSIGNED', 'CANCELLED']
};

const checklistItemSchema = z.object({ step: z.string(), completed: z.boolean() }).strict();

export const portalTaskSchema = z.object({
  portalTaskId: z.uuid(),
  supplierId: z.uuid(),
  contractId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  contactId: z.uuid(),
  status: z.enum(portalTaskStatuses),
  bookingData: z.record(z.string(), z.unknown()),
  proposedMarkup: z.number().nullable(),
  checklist: z.array(checklistItemSchema),
  assignedOwnerId: z.uuid().nullable(),
  supplierConfirmationReference: z.string().nullable(),
  voucherMetadata: z.record(z.string(), z.unknown()).nullable(),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict().refine(
  (task) => task.status !== 'CONFIRMED' || (task.assignedOwnerId !== null && task.supplierConfirmationReference !== null),
  { message: 'CONFIRMED requires a real human owner and a real supplier confirmation reference' }
);
export type PortalTask = z.infer<typeof portalTaskSchema>;

export class PortalTaskAuthorityError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'NOT_FOUND' | 'INVALID_TRANSITION' | 'NOT_ASSIGNED' | 'CONTRACT_NOT_ACTIVE' | 'MISSING_CONFIRMATION'
  ) {
    super(message);
    this.name = 'PortalTaskAuthorityError';
  }
}

export function assertValidTransition(from: PortalTaskStatus, to: PortalTaskStatus): void {
  if (!portalTaskTransitions[from].includes(to)) {
    throw new PortalTaskAuthorityError(`Cannot transition portal task from ${from} to ${to}.`, 'INVALID_TRANSITION');
  }
}
