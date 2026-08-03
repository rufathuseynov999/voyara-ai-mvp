import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Phase 4C — provider-neutral LLM routing.
 *
 * Simulation-first by design: no LLM API credentials exist anywhere in this
 * project (see the gap matrix / activation runbook), so `SimulationLlmRouter`
 * is the only router that can be constructed today. A real router (calling
 * Anthropic, OpenAI, or another provider) would implement the same
 * `LlmRouter` interface and go through the same fail-closed
 * `createLlmRouter` factory — this is the identical registry pattern already
 * proven for suppliers, payments, and channels.
 *
 * Tool permissions are structural, not advisory: `toolPermissions` is a
 * closed set that does not include — and cannot be extended at the type
 * level to include — direct database writes, payment execution, booking
 * creation, cancellation, or refund issuance. An LLM run can request one of
 * the permitted read-only/draft-only tools; nothing else is representable.
 */

export const llmModelTiers = ['CHEAP', 'STRONG'] as const;
export type LlmModelTier = (typeof llmModelTiers)[number];

/** The only tool capabilities an LLM run may be granted. Every one of these
 *  either reads existing data or produces a DRAFT that still needs to pass
 *  through the existing HAG-gated services (draftAgentMessage,
 *  sendLowRiskMessage under an active policy, etc.) — none of them is a
 *  direct authority to write an authoritative record, execute a payment,
 *  create a booking, cancel a service, or issue a refund. */
export const llmToolPermissions = [
  'READ_CONVERSATION_HISTORY',
  'READ_KNOWLEDGE_BASE',
  'DRAFT_LOW_RISK_MESSAGE',
  'DRAFT_HUMAN_APPROVAL_MESSAGE',
  'PROPOSE_OPERATIONAL_ACTION' // COO-digest-style advisory proposal, never an executed action
] as const;
export type LlmToolPermission = (typeof llmToolPermissions)[number];

export const llmRoutingRequestSchema = z.object({
  conversationId: z.uuid(),
  taskKind: z.enum(['FAQ_OR_QUALIFICATION', 'COMPLEX_TRAVEL_PLANNING']),
  toolPermissions: z.array(z.enum(llmToolPermissions)),
  correlationId: z.string().min(1).max(128)
}).strict();
export type LlmRoutingRequest = z.infer<typeof llmRoutingRequestSchema>;

export const llmRunRecordSchema = z.object({
  runId: z.uuid(),
  conversationId: z.uuid(),
  modelTier: z.enum(llmModelTiers),
  modelName: z.string(),
  routingReason: z.string(),
  simulated: z.boolean(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  estimatedCostMinorUnits: z.number().int().min(0),
  toolPermissions: z.array(z.enum(llmToolPermissions)),
  correlationId: z.string().min(1).max(128),
  createdAt: z.iso.datetime()
}).strict();
export type LlmRunRecord = z.infer<typeof llmRunRecordSchema>;

export class LlmRoutingError extends Error {
  constructor(message: string, readonly code: 'VALIDATION' | 'SPENDING_CEILING_EXCEEDED' | 'CREDENTIALS_MISSING' | 'LIVE_NOT_AVAILABLE') {
    super(message);
    this.name = 'LlmRoutingError';
  }
}

/** Routes a task to a model tier. FAQ/qualification always uses the cheap
 *  tier; complex travel-planning uses the stronger tier — the reason is
 *  always recorded explicitly, never left implicit. */
export function routeModelTier(taskKind: LlmRoutingRequest['taskKind']): { tier: LlmModelTier; reason: string } {
  if (taskKind === 'COMPLEX_TRAVEL_PLANNING') {
    return { tier: 'STRONG', reason: 'Complex travel-planning tasks are routed to the stronger tier for higher-quality itinerary reasoning.' };
  }
  return { tier: 'CHEAP', reason: 'Routine FAQ/qualification tasks are routed to the low-cost tier — no complex reasoning is required.' };
}

export interface LlmRouter {
  readonly mode: 'SIMULATION' | 'SANDBOX' | 'LIVE';
  readonly simulated: boolean;
  run(request: LlmRoutingRequest, spendingCeilingMinorUnits: number, spentSoFarMinorUnits: number): Promise<LlmRunRecord>;
}

const SIMULATED_COST_PER_RUN_MINOR_UNITS: Record<LlmModelTier, number> = { CHEAP: 1, STRONG: 15 };

export class SimulationLlmRouter implements LlmRouter {
  readonly mode = 'SIMULATION' as const;
  readonly simulated = true;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async run(request: LlmRoutingRequest, spendingCeilingMinorUnits: number, spentSoFarMinorUnits: number): Promise<LlmRunRecord> {
    const parsed = llmRoutingRequestSchema.safeParse(request);
    if (!parsed.success) throw new LlmRoutingError('Invalid LLM routing request.', 'VALIDATION');

    const { tier, reason } = routeModelTier(parsed.data.taskKind);
    const estimatedCost = SIMULATED_COST_PER_RUN_MINOR_UNITS[tier];
    if (spentSoFarMinorUnits + estimatedCost > spendingCeilingMinorUnits) {
      throw new LlmRoutingError(
        `Spending ceiling would be exceeded: ${spentSoFarMinorUnits} + ${estimatedCost} > ${spendingCeilingMinorUnits}.`,
        'SPENDING_CEILING_EXCEEDED'
      );
    }

    return {
      runId: randomUUID(),
      conversationId: parsed.data.conversationId,
      modelTier: tier,
      modelName: `simulation-${tier.toLowerCase()}-v1`,
      routingReason: reason,
      simulated: true,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMinorUnits: estimatedCost,
      toolPermissions: parsed.data.toolPermissions,
      correlationId: parsed.data.correlationId,
      createdAt: this.clock().toISOString()
    };
  }
}

/** Fail-closed factory, identical discipline to createChannelAdapter /
 *  createPaymentAdapter / createSupplierAdapter: SIMULATION works today;
 *  SANDBOX/LIVE always throw — no LLM API credential exists anywhere in
 *  this project. */
export function createLlmRouter(mode: 'SIMULATION' | 'SANDBOX' | 'LIVE'): LlmRouter {
  if (mode === 'SIMULATION') return new SimulationLlmRouter();
  if (mode === 'SANDBOX') {
    throw new LlmRoutingError('No Sandbox LLM router is available — no LLM API credentials are configured.', 'CREDENTIALS_MISSING');
  }
  throw new LlmRoutingError('No LIVE LLM router is available in this build; live capability is not claimed.', 'LIVE_NOT_AVAILABLE');
}
