import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { sha256 } from '@/server/bos/canonical-json';
import type { AccessCommandInput, AccessCommandResult } from './access-contract';
import type { Viewer } from './viewer';

export async function executeAccessCommand(
  viewer: Viewer,
  input: AccessCommandInput,
  idempotencyKey: string,
  commandId: string
): Promise<{ admin: NonNullable<ReturnType<typeof createAdminSupabaseClient>>; result: AccessCommandResult; payload: object }> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('AUTH_CONFIGURATION_UNAVAILABLE');

  const payload =
    input.action === 'staff.invite'
      ? {
          email: input.email.trim().toLowerCase(),
          emailHash: sha256(input.email.trim().toLowerCase()),
          role: input.role,
          locale: input.locale
        }
      : { userId: input.userId, role: input.role, reason: input.reason };

  const { data, error } = await admin.rpc('execute_access_command', {
    p_command_id: commandId,
    p_idempotency_key: idempotencyKey,
    p_command_name: input.action,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1000).toISOString(),
    p_payload: payload,
    p_payload_hash: sha256(payload)
  });
  if (error) throw new Error(`ACCESS_COMMAND_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);

  return { admin, result: data as AccessCommandResult, payload };
}
