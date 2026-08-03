import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import { travelRequestContentSchema } from '@/server/travel-request/contract';
import {
  buildCanonicalQuotationPayload,
  type CommercialCommand,
  type CommercialCommandResult
} from './contract';

type RequestRow = {
  id: string;
  current_version: number;
};

type RequestVersionRow = {
  version_number: number;
  canonical_payload: unknown;
  payload_hash: string;
};

export async function executeCommercialCommand(
  viewer: Viewer,
  input: CommercialCommand,
  idempotencyKey: string
): Promise<CommercialCommandResult> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('COMMERCIAL_CONFIGURATION_UNAVAILABLE');

  let payload: Record<string, unknown>;
  if (input.action === 'quotation.create_version') {
    const { data: requestData, error: requestError } = await admin
      .from('travel_requests')
      .select('id, current_version')
      .eq('id', input.travelRequestId)
      .maybeSingle();
    if (requestError || !requestData) throw new Error('TRAVEL_REQUEST_NOT_FOUND');
    const request = requestData as RequestRow;

    const { data: versionData, error: versionError } = await admin
      .from('travel_request_versions')
      .select('version_number, canonical_payload, payload_hash')
      .eq('travel_request_id', request.id)
      .eq('version_number', request.current_version)
      .maybeSingle();
    if (versionError || !versionData) throw new Error('TRAVEL_REQUEST_VERSION_NOT_FOUND');
    const version = versionData as RequestVersionRow;
    const content = travelRequestContentSchema.safeParse(version.canonical_payload);
    if (!content.success || sha256(content.data) !== version.payload_hash) {
      throw new Error('TRAVEL_REQUEST_HASH_MISMATCH');
    }

    const canonicalPayload = buildCanonicalQuotationPayload({
      travelRequestId: request.id,
      travelRequestVersion: version.version_number,
      travelRequestHash: version.payload_hash
    }, input.draft);
    payload = {
      travelRequestId: input.travelRequestId,
      quotationId: input.quotationId ?? null,
      canonicalPayload,
      quotationHash: sha256(canonicalPayload)
    };
  } else {
    payload = {
      quotationId: input.quotationId,
      versionNumber: input.versionNumber,
      quotationHash: input.quotationHash,
      ...(input.action === 'quotation.decide'
        ? { decision: input.decision, reason: input.reason }
        : {}),
      ...(input.action === 'quotation.accept'
        ? { locale: input.locale, acceptanceConfirmed: input.acceptanceConfirmed }
        : {})
    };
  }

  const { data, error } = await admin.rpc('execute_commercial_command', {
    p_command_id: randomUUID(),
    p_idempotency_key: idempotencyKey,
    p_command_name: input.action,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1_000).toISOString(),
    p_payload: payload,
    p_payload_hash: sha256(payload)
  });

  if (error) throw new Error(`COMMERCIAL_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);
  return data as CommercialCommandResult;
}
