import { randomUUID } from 'node:crypto';

/**
 * Phase 4G — sales automation.
 *
 * Every function in this file that "schedules" something only ever
 * creates a future SCHEDULED action record (mirroring `scheduled_actions`,
 * Migration 23) — it never sends a message, makes a commercial commitment,
 * or contacts a customer directly. Drafting a follow-up/reminder/
 * reactivation message produces a draft reference only, exactly like
 * `prepareOutboundDraft` in the journey executor — the actual send still
 * goes through the existing Level 2 (`completeLevel2Step`) or channel-
 * coordination (`sendCoordinatedReply`) paths, unchanged, elsewhere.
 *
 * Lead ownership is assigned deterministically and explainably — never a
 * black-box routing decision — reusing the same "named factors with
 * reasons" discipline already proven by `lead-scoring.ts`.
 */

export type SalesOwner = { ownerId: string; ownerKind: 'PERSONAL_SALES' | 'CORPORATE_SALES'; reason: string };

export type LeadOwnershipInput = {
  isCorporateAccount: boolean;
  requestedLanguage: 'az' | 'ru' | 'en';
  personalSalesOwnersByLanguage: Record<string, string>;
  corporateSalesOwnerId: string | null;
};

export class SalesAutomationError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NO_OWNER_AVAILABLE') {
    super(message);
    this.name = 'SalesAutomationError';
  }
}

export function assignLeadOwnership(input: LeadOwnershipInput): SalesOwner {
  if (input.isCorporateAccount) {
    if (!input.corporateSalesOwnerId) throw new SalesAutomationError('No corporate sales owner is configured.', 'NO_OWNER_AVAILABLE');
    return { ownerId: input.corporateSalesOwnerId, ownerKind: 'CORPORATE_SALES', reason: 'Corporate account — routed to corporate sales regardless of language.' };
  }
  const owner = input.personalSalesOwnersByLanguage[input.requestedLanguage];
  if (!owner) throw new SalesAutomationError(`No personal sales owner is configured for language "${input.requestedLanguage}".`, 'NO_OWNER_AVAILABLE');
  return { ownerId: owner, ownerKind: 'PERSONAL_SALES', reason: `Personal lead — routed to the ${input.requestedLanguage}-speaking sales owner.` };
}

export type ScheduledSalesAction = {
  actionId: string;
  actionCode: 'FOLLOW_UP' | 'REMINDER' | 'REACTIVATION' | 'SLA_ESCALATION';
  scheduledFor: string;
  leadId: string;
  reasonCode: string;
  correlationId: string;
};

export interface SalesAutomationStore {
  saveScheduledAction(action: ScheduledSalesAction): Promise<void>;
  loadScheduledActionsForLead(leadId: string): Promise<ScheduledSalesAction[]>;
  reserveDraftKey(key: string): Promise<{ winner: boolean }>;
}

export class InMemorySalesAutomationStore implements SalesAutomationStore {
  private readonly actions = new Map<string, ScheduledSalesAction[]>();
  private readonly draftKeys = new Set<string>();

  async saveScheduledAction(action: ScheduledSalesAction): Promise<void> {
    const existing = this.actions.get(action.leadId) ?? [];
    existing.push(action);
    this.actions.set(action.leadId, existing);
  }
  async loadScheduledActionsForLead(leadId: string): Promise<ScheduledSalesAction[]> { return this.actions.get(leadId) ?? []; }
  async reserveDraftKey(key: string): Promise<{ winner: boolean }> {
    if (this.draftKeys.has(key)) return { winner: false };
    this.draftKeys.add(key);
    return { winner: true };
  }
}

export type SalesAutomationContext = { store: SalesAutomationStore; correlationId: string; now: () => Date };

export const LEAD_FIRST_RESPONSE_SLA_MINUTES = 30;

export function computeLeadResponseDeadline(leadCreatedAt: string, slaMinutes: number = LEAD_FIRST_RESPONSE_SLA_MINUTES): string {
  return new Date(new Date(leadCreatedAt).getTime() + slaMinutes * 60 * 1000).toISOString();
}

export function isLeadPastSlaDeadline(leadCreatedAt: string, now: Date, respondedAt: string | null, slaMinutes: number = LEAD_FIRST_RESPONSE_SLA_MINUTES): boolean {
  if (respondedAt) return false;
  const deadline = new Date(computeLeadResponseDeadline(leadCreatedAt, slaMinutes)).getTime();
  return now.getTime() > deadline;
}

export async function scheduleFollowUp(
  ctx: SalesAutomationContext,
  leadId: string,
  scheduledFor: string,
  reasonCode: string,
  idempotencyKey: string
): Promise<{ actionId: string; created: boolean }> {
  const reservation = await ctx.store.reserveDraftKey(idempotencyKey);
  if (!reservation.winner) {
    const existing = await ctx.store.loadScheduledActionsForLead(leadId);
    const match = existing.find((a) => a.reasonCode === reasonCode && a.actionCode === 'FOLLOW_UP');
    return { actionId: match?.actionId ?? '', created: false };
  }
  const actionId = randomUUID();
  await ctx.store.saveScheduledAction({ actionId, actionCode: 'FOLLOW_UP', scheduledFor, leadId, reasonCode, correlationId: ctx.correlationId });
  return { actionId, created: true };
}

export async function scheduleReminder(ctx: SalesAutomationContext, leadId: string, scheduledFor: string, reasonCode: string): Promise<{ actionId: string }> {
  const actionId = randomUUID();
  await ctx.store.saveScheduledAction({ actionId, actionCode: 'REMINDER', scheduledFor, leadId, reasonCode, correlationId: ctx.correlationId });
  return { actionId };
}

export async function scheduleReactivation(ctx: SalesAutomationContext, leadId: string, lastActivityAt: string, dormancyDays: number, scheduledFor: string): Promise<{ actionId: string }> {
  const dormantSinceMs = ctx.now().getTime() - new Date(lastActivityAt).getTime();
  const dormancyThresholdMs = dormancyDays * 24 * 60 * 60 * 1000;
  if (dormantSinceMs < dormancyThresholdMs) {
    throw new SalesAutomationError(`Lead ${leadId} has not been dormant for ${dormancyDays} days — reactivation is not yet warranted.`, 'VALIDATION');
  }
  const actionId = randomUUID();
  await ctx.store.saveScheduledAction({ actionId, actionCode: 'REACTIVATION', scheduledFor, leadId, reasonCode: `DORMANT_${dormancyDays}D`, correlationId: ctx.correlationId });
  return { actionId };
}

export async function scheduleSlaEscalation(ctx: SalesAutomationContext, leadId: string, reasonCode: string): Promise<{ actionId: string }> {
  const actionId = randomUUID();
  await ctx.store.saveScheduledAction({ actionId, actionCode: 'SLA_ESCALATION', scheduledFor: ctx.now().toISOString(), leadId, reasonCode, correlationId: ctx.correlationId });
  return { actionId };
}
