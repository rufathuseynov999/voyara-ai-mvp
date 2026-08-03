import type { LinkedIdentity } from './identity-contract';
import type { IdentityStore, MergeEventRecord } from './identity-store';

export class InMemoryIdentityStore implements IdentityStore {
  private readonly identities = new Map<string, LinkedIdentity>(); // key: `${kind}:${externalId}`
  private readonly mergeEvents = new Map<string, MergeEventRecord>();

  private key(kind: string, externalId: string): string {
    return `${kind}:${externalId}`;
  }

  async findByExternalId(identityKind: LinkedIdentity['identityKind'], externalId: string): Promise<LinkedIdentity | null> {
    return this.identities.get(this.key(identityKind, externalId)) ?? null;
  }

  async saveLinkedIdentity(identity: LinkedIdentity): Promise<void> {
    const key = this.key(identity.identityKind, identity.externalId);
    if (this.identities.has(key) && this.identities.get(key)!.linkedIdentityId !== identity.linkedIdentityId) {
      throw new Error('DUPLICATE_IDENTITY:23505');
    }
    this.identities.set(key, identity);
  }

  async listIdentitiesForContact(contactId: string): Promise<LinkedIdentity[]> {
    return [...this.identities.values()].filter((i) => i.contactId === contactId);
  }

  async recordMergeEvent(event: MergeEventRecord): Promise<void> {
    this.mergeEvents.set(event.mergeEventId, event);
  }

  async loadMergeEvent(mergeEventId: string): Promise<MergeEventRecord | null> {
    return this.mergeEvents.get(mergeEventId) ?? null;
  }

  async reverseMergeEvent(mergeEventId: string, reversedBy: string, reversedAt: string): Promise<void> {
    const existing = this.mergeEvents.get(mergeEventId);
    if (!existing) throw new Error('MERGE_EVENT_NOT_FOUND');
    this.mergeEvents.set(mergeEventId, { ...existing, reversedAt, reversedBy });
  }

  /** Test helper. */
  countIdentities(): number {
    return this.identities.size;
  }
}
