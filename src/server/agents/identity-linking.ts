import { randomUUID } from 'node:crypto';
import {
  autoLinkRequestSchema,
  humanConfirmedMergeRequestSchema,
  IdentityAuthorityError,
  type AutoLinkRequest,
  type HumanConfirmedMergeRequest,
  type LinkedIdentity
} from './identity-contract';
import type { IdentityStore, MergeEventRecord } from './identity-store';

/**
 * Phase 4B — identity linking service.
 *
 * Two paths, deliberately asymmetric:
 *   1. `autoLinkIdentity` — only for a verified phone, verified email, or an
 *      already-authenticated website session. No human is involved because
 *      none is needed: the channel itself already proved the identity.
 *   2. `humanConfirmMerge` — everything else. Requires the acting viewer to
 *      be AAL2 staff (checked here, not just trusted from the caller), is
 *      recorded as an immutable event, and can be reversed later (also only
 *      by an AAL2 actor) without deleting the original record.
 *
 * There is no third path. Nothing in this file, or in identity-contract.ts,
 * accepts a "confidence score," "similarity," "display name match," or any
 * other fuzzy signal as a basis for linking. Two identities either arrive
 * pre-verified by their channel, or a human explicitly confirms them.
 */

export type IdentityLinkingContext = {
  store: IdentityStore;
  actor: { id: string; assuranceLevel: 'aal1' | 'aal2' };
  correlationId: string;
  now: () => Date;
};

export async function autoLinkIdentity(ctx: IdentityLinkingContext, input: AutoLinkRequest): Promise<{ linkedIdentityId: string }> {
  const parsed = autoLinkRequestSchema.safeParse(input);
  if (!parsed.success) throw new IdentityAuthorityError('Invalid auto-link request.', 'VALIDATION');

  const existing = await ctx.store.findByExternalId(parsed.data.identityKind, parsed.data.externalId);
  if (existing && existing.contactId !== parsed.data.contactId) {
    throw new IdentityAuthorityError(
      'This external identity is already linked to a different contact — use humanConfirmMerge to reconcile it, never a silent re-link.',
      'DUPLICATE_IDENTITY'
    );
  }
  if (existing) return { linkedIdentityId: existing.linkedIdentityId }; // already linked to the same contact — idempotent no-op

  const linkedIdentityId = randomUUID();
  const identity: LinkedIdentity = {
    linkedIdentityId,
    contactId: parsed.data.contactId,
    identityKind: parsed.data.identityKind,
    externalId: parsed.data.externalId,
    verified: true,
    linkedVia: parsed.data.linkedVia,
    linkedBy: null,
    correlationId: parsed.data.correlationId,
    linkedAt: ctx.now().toISOString()
  };
  await ctx.store.saveLinkedIdentity(identity);
  return { linkedIdentityId };
}

/** Records a human-confirmed merge. Requires AAL2. Always reversible. Never
 *  deletes or overwrites the identities of either contact — a merge is a
 *  business decision about which contact record is canonical going forward,
 *  recorded as its own auditable event, not a destructive rewrite. */
export async function humanConfirmMerge(ctx: IdentityLinkingContext, input: HumanConfirmedMergeRequest): Promise<{ mergeEventId: string }> {
  if (ctx.actor.assuranceLevel !== 'aal2') {
    throw new IdentityAuthorityError('Identity merges require an AAL2-authenticated staff actor.', 'NOT_AAL2');
  }
  const parsed = humanConfirmedMergeRequestSchema.safeParse(input);
  if (!parsed.success) throw new IdentityAuthorityError('Invalid merge request.', 'VALIDATION');
  if (parsed.data.performedBy !== ctx.actor.id) {
    throw new IdentityAuthorityError('performedBy must match the authenticated actor.', 'VALIDATION');
  }

  const mergeEventId = randomUUID();
  const event: MergeEventRecord = {
    mergeEventId,
    fromContactId: parsed.data.fromContactId,
    toContactId: parsed.data.toContactId,
    reason: parsed.data.reason,
    performedBy: parsed.data.performedBy,
    correlationId: parsed.data.correlationId,
    performedAt: ctx.now().toISOString(),
    reversedAt: null,
    reversedBy: null
  };
  await ctx.store.recordMergeEvent(event);
  return { mergeEventId };
}

export async function reverseMerge(ctx: IdentityLinkingContext, mergeEventId: string): Promise<void> {
  if (ctx.actor.assuranceLevel !== 'aal2') {
    throw new IdentityAuthorityError('Reversing a merge requires an AAL2-authenticated staff actor.', 'NOT_AAL2');
  }
  const event = await ctx.store.loadMergeEvent(mergeEventId);
  if (!event) throw new IdentityAuthorityError('Merge event not found.', 'NOT_FOUND');
  if (event.reversedAt) throw new IdentityAuthorityError('This merge was already reversed.', 'ALREADY_REVERSED');
  await ctx.store.reverseMergeEvent(mergeEventId, ctx.actor.id, ctx.now().toISOString());
}
