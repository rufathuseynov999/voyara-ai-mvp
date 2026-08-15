import type { WhatsAppCredentials, WhatsAppCredentialsState } from '@/config/env-core';
import { whatsappInboundMessageSchema, whatsappStatusSchema, type WhatsAppWebhookPayload } from './whatsapp-contract';

/**
 * E.2A — truthful WhatsApp readiness state.
 *
 * Exactly one of these five states is ever reported. LIVE_TEST_CERTIFIED
 * requires REAL evidence of a successful live network probe — there is no
 * code path in this project that can produce that evidence without an
 * actual network call to graph.facebook.com, which never happens in this
 * environment. That state is therefore structurally unreachable here, by
 * design, not merely by convention.
 *
 * FAILED covers a genuine misconfiguration (some but not all credential
 * fields set, or a complete set with a placeholder value) — this is
 * deliberately NOT the same as NOT_CONFIGURED (nothing set at all, an
 * entirely expected and unremarkable state for this project).
 */
export type WhatsAppActivationState =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED_BUT_DISABLED'
  | 'READY_FOR_TEST_ACTIVATION'
  | 'LIVE_TEST_CERTIFIED'
  | 'FAILED';

export function deriveWhatsAppActivationState(params: {
  credentialsState: WhatsAppCredentialsState;
  activationEnabled: boolean;
  /** Only ever non-null if a real, successful live health probe actually ran. */
  liveHealthEvidence: { healthy: boolean; checkedAt: string } | null;
}): WhatsAppActivationState {
  if (params.credentialsState.status === 'ABSENT') return 'NOT_CONFIGURED';
  if (params.credentialsState.status === 'INVALID') return 'FAILED';
  if (!params.activationEnabled) return 'CONFIGURED_BUT_DISABLED';
  if (params.liveHealthEvidence?.healthy) return 'LIVE_TEST_CERTIFIED';
  return 'READY_FOR_TEST_ACTIVATION';
}

/**
 * Convenience wrapper for callers (e.g. a future founder-facing status
 * panel) that want the state directly from process.env-reading functions.
 */
export function getWhatsAppActivationState(
  readCredentialsState: () => WhatsAppCredentialsState,
  activationEnabled: boolean,
  liveHealthEvidence: { healthy: boolean; checkedAt: string } | null = null
): WhatsAppActivationState {
  return deriveWhatsAppActivationState({ credentialsState: readCredentialsState(), activationEnabled, liveHealthEvidence });
}

/* ============================================================================
 * Real Meta Cloud API webhook envelope mapper.
 *
 * Meta's real webhook body shape (stable, public, documented at
 * developers.facebook.com/docs/whatsapp/cloud-api/webhooks) is:
 *
 * {
 *   "object": "whatsapp_business_account",
 *   "entry": [{
 *     "id": "<WABA id>",
 *     "changes": [{
 *       "value": {
 *         "messaging_product": "whatsapp",
 *         "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
 *         "contacts": [{ "profile": { "name": "..." }, "wa_id": "..." }],
 *         "messages": [{ "from": "...", "id": "wamid...", "timestamp": "...",
 *                         "type": "text", "text": { "body": "..." } }],
 *         "statuses": [{ "id": "wamid...", "status": "delivered",
 *                         "timestamp": "...", "recipient_id": "..." }]
 *       },
 *       "field": "messages"
 *     }]
 *   }]
 * }
 *
 * One POST body can carry multiple entries and, within each entry, multiple
 * changes — each with its own `metadata.phone_number_id` and its own
 * messages/statuses. This mapper flattens ALL of them, tagging each
 * flattened message/status batch with the phone_number_id it actually
 * belongs to, rather than assuming a single phone_number_id for the whole
 * request (the previous simplified contract's fatal assumption).
 * ========================================================================= */

const metaWebhookMessageSchema = whatsappInboundMessageSchema;
const metaWebhookStatusSchema = whatsappStatusSchema;

export type MetaWebhookEnvelope = {
  object?: unknown;
  entry?: Array<{
    id?: unknown;
    changes?: Array<{
      field?: unknown;
      value?: {
        messaging_product?: unknown;
        metadata?: { display_phone_number?: unknown; phone_number_id?: unknown };
        contacts?: Array<{ profile?: { name?: unknown }; wa_id?: unknown }>;
        messages?: unknown[];
        statuses?: unknown[];
      };
    }>;
  }>;
};

/** One real batch, scoped to the exact phone_number_id it was reported under. */
export type NormalizedWhatsAppBatch = WhatsAppWebhookPayload;

export type MetaEnvelopeNormalizationResult = {
  /** Zero or more real batches — normally one per (entry, change) pair that had a phone_number_id. */
  batches: NormalizedWhatsAppBatch[];
  /** Non-fatal: entries/changes/fields this mapper safely acknowledged without fabricating content. */
  unsupportedEvents: string[];
  /** True only if the envelope was structurally unrecognizable (not just empty). */
  malformed: boolean;
};

/**
 * Normalizes a real (already signature-verified) Meta webhook body into the
 * existing internal WhatsAppWebhookPayload shape the rest of the codebase
 * already understands — the external Meta shape never leaks past this
 * function.
 *
 * Fails closed (malformed: true, batches: []) rather than guessing when the
 * top-level shape doesn't match Meta's documented envelope at all (e.g. not
 * an object, or `object` present but not the expected literal, or `entry`
 * present but not an array) — the caller (the webhook route) treats that
 * the same way it already treats an unparseable body: acknowledge with 200,
 * write nothing.
 */
export function normalizeMetaWebhookEnvelope(body: unknown): MetaEnvelopeNormalizationResult {
  const unsupportedEvents: string[] = [];

  if (typeof body !== 'object' || body === null) {
    return { batches: [], unsupportedEvents, malformed: true };
  }
  const envelope = body as MetaWebhookEnvelope;
  if (envelope.object !== undefined && envelope.object !== 'whatsapp_business_account') {
    return { batches: [], unsupportedEvents, malformed: true };
  }
  if (!Array.isArray(envelope.entry)) {
    return { batches: [], unsupportedEvents, malformed: true };
  }

  const batchesByPhoneNumberId = new Map<string, { messages: unknown[]; statuses: unknown[] }>();

  for (const entry of envelope.entry) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) {
      unsupportedEvents.push(`entry:${String(entry?.id ?? 'unknown')}:no-changes`);
      continue;
    }
    for (const change of changes) {
      const field = typeof change?.field === 'string' ? change.field : 'unknown';
      if (field !== 'messages') {
        // Real Meta accounts also emit other webhook fields (e.g. account
        // review updates, template status changes). Safely acknowledged,
        // never fabricated into fake messages.
        unsupportedEvents.push(`field:${field}`);
        continue;
      }
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (typeof phoneNumberId !== 'string' || phoneNumberId.length === 0) {
        unsupportedEvents.push('change:missing-phone-number-id');
        continue;
      }
      const bucket = batchesByPhoneNumberId.get(phoneNumberId) ?? { messages: [], statuses: [] };
      if (Array.isArray(value?.messages)) bucket.messages.push(...value.messages);
      if (Array.isArray(value?.statuses)) bucket.statuses.push(...value.statuses);
      batchesByPhoneNumberId.set(phoneNumberId, bucket);
    }
  }

  const batches: NormalizedWhatsAppBatch[] = [];
  for (const [phoneNumberId, bucket] of batchesByPhoneNumberId) {
    const messages = bucket.messages
      .map((raw) => metaWebhookMessageSchema.safeParse(raw))
      .filter((result): result is { success: true; data: NormalizedWhatsAppBatch['messages'][number] } => result.success)
      .map((result) => result.data);
    const statuses = bucket.statuses
      .map((raw) => metaWebhookStatusSchema.safeParse(raw))
      .filter((result): result is { success: true; data: NormalizedWhatsAppBatch['statuses'][number] } => result.success)
      .map((result) => result.data);
    if (bucket.messages.length > messages.length) unsupportedEvents.push(`phone:${phoneNumberId}:unparseable-message-dropped`);
    if (bucket.statuses.length > statuses.length) unsupportedEvents.push(`phone:${phoneNumberId}:unparseable-status-dropped`);
    if (messages.length > 0 || statuses.length > 0) {
      batches.push({ phoneNumberId, messages, statuses });
    }
  }

  return { batches, unsupportedEvents, malformed: false };
}
