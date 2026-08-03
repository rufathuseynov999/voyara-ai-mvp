import { randomUUID } from 'node:crypto';
import { checkAutomationGateExtended, type FounderControlContext } from './founder-controls';
import type { AutomationContext } from './automation-service';

/**
 * Phase 4G — explicit lead-owner acceptance.
 *
 * A "lead" in this codebase is a conversation (there is no separate leads
 * table — confirmed by inspecting inbox-actions.ts, inbox-queries.ts, and
 * the Phase 4B conversations schema before writing this file).
 * `conversations.assigned_owner_id` already carries assignment
 * (`assignConversation`, Phase 4B); this module adds a genuinely DISTINCT
 * action — acceptance — reusing the existing `agent_audit_events` table
 * for the immutable record, exactly the same table `assignConversation`
 * and `setHandoverStatus` already write to. No new table or migration is
 * needed: assignment and acceptance are two different real audit-event
 * kinds on the same conversation, and the current `assigned_owner_id`
 * value is itself the authority for "who is allowed to accept right now."
 *
 * "Reassignment invalidates an unaccepted prior assignment" falls out
 * structurally, not from a special-case: acceptance always re-checks the
 * conversation's CURRENT `assigned_owner_id` at the moment of the accept
 * call, never a value captured earlier — if the conversation has been
 * reassigned to someone else, the original owner's `assignedOwnerId`
 * comparison simply fails.
 */

export type LeadOwnerContext = { assignedOwnerId: string | null; accountId: string | null; corporateAccountId: string | null };

export interface LeadOwnerAcceptanceStore {
  loadConversationOwner(conversationId: string): Promise<LeadOwnerContext | null>;
  reserveAcceptanceIdempotencyKey(key: string, resultId: string): Promise<{ winner: boolean; resultId: string }>;
  recordAcceptanceEvent(event: { eventId: string; conversationId: string; actorId: string; correlationId: string; causationId: string | null; reasonCode: string }): Promise<void>;
}

export class InMemoryLeadOwnerAcceptanceStore implements LeadOwnerAcceptanceStore {
  private readonly owners = new Map<string, LeadOwnerContext>();
  private readonly idempotencyKeys = new Map<string, string>();
  private readonly events: Array<{ eventId: string; conversationId: string; actorId: string; reasonCode: string }> = [];

  seedOwner(conversationId: string, context: LeadOwnerContext): void { this.owners.set(conversationId, context); }
  async loadConversationOwner(conversationId: string): Promise<LeadOwnerContext | null> { return this.owners.get(conversationId) ?? null; }
  async reserveAcceptanceIdempotencyKey(key: string, resultId: string): Promise<{ winner: boolean; resultId: string }> {
    const existing = this.idempotencyKeys.get(key);
    if (existing) return { winner: false, resultId: existing };
    this.idempotencyKeys.set(key, resultId);
    return { winner: true, resultId };
  }
  async recordAcceptanceEvent(event: { eventId: string; conversationId: string; actorId: string; reasonCode: string }): Promise<void> {
    this.events.push(event);
  }
  eventsFor(conversationId: string) { return this.events.filter((e) => e.conversationId === conversationId); }
}

export type LeadOwnerAcceptanceContext = AutomationContext & FounderControlContext & { store: LeadOwnerAcceptanceStore };

export class LeadOwnerAcceptanceError extends Error {
  constructor(message: string, readonly code: 'MISSING_APPROVAL' | 'NOT_FOUND' | 'WRONG_OWNER' | 'NO_OWNER_ASSIGNED') {
    super(message);
    this.name = 'LeadOwnerAcceptanceError';
  }
}

export async function acceptLeadOwnership(
  ctx: LeadOwnerAcceptanceContext,
  input: { conversationId: string; acceptingActorId: string; slaDeadline: string; causationId: string | null; agentCode: string | null },
  idempotencyKey: string
): Promise<{ accepted: boolean; acceptanceEventId: string }> {
  if (!input.acceptingActorId) {
    throw new LeadOwnerAcceptanceError('A real human staff actor is required to accept a lead assignment.', 'MISSING_APPROVAL');
  }

  await checkAutomationGateExtended(ctx, {
    agentCode: input.agentCode, channel: null, workflowCode: 'customer.journey.v1',
    workingHoursPolicyCode: null, requiredFeatureFlag: null, level1PolicyCode: null
  });

  const owner = await ctx.store.loadConversationOwner(input.conversationId);
  if (!owner) throw new LeadOwnerAcceptanceError('Conversation not found.', 'NOT_FOUND');
  if (!owner.assignedOwnerId) throw new LeadOwnerAcceptanceError('This conversation has no assigned owner yet — nothing to accept.', 'NO_OWNER_ASSIGNED');
  if (owner.assignedOwnerId !== input.acceptingActorId) {
    throw new LeadOwnerAcceptanceError(
      `Only the currently assigned owner (${owner.assignedOwnerId}) may accept this lead — "${input.acceptingActorId}" is not the current owner (possibly due to reassignment).`,
      'WRONG_OWNER'
    );
  }

  const proposedEventId = randomUUID();
  const reservation = await ctx.store.reserveAcceptanceIdempotencyKey(idempotencyKey, proposedEventId);
  if (!reservation.winner) return { accepted: false, acceptanceEventId: reservation.resultId };

  await ctx.store.recordAcceptanceEvent({
    eventId: proposedEventId, conversationId: input.conversationId, actorId: input.acceptingActorId,
    correlationId: ctx.correlationId, causationId: input.causationId, reasonCode: `SLA_DEADLINE:${input.slaDeadline}`
  });
  return { accepted: true, acceptanceEventId: proposedEventId };
}
