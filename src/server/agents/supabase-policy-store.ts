import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { MessageSendPolicy } from './risk-policy-contract';
import type { PolicyStore } from './policy-store';

export class SupabasePolicyStore implements PolicyStore {
  private admin() {
    const client = createAdminSupabaseClient();
    if (!client) throw new Error('POLICY_STORE_UNAVAILABLE: Supabase admin client is not configured.');
    return client;
  }

  async loadActivePolicy(): Promise<MessageSendPolicy | null> {
    const { data, error } = await this.admin().from('message_send_policies').select('*').eq('active', true).maybeSingle();
    if (error) throw new Error(`POLICY_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      policyId: data.id,
      policyName: data.policy_name,
      version: data.version,
      policyHash: data.policy_hash,
      knowledgeVersion: data.knowledge_version,
      allowedIntents: data.allowed_intents,
      approvedBy: data.approved_by,
      approvedAt: data.approved_at,
      active: data.active,
      correlationId: data.correlation_id,
      createdAt: data.created_at
    };
  }

  async savePolicy(policy: MessageSendPolicy): Promise<void> {
    if (policy.active) {
      await this.admin().from('message_send_policies').update({ active: false }).eq('active', true);
    }
    const { error } = await this.admin().from('message_send_policies').upsert({
      id: policy.policyId,
      policy_name: policy.policyName,
      version: policy.version,
      policy_hash: policy.policyHash,
      knowledge_version: policy.knowledgeVersion,
      allowed_intents: policy.allowedIntents,
      approved_by: policy.approvedBy,
      approved_at: policy.approvedAt,
      active: policy.active,
      correlation_id: policy.correlationId,
      created_at: policy.createdAt
    }, { onConflict: 'id' });
    if (error) throw new Error(`POLICY_WRITE_FAILED:${error.code}`);
  }

  async recordLlmRun(run: { runId: string; conversationId: string; messageId: string | null; modelTier: 'CHEAP' | 'STRONG'; modelName: string; simulated: boolean; correlationId: string }): Promise<void> {
    const { error } = await this.admin().from('agent_llm_runs').insert({
      id: run.runId,
      conversation_id: run.conversationId,
      message_id: run.messageId,
      model_tier: run.modelTier,
      model_name: run.modelName,
      simulated: run.simulated,
      correlation_id: run.correlationId
    });
    if (error) throw new Error(`LLM_RUN_WRITE_FAILED:${error.code}`);
  }
}
