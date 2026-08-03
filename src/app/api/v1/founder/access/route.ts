import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { executeAccessCommand } from '@/server/auth/access-command';
import { accessCommandInputSchema } from '@/server/auth/access-contract';
import { getViewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';

const idempotencyKeySchema = z.string().min(12).max(160).regex(/^[A-Za-z0-9._:-]+$/);

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredUrl) return origin === new URL(configuredUrl).origin;

  const allowed = new Set([new URL(request.url).origin, request.nextUrl.origin]);
  const host = request.headers.get('host');
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(':', '');
  if (host) allowed.add(`${protocol}://${host}`);
  return allowed.has(origin);
}

function noStore(body: object, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' }
  });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStore({ error: 'REQUEST_ORIGIN_DENIED' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return noStore({ error: 'JSON_REQUIRED' }, 415);
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 16_384) return noStore({ error: 'REQUEST_TOO_LARGE' }, 413);

  const viewer = await getViewer();
  if (!viewer) return noStore({ error: 'AUTHENTICATION_REQUIRED' }, 401);
  if (!viewer.roles.includes('founder')) return noStore({ error: 'FOUNDER_REQUIRED' }, 403);
  if (viewer.assuranceLevel !== 'aal2') return noStore({ error: 'AAL2_REQUIRED' }, 403);

  const idempotencyKey = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'));
  if (!idempotencyKey.success) return noStore({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return noStore({ error: 'INVALID_JSON' }, 400);
  }
  const input = accessCommandInputSchema.safeParse(json);
  if (!input.success) return noStore({ error: 'INVALID_COMMAND' }, 400);

  try {
    const commandId = randomUUID();
    const { admin, result, payload } = await executeAccessCommand(viewer, input.data, idempotencyKey.data, commandId);
    if (result.status === 'denied') return noStore(result, 403);

    if (input.data.action === 'staff.invite') {
      const invitationId = result.invitationId;
      if (!invitationId) throw new Error('INVITATION_RECEIPT_INVALID');
      const appOrigin = process.env.NEXT_PUBLIC_APP_URL
        ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
        : new URL(request.url).origin;
      const { error } = await admin.auth.admin.inviteUserByEmail(input.data.email.trim().toLowerCase(), {
        redirectTo: `${appOrigin}/${input.data.locale}/activate-staff`
      });
      const errorCode = error ? String(error.code ?? 'INVITE_DELIVERY_FAILED').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) : null;
      await admin
        .from('staff_invitations')
        .update({
          delivered_at: error ? null : new Date().toISOString(),
          delivery_attempts: 1,
          delivery_error_code: errorCode
        })
        .eq('id', invitationId);
      if (error) return noStore({ status: 'accepted', delivery: 'failed', reasonCode: errorCode }, 502);
    }

    return noStore({ ...result, payloadHash: sha256(payload) }, 200);
  } catch {
    return noStore({ error: 'ACCESS_COMMAND_FAILED' }, 500);
  }
}
