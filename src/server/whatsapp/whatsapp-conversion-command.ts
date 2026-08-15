import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import { travelRequestContentSchema, type TravelRequestContent } from '@/server/travel-request/contract';

/**
 * E.2A §5 — the ONE canonical, server-only WhatsApp -> Travel Request
 * conversion command. Follows the exact same Model B pattern already
 * proven safe by executeTravelRequestCommand
 * (src/server/travel-request/command.ts):
 *
 *   staff CRM route/server action
 *     -> getViewer() [cryptographic JWT verification, trusted server code]
 *     -> executeWhatsAppConversionCommand(viewer, input)
 *     -> createAdminSupabaseClient() [service_role, only reached AFTER
 *        viewer validation]
 *     -> admin.rpc('execute_whatsapp_conversion_command', ...) [service_
 *        role-only EXECUTE; re-verifies session/AAL/staff-role/evidence
 *        independently as defense in depth]
 *
 * See migration 29's own header comment
 * (supabase/migrations/20260807090000_task029_...) for the full proven
 * authority chain and callability matrix this mirrors.
 *
 * The browser can only ever supply the CustomerFacingConversionInput
 * fields below — actorId, sessionId, AAL, account, customer, brand,
 * message hashes, provider timestamp and the idempotency payload hash are
 * ALL derived here, server-side, from authoritative stored rows. There is
 * no parameter through which a caller can inject any of those values.
 */

export const whatsappConversionInputSchema = z.object({
  conversationId: z.uuid(),
  confirmationRequestMessageId: z.uuid(),
  acknowledgementMessageId: z.uuid(),
  disclosureVersion: z.enum(['E2A_AZ_V1', 'E2A_RU_V1', 'E2A_EN_V1']),
  content: travelRequestContentSchema,
  idempotencyKey: z.string().min(12).max(160)
}).strict();
export type WhatsAppConversionInput = z.infer<typeof whatsappConversionInputSchema>;

const rpcResultSchema = z.union([
  z.object({ status: z.literal('accepted'), travelRequestId: z.uuid(), versionNumber: z.number(), payloadHash: z.string(), intentId: z.uuid() }),
  z.object({ status: z.literal('denied'), reasonCode: z.string() })
]);

export type WhatsAppConversionResult =
  | { status: 'accepted'; travelRequestId: string; versionNumber: number; intentId: string }
  | { status: 'denied'; reasonCode: string };

/**
 * Computes the composite idempotency hash covering every
 * authority-relevant input (Section 4 of the prior checkpoint) —
 * deterministic, and using the repository's own established canonical
 * hashing implementation (sha256 over canonicalized JSON, the same
 * function executeTravelRequestCommand uses for its own payload hash).
 */
function computeIdempotencyPayloadHash(params: {
  conversationId: string;
  confirmationRequestMessageId: string;
  acknowledgementMessageId: string;
  acknowledgementContentHash: string;
  disclosureVersion: string;
  travelRequestContentHash: string;
}): string {
  return sha256({
    command: 'whatsapp.convert_conversation',
    conversationId: params.conversationId,
    confirmationRequestMessageId: params.confirmationRequestMessageId,
    acknowledgementMessageId: params.acknowledgementMessageId,
    acknowledgementContentHash: params.acknowledgementContentHash,
    disclosureVersion: params.disclosureVersion,
    travelRequestContentHash: params.travelRequestContentHash
  });
}

export async function executeWhatsAppConversionCommand(
  viewer: Viewer,
  input: WhatsAppConversionInput
): Promise<WhatsAppConversionResult> {
  // 1-3: authority is derived ONLY from the verified Viewer — never from
  // any field the browser could have supplied. A caller cannot pass an
  // actorId/sessionId/AAL through `input` at all — the schema above has
  // no such fields.
  if (!viewer.roles.some((role) => ['staff', 'manager', 'admin', 'founder'].includes(role))) {
    return { status: 'denied', reasonCode: 'STAFF_REQUIRED' };
  }
  if (viewer.assuranceLevel !== 'aal2') {
    return { status: 'denied', reasonCode: 'AAL2_REQUIRED' };
  }

  const parsedInput = whatsappConversionInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { status: 'denied', reasonCode: 'INVALID_INPUT' };
  }

  // 4: admin client only constructed after the above authority checks.
  const admin = createAdminSupabaseClient();
  if (!admin) return { status: 'denied', reasonCode: 'CONFIGURATION_UNAVAILABLE' };

  // 5-6: load authoritative evidence server-side — never trust anything
  // about these rows from the browser beyond the three IDs it named.
  const [conversationResult, confirmationResult, acknowledgementResult] = await Promise.all([
    admin.from('conversations').select('*').eq('id', parsedInput.data.conversationId).maybeSingle(),
    admin.from('messages').select('content_hash').eq('id', parsedInput.data.confirmationRequestMessageId).maybeSingle(),
    admin.from('messages').select('content_hash').eq('id', parsedInput.data.acknowledgementMessageId).maybeSingle()
  ]);
  if (conversationResult.error || !conversationResult.data) return { status: 'denied', reasonCode: 'CONVERSATION_NOT_FOUND' };
  if (confirmationResult.error || !confirmationResult.data) return { status: 'denied', reasonCode: 'CONFIRMATION_REQUEST_NOT_FOUND' };
  if (acknowledgementResult.error || !acknowledgementResult.data) return { status: 'denied', reasonCode: 'ACKNOWLEDGEMENT_NOT_FOUND' };

  // 7. canonical Travel Request content hash — established repository
  //    hashing function, never a caller-supplied hash.
  const content: TravelRequestContent = parsedInput.data.content;
  const contentHash = sha256(content);

  // 8. composite idempotency hash, entirely server-computed from
  //    authoritative stored values (the two message content hashes just
  //    loaded above), never from anything the browser asserted.
  const idempotencyPayloadHash = computeIdempotencyPayloadHash({
    conversationId: parsedInput.data.conversationId,
    confirmationRequestMessageId: parsedInput.data.confirmationRequestMessageId,
    acknowledgementMessageId: parsedInput.data.acknowledgementMessageId,
    acknowledgementContentHash: acknowledgementResult.data.content_hash,
    disclosureVersion: parsedInput.data.disclosureVersion,
    travelRequestContentHash: contentHash
  });

  // 9. the RPC call — exactly the 15 named parameters migration 29's
  //    function expects, mapped explicitly (never positionally-assumed).
  const { data, error } = await admin.rpc('execute_whatsapp_conversion_command', {
    p_command_id: randomUUID(),
    p_idempotency_key: parsedInput.data.idempotencyKey,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1_000).toISOString(),
    p_conversation_id: parsedInput.data.conversationId,
    p_confirmation_request_message_id: parsedInput.data.confirmationRequestMessageId,
    p_acknowledgement_message_id: parsedInput.data.acknowledgementMessageId,
    p_acknowledgement_content_hash: acknowledgementResult.data.content_hash,
    p_disclosure_version: parsedInput.data.disclosureVersion,
    p_content: content,
    p_content_hash: contentHash,
    p_idempotency_payload_hash: idempotencyPayloadHash,
    p_correlation_id: randomUUID()
  });

  if (error) {
    // 12. controlled, staff-safe mapping — never the raw SQL error.
    return { status: 'denied', reasonCode: 'DATABASE_ERROR' };
  }

  // 10-11. validate the RPC response through Zod before trusting its
  //        shape — a malformed response fails closed, never assumed
  //        successful.
  const parsedResult = rpcResultSchema.safeParse(data);
  if (!parsedResult.success) {
    return { status: 'denied', reasonCode: 'MALFORMED_RESPONSE' };
  }
  if (parsedResult.data.status === 'denied') {
    return { status: 'denied', reasonCode: parsedResult.data.reasonCode };
  }
  return {
    status: 'accepted',
    travelRequestId: parsedResult.data.travelRequestId,
    versionNumber: parsedResult.data.versionNumber,
    intentId: parsedResult.data.intentId
  };
}
