import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { CooDigest } from './coo-agent-contract';
import type { CooDigestStore } from './coo-digest-store';

export class SupabaseCooDigestStore implements CooDigestStore {
  private admin() {
    const client = createAdminSupabaseClient();
    if (!client) throw new Error('COO_DIGEST_STORE_UNAVAILABLE: Supabase admin client is not configured.');
    return client;
  }

  async saveDigest(digest: CooDigest): Promise<void> {
    const { error } = await this.admin().from('coo_digests').insert({
      id: digest.digestId,
      account_id: digest.accountId,
      generated_at: digest.generatedAt,
      summary: digest.summary,
      risks: digest.risks,
      priorities: digest.priorities,
      proposed_actions: digest.proposedActions,
      correlation_id: digest.correlationId,
      created_at: digest.createdAt
    });
    if (error) throw new Error(`COO_DIGEST_WRITE_FAILED:${error.code}`);
  }

  async listRecentDigests(accountId: string, limit: number): Promise<CooDigest[]> {
    const { data, error } = await this.admin()
      .from('coo_digests')
      .select('*')
      .eq('account_id', accountId)
      .order('generated_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`COO_DIGEST_READ_FAILED:${error.code}`);
    return (data ?? []).map((row) => ({
      digestId: row.id,
      accountId: row.account_id,
      generatedAt: row.generated_at,
      summary: row.summary,
      risks: row.risks,
      priorities: row.priorities,
      proposedActions: row.proposed_actions,
      correlationId: row.correlation_id,
      createdAt: row.created_at
    }));
  }
}
