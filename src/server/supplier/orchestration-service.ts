import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppRole } from '@/server/auth/roles';
import { staffAreaRoles, hasAnyRole } from '@/server/auth/roles';
import { readIntegrationConfig } from '@/config/env-core';
import { reportError } from '@/server/observability/error-reporter';
import { resolveSupplierAdapter } from './registry';
import { resolvePaymentAdapter } from '@/server/payment/payment-registry';
import { signSimulatedWebhook } from '@/server/payment/simulation-payment-adapter';
import type { QuoteStore } from './orchestration-store';
import type { SupplierAdapter } from './adapter';
import type { PaymentAdapter } from '@/server/payment/integration-contract';
import { currentVersion, hasValidApproval } from './quote';
import {
  acceptQuote,
  approveQuote,
  AuthorityError,
  checkVoucherEligibility,
  handlePaymentWebhook,
  prepareBookingCommand,
  preparePaymentIntent,
  presentQuote,
  reconcile,
  revalidate,
  searchAndCreateQuote,
  submitForReview,
  SIMULATION_LABEL,
  type OrchestrationContext
} from './orchestrator';

/**
 * Phase 3B Part 3 — orchestration service.
 *
 * The HTTP route delegates here after transport concerns (origin, JSON, body
 * size). Authority is derived exclusively from the passed viewer (which the
 * route takes from the authenticated session): demo sessions are rejected,
 * staff commands require a staff-area role AND an AAL2 session, and human
 * approval is enforced inside the orchestrator. Dependencies are injectable so
 * the full command flow is end-to-end testable without a live database; the
 * production route uses the Supabase store and env-resolved adapters.
 *
 * Everything remains simulation-only. The SIMULATE_WEBHOOK and
 * RECONCILE_SIMULATED commands exist so the UI can exercise the payment flow
 * without a real provider; both are hard-gated to simulated adapters and their
 * output is labelled simulation like every other record.
 */

export type OrchestrationViewer = {
  id: string;
  roles: AppRole[];
  source: 'demo' | 'supabase';
  assuranceLevel: 'aal1' | 'aal2';
};

export type OrchestrationDeps = {
  store?: QuoteStore;
  supplier?: SupplierAdapter;
  payment?: PaymentAdapter;
  webhookSecret?: string | null;
  now?: () => Date;
};

const occupancySchema = z.object({
  adults: z.number().int().min(1).max(16),
  children: z.number().int().min(0).max(16),
  rooms: z.number().int().min(1).max(16)
}).strict();

export const orchestrationCommandSchema = z.discriminatedUnion('command', [
  z.object({
    command: z.literal('SEARCH_AND_CREATE_QUOTE'),
    destination: z.string().trim().min(2).max(120),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    occupancy: occupancySchema,
    currency: z.enum(['AZN', 'USD', 'EUR', 'TRY', 'AED'])
  }).strict(),
  z.object({ command: z.literal('SUBMIT_FOR_REVIEW'), quoteId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('APPROVE_QUOTE'), quoteId: z.string().uuid(), expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  z.object({ command: z.literal('PRESENT_QUOTE'), quoteId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('ACCEPT_QUOTE'), quoteId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('REVALIDATE'), quoteId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('PREPARE_PAYMENT_INTENT'), quoteId: z.string().uuid() }).strict(),
  z.object({
    command: z.literal('INGEST_PAYMENT_WEBHOOK'),
    quoteId: z.string().uuid(),
    eventId: z.string().min(1).max(128),
    eventType: z.string().min(1).max(80),
    timestamp: z.string(),
    signature: z.string().min(1).max(256),
    body: z.string().max(8_192)
  }).strict(),
  z.object({ command: z.literal('SIMULATE_WEBHOOK'), quoteId: z.string().uuid() }).strict(),
  z.object({
    command: z.literal('RECONCILE'),
    quoteId: z.string().uuid(),
    receivedAmountMinor: z.number().int().min(0).nullable(),
    receivedCurrency: z.enum(['AZN', 'USD', 'EUR', 'TRY', 'AED']).nullable(),
    providerTransactionReference: z.string().min(1).max(128).nullable(),
    providerStatus: z.enum(['PAID', 'PENDING', 'FAILED', 'UNKNOWN']),
    receivedAt: z.string()
  }).strict(),
  z.object({ command: z.literal('RECONCILE_SIMULATED'), quoteId: z.string().uuid(), scenario: z.enum(['EXACT', 'PARTIAL']) }).strict(),
  z.object({
    command: z.literal('PREPARE_BOOKING'),
    quoteId: z.string().uuid(),
    travellers: z.array(z.object({ fullName: z.string().trim().min(1).max(160), isLead: z.boolean() }).strict()).min(1).max(16),
    rooming: z.array(z.object({ roomIndex: z.number().int().min(1).max(16), travellerNames: z.array(z.string().trim().min(1).max(160)).min(1) }).strict()).min(1),
    specialRequests: z.string().max(500),
    hagApprovalReference: z.string().uuid()
  }).strict(),
  z.object({ command: z.literal('CHECK_VOUCHER_ELIGIBILITY'), quoteId: z.string().uuid(), bookingConfirmed: z.boolean() }).strict()
]);
export type OrchestrationCommandInput = z.infer<typeof orchestrationCommandSchema>;

const STAFF_COMMANDS = new Set<OrchestrationCommandInput['command']>([
  'SUBMIT_FOR_REVIEW', 'APPROVE_QUOTE', 'PRESENT_QUOTE', 'REVALIDATE',
  'PREPARE_PAYMENT_INTENT', 'INGEST_PAYMENT_WEBHOOK', 'SIMULATE_WEBHOOK',
  'RECONCILE', 'RECONCILE_SIMULATED', 'PREPARE_BOOKING'
]);

export type ServiceResult = { status: number; body: Record<string, unknown> };

function buildContext(
  viewer: OrchestrationViewer,
  correlationId: string,
  deps: OrchestrationDeps
): OrchestrationContext {
  if (!deps.store) {
    // Production path: the Supabase store is server-only and loaded lazily so
    // the service itself stays importable by the node test runner.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SupabaseQuoteStore } = require('./supabase-quote-store') as typeof import('./supabase-quote-store');
    deps = { ...deps, store: new SupabaseQuoteStore() };
  }
  return {
    store: deps.store!,
    supplier: deps.supplier ?? resolveSupplierAdapter(undefined, viewer.id),
    payment: deps.payment ?? resolvePaymentAdapter(),
    actor: { id: viewer.id, kind: 'human' },
    ownership: { tenantId: viewer.id, customerId: viewer.id },
    correlationId,
    now: deps.now ?? (() => new Date())
  };
}

function authorityStatus(error: AuthorityError): number {
  if (error.code === 'QUOTE_ACCESS_DENIED') return 404;
  if (error.code.includes('REQUIRED') || error.code.includes('STALE')) return 409;
  return 403;
}

export async function executeOrchestrationCommand(params: {
  viewer: OrchestrationViewer;
  idempotencyKey: string;
  correlationId?: string;
  input: unknown;
  deps?: OrchestrationDeps;
}): Promise<ServiceResult> {
  const { viewer, idempotencyKey } = params;
  const deps = params.deps ?? {};
  const correlationId = params.correlationId?.slice(0, 128) || randomUUID();

  // Demo sessions are non-authoritative and may not execute commands.
  if (viewer.source !== 'supabase') {
    return { status: 403, body: { error: 'AUTHORITATIVE_SESSION_REQUIRED' } };
  }

  const parsed = orchestrationCommandSchema.safeParse(params.input);
  if (!parsed.success) return { status: 400, body: { error: 'INVALID_COMMAND' } };
  const input = parsed.data;

  const isStaff = hasAnyRole(viewer.roles, staffAreaRoles);
  if (STAFF_COMMANDS.has(input.command)) {
    if (!isStaff) return { status: 403, body: { error: 'STAFF_ROLE_REQUIRED' } };
    if (viewer.assuranceLevel !== 'aal2') return { status: 403, body: { error: 'AAL2_REQUIRED' } };
  }

  const webhookSecret = deps.webhookSecret !== undefined
    ? deps.webhookSecret
    : readIntegrationConfig().webhookSecret;

  let ctx: OrchestrationContext;
  try {
    ctx = buildContext(viewer, correlationId, deps);
  } catch {
    return { status: 503, body: { error: 'INTEGRATION_UNAVAILABLE' } };
  }

  try {
    switch (input.command) {
      case 'SEARCH_AND_CREATE_QUOTE': {
        const result = await searchAndCreateQuote(ctx, { ...input, commandKey: idempotencyKey });
        return { status: 200, body: { ok: true, quoteId: result.quoteId, replayed: result.replayed, simulation: SIMULATION_LABEL } };
      }
      case 'SUBMIT_FOR_REVIEW':
        await submitForReview(ctx, input.quoteId);
        return { status: 200, body: { ok: true, simulation: SIMULATION_LABEL } };
      case 'APPROVE_QUOTE':
        await approveQuote(ctx, input.quoteId, input.expectedContentHash);
        return { status: 200, body: { ok: true, simulation: SIMULATION_LABEL } };
      case 'PRESENT_QUOTE':
        await presentQuote(ctx, input.quoteId);
        return { status: 200, body: { ok: true, simulation: SIMULATION_LABEL } };
      case 'ACCEPT_QUOTE': {
        const result = await acceptQuote(ctx, input.quoteId, params.idempotencyKey);
        return { status: 200, body: { ok: true, replayed: result.replayed, simulation: SIMULATION_LABEL } };
      }
      case 'REVALIDATE': {
        const result = await revalidate(ctx, input.quoteId, null);
        return { status: 200, body: { ok: true, outcome: result.outcome, simulation: SIMULATION_LABEL } };
      }
      case 'PREPARE_PAYMENT_INTENT': {
        const result = await preparePaymentIntent(ctx, input.quoteId);
        return { status: 200, body: { ok: true, intentReference: result.intentReference, simulation: SIMULATION_LABEL } };
      }
      case 'INGEST_PAYMENT_WEBHOOK': {
        if (!webhookSecret) return { status: 503, body: { error: 'WEBHOOK_SECRET_UNCONFIGURED' } };
        const result = await handlePaymentWebhook(ctx, input.quoteId, {
          eventId: input.eventId,
          eventType: input.eventType,
          timestamp: input.timestamp,
          signature: input.signature,
          body: input.body
        }, webhookSecret, ['payment.detected']);
        return { status: result.accepted ? 200 : 400, body: { ok: result.accepted, duplicate: result.duplicate, reasonCode: result.reasonCode, simulation: SIMULATION_LABEL } };
      }
      case 'SIMULATE_WEBHOOK': {
        // Simulation-only helper for the UI: constructs a properly signed
        // synthetic detection webhook server-side. Signature verification and
        // idempotent processing run through the exact same path as real ones.
        if (!ctx.payment.simulated) return { status: 403, body: { error: 'SIMULATION_ONLY' } };
        if (!webhookSecret) return { status: 503, body: { error: 'WEBHOOK_SECRET_UNCONFIGURED' } };
        const timestamp = ctx.now().toISOString();
        const eventId = `SIM-EVT-${randomUUID()}`;
        const body = JSON.stringify({ id: eventId, type: 'payment.detected', simulated: true });
        const result = await handlePaymentWebhook(ctx, input.quoteId, {
          eventId,
          eventType: 'payment.detected',
          timestamp,
          signature: signSimulatedWebhook(webhookSecret, timestamp, body),
          body
        }, webhookSecret, ['payment.detected']);
        return { status: result.accepted ? 200 : 400, body: { ok: result.accepted, duplicate: result.duplicate, reasonCode: result.reasonCode, simulation: SIMULATION_LABEL } };
      }
      case 'RECONCILE': {
        const result = await reconcile(ctx, input.quoteId, {
          receivedAmountMinor: input.receivedAmountMinor,
          receivedCurrency: input.receivedCurrency,
          providerTransactionReference: input.providerTransactionReference,
          providerStatus: input.providerStatus,
          receivedAt: input.receivedAt,
          seenProviderReferences: []
        });
        return { status: 200, body: { ok: true, status: result.status, verified: result.verified, simulation: SIMULATION_LABEL } };
      }
      case 'RECONCILE_SIMULATED': {
        // Simulation-only scenario generator: the server derives the evidence
        // from the authoritative quote (client supplies no amounts). EXACT
        // produces a matched payment; PARTIAL produces an underpayment that
        // must route to PAYMENT_MISMATCH and block booking.
        if (!ctx.payment.simulated) return { status: 403, body: { error: 'SIMULATION_ONLY' } };
        const quote = await ctx.store.loadQuote(input.quoteId, { ...ctx.ownership, isStaff: true });
        if (!quote) return { status: 404, body: { error: 'QUOTE_ACCESS_DENIED' } };
        const expected = currentVersion(quote).material.customerTotalMinor;
        const receivedAmountMinor = input.scenario === 'EXACT' ? expected : Math.max(0, expected - 10_000);
        // Simulated evidence timestamp kept within the offer validity window.
        const receivedAt = new Date(Math.min(ctx.now().getTime(), Date.parse(quote.expiresAt) - 60_000)).toISOString();
        const result = await reconcile(ctx, input.quoteId, {
          receivedAmountMinor,
          receivedCurrency: currentVersion(quote).material.currency,
          providerTransactionReference: `SIM-TX-${randomUUID().slice(0, 8)}`,
          providerStatus: 'PAID',
          receivedAt,
          seenProviderReferences: []
        });
        return { status: 200, body: { ok: true, status: result.status, verified: result.verified, simulation: SIMULATION_LABEL } };
      }
      case 'PREPARE_BOOKING': {
        const result = await prepareBookingCommand(ctx, input.quoteId, {
          travellers: input.travellers,
          rooming: input.rooming,
          specialRequests: input.specialRequests,
          hagApprovalReference: input.hagApprovalReference,
          commandKey: idempotencyKey
        });
        if (!result.prepared) return { status: 409, body: { ok: false, reasonCode: result.reasonCode, simulation: SIMULATION_LABEL } };
        return { status: 200, body: { ok: true, replayed: result.replayed, simulation: SIMULATION_LABEL } };
      }
      case 'CHECK_VOUCHER_ELIGIBILITY': {
        const eligible = await checkVoucherEligibility(ctx, input.quoteId, input.bookingConfirmed);
        return { status: 200, body: { ok: true, eligible, simulation: SIMULATION_LABEL } };
      }
    }
  } catch (error) {
    if (error instanceof AuthorityError) {
      return { status: authorityStatus(error), body: { error: error.code } };
    }
    // AuthorityError above is expected control flow (stale hash, wrong role,
    // cross-customer denial, ...) and must never page anyone. Anything that
    // reaches here is a genuine unexpected failure.
    reportError(error, { code: 'ORCHESTRATION_COMMAND_FAILED', correlationId });
    return { status: 500, body: { error: 'COMMAND_FAILED' } };
  }
}

/* ------------------------------- Read views ------------------------------ */

const querySchema = z.discriminatedUnion('view', [
  z.object({ view: z.literal('quoteStatus'), quoteId: z.string().uuid() }).strict(),
  z.object({ view: z.literal('health') }).strict()
]);
export type OrchestrationQueryInput = z.infer<typeof querySchema>;

export async function executeOrchestrationQuery(params: {
  viewer: OrchestrationViewer;
  input: unknown;
  deps?: OrchestrationDeps;
}): Promise<ServiceResult> {
  const { viewer } = params;
  const deps = params.deps ?? {};

  if (viewer.source !== 'supabase') {
    return { status: 403, body: { error: 'AUTHORITATIVE_SESSION_REQUIRED' } };
  }
  const parsed = querySchema.safeParse(params.input);
  if (!parsed.success) return { status: 400, body: { error: 'INVALID_QUERY' } };
  const input = parsed.data;
  const isStaff = hasAnyRole(viewer.roles, staffAreaRoles);

  let ctx: OrchestrationContext;
  try {
    ctx = buildContext(viewer, randomUUID(), deps);
  } catch {
    return { status: 503, body: { error: 'INTEGRATION_UNAVAILABLE' } };
  }

  try {
    if (input.view === 'health') {
      // Founder/staff view. Only authoritative adapter health is reported;
      // exception counts have no authoritative source in this build and are
      // therefore returned as null (never invented).
      if (!isStaff || viewer.assuranceLevel !== 'aal2') {
        return { status: 403, body: { error: 'STAFF_ROLE_REQUIRED' } };
      }
      const [supplierHealth, paymentHealth] = await Promise.all([
        ctx.supplier.health(),
        ctx.payment.health()
      ]);
      return {
        status: 200,
        body: {
          ok: true,
          supplier: supplierHealth,
          payment: paymentHealth,
          exceptionCounts: null,
          simulation: SIMULATION_LABEL
        }
      };
    }

    // quoteStatus: owner or AAL2 staff.
    const quote = await ctx.store.loadQuote(input.quoteId, {
      ...ctx.ownership,
      isStaff: isStaff && viewer.assuranceLevel === 'aal2'
    });
    if (!quote) return { status: 404, body: { error: 'QUOTE_ACCESS_DENIED' } };
    const version = currentVersion(quote);
    const payment = await ctx.store.loadPaymentByQuote(input.quoteId);
    return {
      status: 200,
      body: {
        ok: true,
        quoteId: quote.quoteId,
        status: quote.status,
        versionNumber: version.versionNumber,
        contentHash: version.contentHash,
        expiresAt: quote.expiresAt,
        lastRevalidatedAt: quote.lastRevalidatedAt,
        hasValidApproval: hasValidApproval(quote),
        payment: payment
          ? {
              detectedStatus: payment.detectedStatus,
              verifiedStatus: payment.verifiedStatus,
              reconciliationStatus: payment.reconciliationStatus
            }
          : null,
        source: quote.source,
        simulation: SIMULATION_LABEL
      }
    };
  } catch (error) {
    if (error instanceof AuthorityError) {
      return { status: authorityStatus(error), body: { error: error.code } };
    }
    reportError(error, { code: 'ORCHESTRATION_QUERY_FAILED' });
    return { status: 500, body: { error: 'QUERY_FAILED' } };
  }
}
