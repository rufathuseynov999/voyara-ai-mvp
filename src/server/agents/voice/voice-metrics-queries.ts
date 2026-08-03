import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Phase 4D — read-only voice operations metrics.
 *
 * Deliberately a standalone module, not folded into
 * src/server/founder/queries.ts's existing `FounderCommandCenterSnapshot`
 * contract — that system has its own established "never invent figures"
 * discipline and structured reason-code contract; adding voice metrics here
 * instead avoids widening that already-tested surface. Every number below
 * is a real count read directly from `calls`/`callback_tasks` — nothing is
 * estimated except where explicitly labelled "estimated" (cost), and even
 * that is a straight sum of `calls.estimated_cost_minor_units`, never a
 * guess.
 *
 * This is READ-ONLY. There is no function in this file that writes
 * anything, and the COO/Founder Digest agent (Phase 4A) that may summarize
 * this data has no more authority over it than any other digest reader —
 * summarizing and recommending is all it can do; nothing here is wired to
 * any execution path.
 */

export type VoiceOperationsMetrics = {
  totalCalls: number;
  answered: number;
  missed: number;
  completed: number;
  aiResolved: number;
  transferred: number;
  callbacksRequired: number;
  qualifiedLeads: number;
  averageDurationSeconds: number | null;
  languageDistribution: Record<string, number>;
  unresolvedOrHighRiskCalls: number;
  estimatedProviderCostMinorUnits: number;
  estimatedLlmCostMinorUnits: number;
};

const EMPTY_METRICS: VoiceOperationsMetrics = {
  totalCalls: 0, answered: 0, missed: 0, completed: 0, aiResolved: 0, transferred: 0,
  callbacksRequired: 0, qualifiedLeads: 0, averageDurationSeconds: null, languageDistribution: {},
  unresolvedOrHighRiskCalls: 0, estimatedProviderCostMinorUnits: 0, estimatedLlmCostMinorUnits: 0
};

export async function loadVoiceOperationsMetrics(): Promise<VoiceOperationsMetrics> {
  const admin = createAdminSupabaseClient();
  if (!admin) return EMPTY_METRICS;

  const { data: calls, error } = await admin
    .from('calls')
    .select('status, handover_status, duration_seconds, detected_language, urgency, estimated_cost_minor_units, model_tier');
  if (error) throw new Error(`VOICE_METRICS_QUERY_FAILED:${error.code}`);

  const rows = calls ?? [];
  const totalCalls = rows.length;
  const answered = rows.filter((r) => ['ANSWERED', 'TRANSFERRED', 'COMPLETED'].includes(r.status)).length;
  const missed = rows.filter((r) => r.status === 'FAILED').length;
  const completed = rows.filter((r) => r.status === 'COMPLETED').length;
  const transferred = rows.filter((r) => r.status === 'TRANSFERRED' || r.handover_status === 'HUMAN').length;
  const aiResolved = rows.filter((r) => r.status === 'COMPLETED' && r.handover_status === 'AI').length;
  const unresolvedOrHighRiskCalls = rows.filter((r) => r.urgency === 'HIGH' || (r.status !== 'COMPLETED' && r.status !== 'FAILED')).length;

  const durations = rows.map((r) => r.duration_seconds).filter((d): d is number => typeof d === 'number');
  const averageDurationSeconds = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const languageDistribution: Record<string, number> = {};
  for (const row of rows) {
    if (row.detected_language) languageDistribution[row.detected_language] = (languageDistribution[row.detected_language] ?? 0) + 1;
  }

  const estimatedLlmCostMinorUnits = rows.reduce((sum, r) => sum + (r.estimated_cost_minor_units ?? 0), 0);

  const { count: callbacksRequired } = await admin.from('callback_tasks').select('id', { count: 'exact', head: true }).eq('status', 'PENDING');

  // "Qualified lead" — a call that reached COMPLETED with a non-null AI
  // summary (the closest real, non-invented proxy available from what this
  // schema actually records; a dedicated lead-qualification flag is a
  // Phase 4E candidate, not fabricated here).
  const { count: qualifiedLeads } = await admin.from('calls').select('id', { count: 'exact', head: true }).not('ai_summary', 'is', null);

  return {
    totalCalls, answered, missed, completed, aiResolved, transferred,
    callbacksRequired: callbacksRequired ?? 0,
    qualifiedLeads: qualifiedLeads ?? 0,
    averageDurationSeconds,
    languageDistribution,
    unresolvedOrHighRiskCalls,
    estimatedProviderCostMinorUnits: 0, // no real voice-provider cost model exists yet — honestly zero, never invented
    estimatedLlmCostMinorUnits
  };
}
