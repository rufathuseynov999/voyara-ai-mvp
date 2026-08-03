import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import type { TravelRequestCommand, TravelRequestCommandResult } from './contract';

export async function executeTravelRequestCommand(
  viewer: Viewer,
  input: TravelRequestCommand,
  idempotencyKey: string
): Promise<TravelRequestCommandResult> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('TRAVEL_REQUEST_CONFIGURATION_UNAVAILABLE');

  const payload = 'content' in input
    ? {
        requestId: input.requestId ?? null,
        content: input.content,
        contentHash: sha256(input.content)
      }
    : { requestId: input.requestId };

  const { data, error } = await admin.rpc('execute_travel_request_command', {
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

  if (error) throw new Error(`TRAVEL_REQUEST_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);
  return data as TravelRequestCommandResult;
}
