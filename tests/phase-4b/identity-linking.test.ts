import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { autoLinkIdentity, humanConfirmMerge, reverseMerge, type IdentityLinkingContext } from '@/server/agents/identity-linking';
import { InMemoryIdentityStore } from '@/server/agents/in-memory-identity-store';
import { IdentityAuthorityError } from '@/server/agents/identity-contract';

const FIXED = new Date('2026-08-01T09:00:00.000Z');

function ctx(assuranceLevel: 'aal1' | 'aal2' = 'aal2'): IdentityLinkingContext & { store: InMemoryIdentityStore } {
  return {
    store: new InMemoryIdentityStore(),
    actor: { id: randomUUID(), assuranceLevel },
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    now: () => FIXED
  };
}

test('a verified phone auto-links without any human involved', async () => {
  const c = ctx();
  const contactId = randomUUID();
  const { linkedIdentityId } = await autoLinkIdentity(c, {
    contactId, identityKind: 'TELEPHONE', externalId: '+994501234567', linkedVia: 'AUTO_VERIFIED_PHONE', correlationId: c.correlationId
  });
  assert.ok(linkedIdentityId);
  const identities = await c.store.listIdentitiesForContact(contactId);
  assert.equal(identities.length, 1);
  assert.equal(identities[0].linkedBy, null);
  assert.equal(identities[0].verified, true);
});

test('re-linking the same verified identity to the same contact is an idempotent no-op', async () => {
  const c = ctx();
  const contactId = randomUUID();
  const first = await autoLinkIdentity(c, { contactId, identityKind: 'EMAIL', externalId: 'a@example.com', linkedVia: 'AUTO_VERIFIED_EMAIL', correlationId: c.correlationId });
  const second = await autoLinkIdentity(c, { contactId, identityKind: 'EMAIL', externalId: 'a@example.com', linkedVia: 'AUTO_VERIFIED_EMAIL', correlationId: c.correlationId });
  assert.equal(first.linkedIdentityId, second.linkedIdentityId);
});

test('auto-linking a verified identity already linked to a DIFFERENT contact is refused, not silently re-pointed', async () => {
  const c = ctx();
  const contactA = randomUUID();
  const contactB = randomUUID();
  await autoLinkIdentity(c, { contactId: contactA, identityKind: 'EMAIL', externalId: 'shared@example.com', linkedVia: 'AUTO_VERIFIED_EMAIL', correlationId: c.correlationId });
  await assert.rejects(
    () => autoLinkIdentity(c, { contactId: contactB, identityKind: 'EMAIL', externalId: 'shared@example.com', linkedVia: 'AUTO_VERIFIED_EMAIL', correlationId: c.correlationId }),
    (e: unknown) => e instanceof IdentityAuthorityError && e.code === 'DUPLICATE_IDENTITY'
  );
});

test('autoLinkRequestSchema has no HUMAN_CONFIRMED option at all — the type does not admit it', async () => {
  const c = ctx();
  await assert.rejects(
    () => autoLinkIdentity(c, {
      contactId: randomUUID(), identityKind: 'INSTAGRAM_RTRAVEL', externalId: 'x',
      linkedVia: 'HUMAN_CONFIRMED' as never, correlationId: c.correlationId
    }),
    (e: unknown) => e instanceof IdentityAuthorityError && e.code === 'VALIDATION'
  );
});

/* ------------------------------- human-confirmed merge ------------------------------ */

test('a merge requires AAL2 — an AAL1 actor is refused', async () => {
  const c = ctx('aal1');
  await assert.rejects(
    () => humanConfirmMerge(c, { fromContactId: randomUUID(), toContactId: randomUUID(), reason: 'same traveller', performedBy: c.actor.id, correlationId: c.correlationId }),
    (e: unknown) => e instanceof IdentityAuthorityError && e.code === 'NOT_AAL2'
  );
});

test('a merge cannot target the same contact on both sides', async () => {
  const c = ctx();
  const contactId = randomUUID();
  await assert.rejects(
    () => humanConfirmMerge(c, { fromContactId: contactId, toContactId: contactId, reason: 'x', performedBy: c.actor.id, correlationId: c.correlationId }),
    (e: unknown) => e instanceof IdentityAuthorityError && e.code === 'VALIDATION'
  );
});

test('performedBy must match the authenticated actor — cannot attribute a merge to someone else', async () => {
  const c = ctx();
  await assert.rejects(
    () => humanConfirmMerge(c, { fromContactId: randomUUID(), toContactId: randomUUID(), reason: 'x', performedBy: randomUUID(), correlationId: c.correlationId }),
    (e: unknown) => e instanceof IdentityAuthorityError && e.code === 'VALIDATION'
  );
});

test('an AAL2-confirmed merge is recorded as an immutable event', async () => {
  const c = ctx();
  const { mergeEventId } = await humanConfirmMerge(c, {
    fromContactId: randomUUID(), toContactId: randomUUID(), reason: 'Same traveller — confirmed by phone.', performedBy: c.actor.id, correlationId: c.correlationId
  });
  const event = await c.store.loadMergeEvent(mergeEventId);
  assert.ok(event);
  assert.equal(event?.reversedAt, null);
  assert.equal(event?.performedBy, c.actor.id);
});

test('a merge can be reversed by an AAL2 actor, and the reversal does not delete the original event', async () => {
  const c = ctx();
  const { mergeEventId } = await humanConfirmMerge(c, {
    fromContactId: randomUUID(), toContactId: randomUUID(), reason: 'x', performedBy: c.actor.id, correlationId: c.correlationId
  });
  await reverseMerge(c, mergeEventId);
  const event = await c.store.loadMergeEvent(mergeEventId);
  assert.ok(event?.reversedAt);
  assert.equal(event?.reversedBy, c.actor.id);
});

test('a merge cannot be reversed twice', async () => {
  const c = ctx();
  const { mergeEventId } = await humanConfirmMerge(c, {
    fromContactId: randomUUID(), toContactId: randomUUID(), reason: 'x', performedBy: c.actor.id, correlationId: c.correlationId
  });
  await reverseMerge(c, mergeEventId);
  await assert.rejects(() => reverseMerge(c, mergeEventId), (e: unknown) => e instanceof IdentityAuthorityError && e.code === 'ALREADY_REVERSED');
});

test('reversal also requires AAL2', async () => {
  const c = ctx();
  const { mergeEventId } = await humanConfirmMerge(c, {
    fromContactId: randomUUID(), toContactId: randomUUID(), reason: 'x', performedBy: c.actor.id, correlationId: c.correlationId
  });
  const aal1ctx = { ...c, actor: { id: c.actor.id, assuranceLevel: 'aal1' as const } };
  await assert.rejects(() => reverseMerge(aal1ctx, mergeEventId), (e: unknown) => e instanceof IdentityAuthorityError && e.code === 'NOT_AAL2');
});

/* -------------------- structural: never merges by name/username similarity -------------------- */

test('neither identity-contract.ts nor identity-linking.ts references displayName, name, or username as a linking/merge input', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['../../src/server/agents/identity-contract.ts', '../../src/server/agents/identity-linking.ts']) {
    const raw = await readFile(new URL(file, import.meta.url), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // Zod schema field names are the real surface area — confirm none of the
    // request/merge schemas has a displayName/name/username field.
    assert.ok(!/displayName:\s*z\.|username:\s*z\.|similarity/i.test(codeOnly));
  }
});
