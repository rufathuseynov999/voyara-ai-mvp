import { z } from 'zod';

/**
 * Phase 4B — canonical customer identity model.
 *
 * A `Contact` (Phase 4A) can accumulate multiple `LinkedIdentity` rows across
 * channels. The unique constraint on `(identityKind, externalId)` in the
 * migration is the real safety boundary — this contract mirrors it so
 * application code fails the same way the database would.
 *
 * Automatic linking is permitted ONLY for `AUTO_VERIFIED_PHONE`,
 * `AUTO_VERIFIED_EMAIL`, and `AUTO_AUTHENTICATED_WEBSITE` — every other case
 * requires `HUMAN_CONFIRMED`, which the type system makes impossible to
 * construct without a `linkedBy` actor id (see `linkedIdentitySchema`'s
 * refine) — matching the database's own
 * `linked_identities_human_confirmed_has_actor` CHECK constraint. Nothing in
 * this file allows linking or merging "by name/display name/username alone"
 * — those fields don't even appear as inputs to `autoLinkRequestSchema` or
 * `humanConfirmedMergeRequestSchema`.
 */

export const identityKinds = [
  'INSTAGRAM_RTRAVEL', 'INSTAGRAM_VOYARA', 'WHATSAPP', 'TELEPHONE', 'EMAIL', 'WEBSITE_ACCOUNT'
] as const;
export type IdentityKind = (typeof identityKinds)[number];

export const identityLinkMethods = [
  'AUTO_VERIFIED_PHONE', 'AUTO_VERIFIED_EMAIL', 'AUTO_AUTHENTICATED_WEBSITE', 'HUMAN_CONFIRMED'
] as const;
export type IdentityLinkMethod = (typeof identityLinkMethods)[number];

export const linkedIdentitySchema = z.object({
  linkedIdentityId: z.uuid(),
  contactId: z.uuid(),
  identityKind: z.enum(identityKinds),
  externalId: z.string().trim().min(1).max(320),
  verified: z.boolean(),
  linkedVia: z.enum(identityLinkMethods),
  linkedBy: z.uuid().nullable(),
  correlationId: z.string().min(1).max(128),
  linkedAt: z.iso.datetime()
}).strict().refine(
  (identity) => identity.linkedVia !== 'HUMAN_CONFIRMED' || identity.linkedBy !== null,
  { message: 'a HUMAN_CONFIRMED link must carry the confirming actor id' }
);
export type LinkedIdentity = z.infer<typeof linkedIdentitySchema>;

/** Input for an automatic link — only reachable for the three verified
 *  methods. There is no `HUMAN_CONFIRMED` option in this schema at all;
 *  that path only exists in `humanConfirmedMergeRequestSchema` below, which
 *  additionally requires an AAL2 actor at the service layer. */
export const autoLinkRequestSchema = z.object({
  contactId: z.uuid(),
  identityKind: z.enum(identityKinds),
  externalId: z.string().trim().min(1).max(320),
  linkedVia: z.enum(['AUTO_VERIFIED_PHONE', 'AUTO_VERIFIED_EMAIL', 'AUTO_AUTHENTICATED_WEBSITE']),
  correlationId: z.string().min(1).max(128)
}).strict();
export type AutoLinkRequest = z.infer<typeof autoLinkRequestSchema>;

/** A human-confirmed merge of two contacts (e.g. staff decides two Instagram
 *  threads and a phone number are the same traveller). Requires an AAL2
 *  actor at the service layer (checked in identity-linking.ts, not just
 *  here) and is always reversible — see `identity_merge_events.reversed_at`. */
export const humanConfirmedMergeRequestSchema = z.object({
  fromContactId: z.uuid(),
  toContactId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  performedBy: z.uuid(),
  correlationId: z.string().min(1).max(128)
}).strict().refine((r) => r.fromContactId !== r.toContactId, { message: 'cannot merge a contact into itself' });
export type HumanConfirmedMergeRequest = z.infer<typeof humanConfirmedMergeRequestSchema>;

export class IdentityAuthorityError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'NOT_AAL2' | 'DUPLICATE_IDENTITY' | 'NOT_FOUND' | 'ALREADY_REVERSED') {
    super(message);
    this.name = 'IdentityAuthorityError';
  }
}
