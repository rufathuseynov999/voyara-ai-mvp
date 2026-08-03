import type { ActorKind } from '@/server/bos/contracts';

/**
 * Phase 3A Part 3 — quote lifecycle state machine.
 *
 * Bounded, explicit statuses with a guarded transition table. Invalid
 * transitions fail closed (the guard returns false and callers must throw).
 * Nothing here charges, verifies payment, or confirms a booking; the lifecycle
 * stops at PAYMENT_PENDING, and every commercial change routes back through the
 * Human Approval Gate via a new immutable version.
 */

export const quoteStatuses = [
  'DRAFT',
  'SEARCHED',
  'NORMALIZED',
  'PREPARED',
  'PENDING_HUMAN_REVIEW',
  'APPROVED',
  'PRESENTED',
  'CUSTOMER_ACCEPTED',
  'REVALIDATION_REQUIRED',
  'PAYMENT_PENDING',
  'PAYMENT_DETECTED',
  'PAYMENT_VERIFIED',
  // terminal / exception states
  'EXPIRED',
  'REJECTED',
  'PRICE_CHANGED',
  'SUPPLIER_UNAVAILABLE',
  'PAYMENT_FAILED',
  'PAYMENT_MISMATCH',
  'CANCELLED'
] as const;
export type QuoteStatus = (typeof quoteStatuses)[number];

export const terminalQuoteStatuses = [
  'EXPIRED',
  'REJECTED',
  'PRICE_CHANGED',
  'SUPPLIER_UNAVAILABLE',
  'PAYMENT_FAILED',
  'PAYMENT_MISMATCH',
  'CANCELLED'
] as const satisfies ReadonlyArray<QuoteStatus>;

export function isTerminalQuoteStatus(status: QuoteStatus): boolean {
  return (terminalQuoteStatuses as readonly QuoteStatus[]).includes(status);
}

/**
 * Allowed transitions. Any (from → to) pair not listed here is invalid and must
 * fail closed. CANCELLED is reachable from any non-terminal state. Exception
 * states are reachable from the points where they can actually occur.
 */
const allowedTransitions: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  DRAFT: ['SEARCHED', 'CANCELLED'],
  SEARCHED: ['NORMALIZED', 'SUPPLIER_UNAVAILABLE', 'CANCELLED'],
  NORMALIZED: ['PREPARED', 'SUPPLIER_UNAVAILABLE', 'CANCELLED'],
  PREPARED: ['PENDING_HUMAN_REVIEW', 'CANCELLED'],
  PENDING_HUMAN_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PRESENTED', 'REVALIDATION_REQUIRED', 'PRICE_CHANGED', 'SUPPLIER_UNAVAILABLE', 'EXPIRED', 'CANCELLED'],
  PRESENTED: ['CUSTOMER_ACCEPTED', 'REVALIDATION_REQUIRED', 'PRICE_CHANGED', 'SUPPLIER_UNAVAILABLE', 'EXPIRED', 'CANCELLED'],
  CUSTOMER_ACCEPTED: ['REVALIDATION_REQUIRED', 'PAYMENT_PENDING', 'PRICE_CHANGED', 'SUPPLIER_UNAVAILABLE', 'EXPIRED', 'CANCELLED'],
  REVALIDATION_REQUIRED: ['PENDING_HUMAN_REVIEW', 'PRICE_CHANGED', 'SUPPLIER_UNAVAILABLE', 'EXPIRED', 'CANCELLED'],
  PAYMENT_PENDING: ['PAYMENT_DETECTED', 'REVALIDATION_REQUIRED', 'SUPPLIER_UNAVAILABLE', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_DETECTED: ['PAYMENT_VERIFIED', 'PAYMENT_MISMATCH', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_VERIFIED: ['CANCELLED'],
  // terminal states have no outgoing transitions
  EXPIRED: [],
  REJECTED: [],
  PRICE_CHANGED: [],
  SUPPLIER_UNAVAILABLE: [],
  PAYMENT_FAILED: [],
  PAYMENT_MISMATCH: [],
  CANCELLED: []
};

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export class InvalidQuoteTransitionError extends Error {
  constructor(readonly from: QuoteStatus, readonly to: QuoteStatus) {
    super(`Invalid quote transition: ${from} → ${to}`);
    this.name = 'InvalidQuoteTransitionError';
  }
}

/** Assert a transition is valid, throwing (fail closed) otherwise. */
export function assertTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidQuoteTransitionError(from, to);
  }
}

/* ------------------------------- Audit events ---------------------------- */

export const quoteAuditEventKinds = [
  'QUOTE_CREATED',
  'QUOTE_VERSION_CREATED',
  'QUOTE_SUBMITTED_FOR_REVIEW',
  'QUOTE_APPROVED',
  'QUOTE_PRESENTED',
  'QUOTE_CUSTOMER_ACCEPTED',
  'QUOTE_REVALIDATION_STARTED',
  'QUOTE_REVALIDATION_UNCHANGED',
  'QUOTE_MATERIAL_CHANGE_DETECTED',
  'QUOTE_APPROVAL_INVALIDATED',
  'QUOTE_EXPIRED',
  'QUOTE_SUPPLIER_UNAVAILABLE'
] as const;
export type QuoteAuditEventKind = (typeof quoteAuditEventKinds)[number];

/** A non-sensitive audit record for quote lifecycle changes. Mirrors the
 *  existing CommandAuditEvent conventions (actor kind, occurredAt, no payload
 *  bodies — only hashes and identifiers). */
export type QuoteAuditEvent = {
  eventId: string;
  kind: QuoteAuditEventKind;
  quoteId: string;
  versionNumber: number;
  contentHash: string;
  actorId: string;
  actorKind: ActorKind;
  occurredAt: string;
  reasonCode?: string;
};
