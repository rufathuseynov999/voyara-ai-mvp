import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { acceptLeadOwnership, LeadOwnerAcceptanceError, type LeadOwnerAcceptanceContext } from '@/server/agents/automation/lead-owner-acceptance';
import { InMemoryAutomationStore } from '@/server/agents/automation/automation-store';
import { activateEmergencyStop, pauseGlobal, pauseWorkflow } from '@/server/agents/automation/automation-service';
import { AutomationAuthorityError } from '@/server/agents/automation/automation-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

class CombinedStore extends InMemoryAutomationStore {
  private readonly workingHoursFeatureFlags = new Map<string, { flagCode: string; enabled: boolean }>();
  private readonly leadOwners = new Map<string, { assignedOwnerId: string | null; accountId: string | null; corporateAccountId: string | null }>();
  private readonly acceptanceIdempotencyKeys = new Map<string, string>();
  private readonly acceptanceEvents: Array<{ eventId: string; conversationId: string; actorId: string; reasonCode: string }> = [];

  async loadWorkingHoursPolicy() { return null; }
  async saveWorkingHoursPolicy() { /* unused */ }
  async findActiveWorkingHoursPolicyByCode() { return null; }
  async loadFeatureFlag(flagCode: string) { return this.workingHoursFeatureFlags.get(flagCode) ?? null; }
  async saveFeatureFlag(flag: { flagCode: string; enabled: boolean }) { this.workingHoursFeatureFlags.set(flag.flagCode, flag); }
  async recordFounderControlEvent() { /* unused */ }

  seedOwner(conversationId: string, context: { assignedOwnerId: string | null; accountId: string | null; corporateAccountId: string | null }): void {
    this.leadOwners.set(conversationId, context);
  }
  async loadConversationOwner(conversationId: string) { return this.leadOwners.get(conversationId) ?? null; }
  async reserveAcceptanceIdempotencyKey(key: string, resultId: string): Promise<{ winner: boolean; resultId: string }> {
    const existing = this.acceptanceIdempotencyKeys.get(key);
    if (existing) return { winner: false, resultId: existing };
    this.acceptanceIdempotencyKeys.set(key, resultId);
    return { winner: true, resultId };
  }
  async recordAcceptanceEvent(event: { eventId: string; conversationId: string; actorId: string; reasonCode: string }): Promise<void> {
    this.acceptanceEvents.push(event);
  }
  eventsFor(conversationId: string) { return this.acceptanceEvents.filter((e) => e.conversationId === conversationId); }
}

function ctx(): LeadOwnerAcceptanceContext & { store: CombinedStore } {
  const store = new CombinedStore();
  return { store, correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => FIXED };
}

test('the currently assigned owner can accept their own lead', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const owner = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: owner, accountId: randomUUID(), corporateAccountId: null });
  const result = await acceptLeadOwnership(c, { conversationId, acceptingActorId: owner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`);
  assert.equal(result.accepted, true);
});

test('a different actor than the currently assigned owner is refused', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const realOwner = randomUUID();
  const impersonator = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: realOwner, accountId: randomUUID(), corporateAccountId: null });
  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId, acceptingActorId: impersonator, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof LeadOwnerAcceptanceError && e.code === 'WRONG_OWNER'
  );
});

test('acceptance is refused when no owner is assigned yet', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: null, accountId: randomUUID(), corporateAccountId: null });
  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId, acceptingActorId: randomUUID(), slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof LeadOwnerAcceptanceError && e.code === 'NO_OWNER_ASSIGNED'
  );
});

test('acceptance requires a real human actor — an empty actor id is refused', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: randomUUID(), accountId: randomUUID(), corporateAccountId: null });
  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId, acceptingActorId: '', slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof LeadOwnerAcceptanceError && e.code === 'MISSING_APPROVAL'
  );
});

test('a retried acceptance with the same idempotency key never records a second acceptance event', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const owner = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: owner, accountId: randomUUID(), corporateAccountId: null });
  const idempotencyKey = `idem-${randomUUID()}`;
  const first = await acceptLeadOwnership(c, { conversationId, acceptingActorId: owner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, idempotencyKey);
  const second = await acceptLeadOwnership(c, { conversationId, acceptingActorId: owner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, idempotencyKey);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(first.acceptanceEventId, second.acceptanceEventId);
  assert.equal(c.store.eventsFor(conversationId).length, 1);
});

test('after reassignment, the original owner can no longer accept — acceptance always re-checks the CURRENT owner', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const originalOwner = randomUUID();
  const newOwner = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: originalOwner, accountId: randomUUID(), corporateAccountId: null });

  c.store.seedOwner(conversationId, { assignedOwnerId: newOwner, accountId: randomUUID(), corporateAccountId: null });

  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId, acceptingActorId: originalOwner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof LeadOwnerAcceptanceError && e.code === 'WRONG_OWNER'
  );
  const result = await acceptLeadOwnership(c, { conversationId, acceptingActorId: newOwner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`);
  assert.equal(result.accepted, true);
});

test('emergency stop blocks lead-owner acceptance entirely, even for the genuinely correct owner', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const owner = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: owner, accountId: randomUUID(), corporateAccountId: null });
  await activateEmergencyStop(c, randomUUID(), 'INCIDENT');
  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId, acceptingActorId: owner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'EMERGENCY_STOP_ACTIVE'
  );
});

test('a paused customer.journey.v1 workflow blocks lead-owner acceptance', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const owner = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: owner, accountId: randomUUID(), corporateAccountId: null });
  await pauseWorkflow(c, 'customer.journey.v1', randomUUID(), 'MAINTENANCE');
  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId, acceptingActorId: owner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'AGENT_PAUSED'
  );
});

test('global pause blocks lead-owner acceptance', async () => {
  const c = ctx();
  const conversationId = randomUUID();
  const owner = randomUUID();
  c.store.seedOwner(conversationId, { assignedOwnerId: owner, accountId: randomUUID(), corporateAccountId: null });
  await pauseGlobal(c, randomUUID(), 'MAINTENANCE');
  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId, acceptingActorId: owner, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof AutomationAuthorityError && e.code === 'GLOBALLY_PAUSED'
  );
});

test('acceptance on one conversation never affects another conversation\'s owner state', async () => {
  const c = ctx();
  const conversationA = randomUUID();
  const conversationB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  c.store.seedOwner(conversationA, { assignedOwnerId: ownerA, accountId: randomUUID(), corporateAccountId: null });
  c.store.seedOwner(conversationB, { assignedOwnerId: ownerB, accountId: randomUUID(), corporateAccountId: null });

  await acceptLeadOwnership(c, { conversationId: conversationA, acceptingActorId: ownerA, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`);
  await assert.rejects(
    () => acceptLeadOwnership(c, { conversationId: conversationB, acceptingActorId: ownerA, slaDeadline: FIXED.toISOString(), causationId: null, agentCode: null }, `idem-${randomUUID()}`),
    (e: unknown) => e instanceof LeadOwnerAcceptanceError && e.code === 'WRONG_OWNER'
  );
});
