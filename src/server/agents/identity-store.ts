import type { LinkedIdentity } from './identity-contract';

/** Phase 4B — identity store port. Mirrors ConversationStore's design. */
export interface IdentityStore {
  findByExternalId(identityKind: LinkedIdentity['identityKind'], externalId: string): Promise<LinkedIdentity | null>;
  saveLinkedIdentity(identity: LinkedIdentity): Promise<void>;
  listIdentitiesForContact(contactId: string): Promise<LinkedIdentity[]>;
  recordMergeEvent(event: MergeEventRecord): Promise<void>;
  loadMergeEvent(mergeEventId: string): Promise<MergeEventRecord | null>;
  reverseMergeEvent(mergeEventId: string, reversedBy: string, reversedAt: string): Promise<void>;
}

export type MergeEventRecord = {
  mergeEventId: string;
  fromContactId: string;
  toContactId: string;
  reason: string;
  performedBy: string;
  correlationId: string;
  performedAt: string;
  reversedAt: string | null;
  reversedBy: string | null;
};
