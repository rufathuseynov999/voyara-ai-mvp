import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  approveAndSendMessage,
  approveMessage,
  draftAgentMessage,
  escalateConversation,
  rejectMessage,
  startConversation,
  type AgentOperatingContext
} from '@/server/agents/agent-operating-layer';
import { InMemoryConversationStore } from '@/server/agents/in-memory-conversation-store';
import { SimulationChannelAdapter } from '@/server/agents/simulation-channel-adapter';
import { createChannelAdapter, ChannelAdapterError } from '@/server/agents/channel-registry';
import { AgentAuthorityError } from '@/server/agents/agent-contract';

/**
 * Phase 4A — hermetic Agent Operating Layer tests. No database, no network.
 */

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(actorKind: 'human' | 'agent' | 'system' = 'human'): AgentOperatingContext & { store: InMemoryConversationStore } {
  return {
    store: new InMemoryConversationStore(),
    channel: new SimulationChannelAdapter(),
    actor: { id: randomUUID(), kind: actorKind },
    accountId: randomUUID(),
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    now: () => FIXED
  };
}

async function draftedConversation(c: ReturnType<typeof ctx>) {
  const contactId = randomUUID();
  await c.store.upsertContact({ contactId, accountId: c.accountId, linkedCustomerId: null, displayName: 'Test Contact', phone: null, email: null, instagramHandle: null, preferredLocale: 'en' });
  const { conversationId } = await startConversation(c, { contactId, channel: 'SIMULATION' });
  const { messageId } = await draftAgentMessage(c, {
    conversationId, agentRole: 'sales', body: 'Hello! Would you like a Baku city tour?', requiresHumanApproval: true, correlationId: c.correlationId
  });
  return { conversationId, messageId };
}

/* --------------------------- draft requires approval -------------------------- */

test('an AI agent can only ever DRAFT a message, never send it directly', async () => {
  const c = ctx();
  const { conversationId, messageId } = await draftedConversation(c);
  const message = await c.store.loadMessage(messageId);
  assert.equal(message?.status, 'DRAFTED');
  assert.equal(message?.requiresHumanApproval, true);
  assert.equal(message?.sentAt, null);
  const conversation = await c.store.loadConversation(conversationId);
  assert.equal(conversation?.status, 'PENDING_HUMAN');
});

test('agentDraftSchema rejects any attempt to construct a draft with requiresHumanApproval other than true', async () => {
  const c = ctx();
  const { conversationId } = await draftedConversation(c);
  await assert.rejects(
    () => draftAgentMessage(c, { conversationId, agentRole: 'sales', body: 'x', requiresHumanApproval: false as unknown as true, correlationId: c.correlationId }),
    (e: unknown) => e instanceof AgentAuthorityError && e.code === 'VALIDATION'
  );
});

test('an agent cannot draft as "human_staff" — that role is excluded from AgentDraft', async () => {
  const c = ctx();
  const { conversationId } = await draftedConversation(c);
  await assert.rejects(
    () => draftAgentMessage(c, { conversationId, agentRole: 'human_staff' as never, body: 'x', requiresHumanApproval: true, correlationId: c.correlationId }),
    (e: unknown) => e instanceof AgentAuthorityError && e.code === 'VALIDATION'
  );
});

/* ------------------------------ human approval gate ---------------------------- */

test('a non-human actor cannot approve a message', async () => {
  const c = ctx();
  const { messageId } = await draftedConversation(c);
  const message = await c.store.loadMessage(messageId);
  const agentCtx = { ...c, actor: { id: randomUUID(), kind: 'agent' as const } };
  await assert.rejects(
    () => approveMessage(agentCtx, messageId, message!.contentHash),
    (e: unknown) => e instanceof AgentAuthorityError && e.code === 'VALIDATION'
  );
});

test('a stale content hash is rejected — exact same discipline as quote approval', async () => {
  const c = ctx();
  const { messageId } = await draftedConversation(c);
  await assert.rejects(
    () => approveMessage(c, messageId, 'f'.repeat(64)),
    (e: unknown) => e instanceof AgentAuthorityError && e.code === 'STALE_CONTENT_HASH'
  );
});

test('approval by the exact content hash succeeds and records the human approver', async () => {
  const c = ctx();
  const { messageId } = await draftedConversation(c);
  const message = await c.store.loadMessage(messageId);
  await approveMessage(c, messageId, message!.contentHash);
  const approved = await c.store.loadMessage(messageId);
  assert.equal(approved?.status, 'APPROVED');
  assert.equal(approved?.approvedBy, c.actor.id);
  assert.ok(approved?.approvedAt);
});

test('a message cannot be approved twice', async () => {
  const c = ctx();
  const { messageId } = await draftedConversation(c);
  const message = await c.store.loadMessage(messageId);
  await approveMessage(c, messageId, message!.contentHash);
  await assert.rejects(
    () => approveMessage(c, messageId, message!.contentHash),
    (e: unknown) => e instanceof AgentAuthorityError && e.code === 'ALREADY_APPROVED'
  );
});

test('rejection is human-only and moves the message to REJECTED, never SENT', async () => {
  const c = ctx();
  const { messageId } = await draftedConversation(c);
  await rejectMessage(c, messageId, 'OFF_BRAND_TONE');
  const rejected = await c.store.loadMessage(messageId);
  assert.equal(rejected?.status, 'REJECTED');
  assert.equal(rejected?.sentAt, null);
});

/* --------------------------- send only after approval -------------------------- */

test('sending throws for a DRAFTED (unapproved) message rather than silently sending', async () => {
  const c = ctx();
  const { messageId } = await draftedConversation(c);
  await assert.rejects(
    () => approveAndSendMessage(c, messageId, '+994000000000'),
    (e: unknown) => e instanceof AgentAuthorityError && e.code === 'VALIDATION'
  );
  const message = await c.store.loadMessage(messageId);
  assert.equal(message?.status, 'DRAFTED');
});

test('sending succeeds only after human approval, and records who approved and when it was sent', async () => {
  const c = ctx();
  const { messageId } = await draftedConversation(c);
  const draft = await c.store.loadMessage(messageId);
  await approveMessage(c, messageId, draft!.contentHash);
  const result = await approveAndSendMessage(c, messageId, '+994000000000');
  assert.equal(result.sent, true);
  const sent = await c.store.loadMessage(messageId);
  assert.equal(sent?.status, 'SENT');
  assert.ok(sent?.sentAt);
  assert.equal(sent?.approvedBy, c.actor.id);
});

/* ------------------------------------ audit trail ------------------------------ */

test('every step of the draft-approve-send lifecycle writes an audit event', async () => {
  const c = ctx();
  const { conversationId, messageId } = await draftedConversation(c);
  const draft = await c.store.loadMessage(messageId);
  await approveMessage(c, messageId, draft!.contentHash);
  await approveAndSendMessage(c, messageId, '+994000000000');
  const events = c.store.auditEventsFor(conversationId);
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes('CONVERSATION_STARTED'));
  assert.ok(kinds.includes('MESSAGE_DRAFTED'));
  assert.ok(kinds.includes('MESSAGE_APPROVED'));
  assert.ok(kinds.includes('MESSAGE_SENT'));
});

test('escalation records an audit event and moves conversation status', async () => {
  const c = ctx();
  const { conversationId } = await draftedConversation(c);
  await escalateConversation(c, conversationId, 'CUSTOMER_REQUESTED_HUMAN');
  const conversation = await c.store.loadConversation(conversationId);
  assert.equal(conversation?.status, 'ESCALATED');
  const events = c.store.auditEventsFor(conversationId);
  assert.ok(events.some((e) => e.kind === 'CONVERSATION_ESCALATED' && e.reasonCode === 'CUSTOMER_REQUESTED_HUMAN'));
});

/* ------------------------- structural: no autonomous send path ------------------ */

test('no function outside approveAndSendMessage references the ChannelAdapter (structural, comments stripped)', async () => {
  const raw = await readFile(new URL('../../src/server/agents/agent-operating-layer.ts', import.meta.url), 'utf8');
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const functionBlocks = codeOnly.split(/^export async function /m).slice(1);
  for (const block of functionBlocks) {
    const name = block.split('(')[0];
    const usesChannel = /ctx\.channel\./.test(block);
    if (name === 'approveAndSendMessage') {
      assert.ok(usesChannel, 'approveAndSendMessage must call the channel adapter');
    } else {
      assert.ok(!usesChannel, `${name} must never call the channel adapter`);
    }
  }
});

/* ------------------------------- channel registry fail-closed ------------------- */

test('SIMULATION mode loads only the SIMULATION channel', () => {
  const adapter = createChannelAdapter('SIMULATION', 'SIMULATION');
  assert.equal(adapter.mode, 'SIMULATION');
  assert.equal(adapter.simulated, true);
});

test('requesting a non-simulation channel in SIMULATION mode fails closed', () => {
  assert.throws(
    () => createChannelAdapter('WHATSAPP', 'SIMULATION'),
    (e: unknown) => e instanceof ChannelAdapterError && e.code === 'UNSUPPORTED_CHANNEL'
  );
});

test('SANDBOX mode fails closed for every channel without credentials — WhatsApp and Instagram report CREDENTIALS_MISSING (Phase 4C / Phase 4H), voice/web-chat/email remain genuinely unsupported', () => {
  delete process.env.VOYARA_WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.VOYARA_WHATSAPP_WABA_ID;
  delete process.env.VOYARA_WHATSAPP_ACCESS_TOKEN;
  delete process.env.VOYARA_WHATSAPP_APP_SECRET;
  delete process.env.VOYARA_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  delete process.env.VOYARA_META_APP_ID;
  delete process.env.VOYARA_META_APP_SECRET;
  delete process.env.VOYARA_INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  delete process.env.VOYARA_INSTAGRAM_CALLBACK_URL;

  assert.throws(
    () => createChannelAdapter('WHATSAPP', 'SANDBOX'),
    (e: unknown) => e instanceof ChannelAdapterError && e.code === 'CREDENTIALS_MISSING'
  );
  // Phase 4H: Instagram is now a genuinely supported SANDBOX channel, but
  // still fails closed exactly like WhatsApp when no credentials (and no
  // brand) are provided — it is not in the "unsupported" list below.
  assert.throws(
    () => createChannelAdapter('INSTAGRAM_DM', 'SANDBOX'),
    (e: unknown) => e instanceof ChannelAdapterError && e.code === 'CREDENTIALS_MISSING'
  );
  for (const channel of ['VOICE', 'WEB_CHAT', 'EMAIL'] as const) {
    assert.throws(
      () => createChannelAdapter(channel, 'SANDBOX'),
      (e: unknown) => e instanceof ChannelAdapterError && e.code === 'UNSUPPORTED_CHANNEL'
    );
  }
});

test('LIVE mode is never available for any channel', () => {
  for (const channel of ['WHATSAPP', 'INSTAGRAM_DM', 'VOICE', 'WEB_CHAT', 'EMAIL', 'SIMULATION'] as const) {
    assert.throws(
      () => createChannelAdapter(channel, 'LIVE'),
      (e: unknown) => e instanceof ChannelAdapterError && e.code === 'LIVE_NOT_AVAILABLE'
    );
  }
});
