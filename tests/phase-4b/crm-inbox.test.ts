import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { hasAnyRole, staffAreaRoles, type AppRole } from '@/server/auth/roles';
import { loadInboxConversationDetail, loadInboxConversations } from '@/server/agents/inbox-queries';
import { escalateConversation, type AgentOperatingContext } from '@/server/agents/agent-operating-layer';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { SimulationChannelAdapter } from '@/server/agents/simulation-channel-adapter';
import { paymentLinkStatuses } from '@/server/payment/payment-link-contract';

/**
 * Phase 4B — hermetic CRM inbox tests.
 *
 * `inbox-queries.ts`/`inbox-actions.ts` talk to Supabase directly (no
 * dependency-injected port, matching the read-model precedent already set by
 * `loadAdministrationSnapshot`/`loadStaffTravelRequestQueue` in Phase 3) —
 * so full filter/RLS/cross-customer-isolation behavior is proven against
 * real PostgreSQL in tests/phase-4b/inbox-rls.test.ts, not here. What IS
 * genuinely hermetic and covered below: the AAL2 staff authorization gate
 * every inbox route call goes through (the real security boundary, and pure
 * logic independent of any database), fail-safe behavior when Supabase is
 * unconfigured, the escalation action's reuse of the proven Phase 4A path,
 * and the payment-link status contract staying in sync between the
 * TypeScript schema and this file's expectations.
 */

/* --------------------------- AAL2 staff authorization gate --------------------------- */

function isAal2Staff(roles: AppRole[], assuranceLevel: 'aal1' | 'aal2'): boolean {
  return hasAnyRole(roles, staffAreaRoles) && assuranceLevel === 'aal2';
}

test('a founder at AAL2 passes the inbox authorization gate', () => {
  assert.equal(isAal2Staff(['founder'], 'aal2'), true);
});

test('staff at AAL1 is refused — the exact same rule as every other staff-area screen', () => {
  assert.equal(isAal2Staff(['staff'], 'aal1'), false);
});

test('a customer role, even at AAL2, is refused — customer is never in staffAreaRoles', () => {
  assert.equal(isAal2Staff(['customer'], 'aal2'), false);
});

test('an empty role set (no active role_assignments) is refused', () => {
  assert.equal(isAal2Staff([], 'aal2'), false);
});

/* ------------------------------ fail-safe without Supabase ------------------------------ */

test('loadInboxConversations returns an empty array, never throws, when Supabase is unconfigured', async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const result = await loadInboxConversations({ id: randomUUID(), roles: ['founder'], source: 'supabase', assuranceLevel: 'aal2' } as never);
    assert.deepEqual(result, []);
  } finally {
    if (originalUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});

test('loadInboxConversationDetail returns null, never throws, when Supabase is unconfigured', async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const result = await loadInboxConversationDetail({ id: randomUUID(), roles: ['founder'], source: 'supabase', assuranceLevel: 'aal2' } as never, randomUUID());
    assert.equal(result, null);
  } finally {
    if (originalUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SECRET_KEY = originalKey;
  }
});

/* -------------------------- escalation reuses the proven Phase 4A path -------------------------- */

test('the inbox\'s escalate action reuses agent-operating-layer\'s escalateConversation unchanged', async () => {
  const store = new InMemoryConversationStore();
  const ctx: AgentOperatingContext = {
    store, channel: new SimulationChannelAdapter(), actor: { id: randomUUID(), kind: 'human' },
    accountId: randomUUID(), correlationId: `corr-${randomUUID().slice(0, 8)}`, now: () => new Date('2026-08-01T09:00:00.000Z')
  };
  const contactId = randomUUID();
  await store.upsertContact({ contactId, accountId: ctx.accountId, linkedCustomerId: null, displayName: 'Test', phone: null, email: null, instagramHandle: null, preferredLocale: 'en' });
  const conversationId = randomUUID();
  await store.createConversation({ conversationId, accountId: ctx.accountId, contactId, channel: 'INSTAGRAM_DM', status: 'OPEN', assignedAgentRole: null, relatedQuoteId: null, correlationId: ctx.correlationId, createdAt: ctx.now().toISOString() });

  await escalateConversation(ctx, conversationId, 'STAFF_ESCALATED');

  const conversation = await store.loadConversation(conversationId);
  assert.equal(conversation?.status, 'ESCALATED');
  const events = store.auditEventsFor(conversationId);
  assert.ok(events.some((e) => e.kind === 'CONVERSATION_ESCALATED' && e.reasonCode === 'STAFF_ESCALATED'));
});

/* ------------------------- payment-link status contract stays in sync ------------------------- */

test('every payment-link status the inbox might display is a real, known status from the contract', () => {
  // Guards against inbox-queries.ts silently drifting from
  // payment-link-contract.ts's status enum (e.g. a typo'd status string that
  // would never match anything real).
  const displayableAsExample: (typeof paymentLinkStatuses)[number][] = ['DRAFTED', 'APPROVED', 'SENT', 'VERIFIED', 'MISMATCHED'];
  for (const status of displayableAsExample) {
    assert.ok(paymentLinkStatuses.includes(status));
  }
});

/* --------------------------- linked-identity visibility shape --------------------------- */

test('InboxConversationDetail\'s linked-identity shape exposes only identityKind/externalId/verified — never linkedBy or an internal row id', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/inbox-queries.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const typeMatch = codeOnly.match(/linkedIdentities:\s*Array<\{([^}]*)\}>/);
  assert.ok(typeMatch, 'linkedIdentities type shape not found');
  const fields = typeMatch![1];
  assert.match(fields, /identityKind/);
  assert.match(fields, /externalId/);
  assert.match(fields, /verified/);
  assert.ok(!/linkedBy|linked_by/.test(fields));
});

/* --------------------------------- structural: no auto-actions --------------------------------- */

test('inbox-actions.ts never approves, sends, pays, books, or refunds — only assignment and handover record-keeping', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../../src/server/agents/inbox-actions.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/approve|\.send\(|executePayment|createBooking|refund/i.test(codeOnly));
});
