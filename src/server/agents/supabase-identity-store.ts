import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { LinkedIdentity } from './identity-contract';
import type { IdentityStore, MergeEventRecord } from './identity-store';

export class SupabaseIdentityStore implements IdentityStore {
  private admin() {
    const client = createAdminSupabaseClient();
    if (!client) throw new Error('IDENTITY_STORE_UNAVAILABLE: Supabase admin client is not configured.');
    return client;
  }

  async findByExternalId(identityKind: LinkedIdentity['identityKind'], externalId: string): Promise<LinkedIdentity | null> {
    const { data, error } = await this.admin()
      .from('linked_identities')
      .select('*')
      .eq('identity_kind', identityKind)
      .eq('external_id', externalId)
      .maybeSingle();
    if (error) throw new Error(`IDENTITY_READ_FAILED:${error.code}`);
    if (!data) return null;
    return this.mapRow(data);
  }

  async saveLinkedIdentity(identity: LinkedIdentity): Promise<void> {
    const { error } = await this.admin().from('linked_identities').insert({
      id: identity.linkedIdentityId,
      contact_id: identity.contactId,
      identity_kind: identity.identityKind,
      external_id: identity.externalId,
      verified: identity.verified,
      linked_via: identity.linkedVia,
      linked_by: identity.linkedBy,
      correlation_id: identity.correlationId,
      linked_at: identity.linkedAt
    });
    if (error) throw new Error(`IDENTITY_WRITE_FAILED:${error.code}`);
  }

  async listIdentitiesForContact(contactId: string): Promise<LinkedIdentity[]> {
    const { data, error } = await this.admin().from('linked_identities').select('*').eq('contact_id', contactId);
    if (error) throw new Error(`IDENTITY_READ_FAILED:${error.code}`);
    return (data ?? []).map((row) => this.mapRow(row));
  }

  async recordMergeEvent(event: MergeEventRecord): Promise<void> {
    const { error } = await this.admin().from('identity_merge_events').insert({
      id: event.mergeEventId,
      from_contact_id: event.fromContactId,
      to_contact_id: event.toContactId,
      reason: event.reason,
      performed_by: event.performedBy,
      correlation_id: event.correlationId,
      performed_at: event.performedAt
    });
    if (error) throw new Error(`MERGE_EVENT_WRITE_FAILED:${error.code}`);
  }

  async loadMergeEvent(mergeEventId: string): Promise<MergeEventRecord | null> {
    const { data, error } = await this.admin().from('identity_merge_events').select('*').eq('id', mergeEventId).maybeSingle();
    if (error) throw new Error(`MERGE_EVENT_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      mergeEventId: data.id,
      fromContactId: data.from_contact_id,
      toContactId: data.to_contact_id,
      reason: data.reason,
      performedBy: data.performed_by,
      correlationId: data.correlation_id,
      performedAt: data.performed_at,
      reversedAt: data.reversed_at,
      reversedBy: data.reversed_by
    };
  }

  async reverseMergeEvent(mergeEventId: string, reversedBy: string, reversedAt: string): Promise<void> {
    const { error } = await this.admin().from('identity_merge_events').update({ reversed_at: reversedAt, reversed_by: reversedBy }).eq('id', mergeEventId);
    if (error) throw new Error(`MERGE_EVENT_REVERSE_FAILED:${error.code}`);
  }

  private mapRow(row: Record<string, unknown>): LinkedIdentity {
    return {
      linkedIdentityId: row.id as string,
      contactId: row.contact_id as string,
      identityKind: row.identity_kind as LinkedIdentity['identityKind'],
      externalId: row.external_id as string,
      verified: row.verified as boolean,
      linkedVia: row.linked_via as LinkedIdentity['linkedVia'],
      linkedBy: row.linked_by as string | null,
      correlationId: row.correlation_id as string,
      linkedAt: row.linked_at as string
    };
  }
}
