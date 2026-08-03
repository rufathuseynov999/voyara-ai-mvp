import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/server/auth/viewer';
import { executeAdministrationCommand } from '@/server/administration/command';
import { administrationCommandSchema } from '@/server/administration/contract';

const idempotencyKeySchema = z.string().min(12).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const maximumBodyBytes = 65_536;
const administrationRoles = ['staff', 'manager', 'finance', 'admin', 'founder'] as const;

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredUrl) return origin === new URL(configuredUrl).origin;
  const allowed = new Set([new URL(request.url).origin, request.nextUrl.origin]);
  const host = request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || request.nextUrl.protocol.replace(':', '');
  if (host) allowed.add(`${protocol}://${host}`);
  return allowed.has(origin);
}

function response(body: object, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' }
  });
}

function deniedStatus(reasonCode?: string): number {
  if (reasonCode === 'RATE_LIMITED') return 429;
  if (reasonCode?.includes('NOT_FOUND')) return 404;
  if (reasonCode?.includes('INVALID')) return 400;
  if (reasonCode?.includes('STATE') || reasonCode?.includes('STALE') || reasonCode?.includes('OWNER')) return 409;
  return 403;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return response({ error: 'REQUEST_ORIGIN_DENIED' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return response({ error: 'JSON_REQUIRED' }, 415);
  }
  const viewer = await getViewer();
  if (!viewer) return response({ error: 'AUTHENTICATION_REQUIRED' }, 401);
  if (!administrationRoles.some((role) => viewer.roles.includes(role))) {
    return response({ error: 'ADMINISTRATION_AUTHORITY_REQUIRED' }, 403);
  }
  if (viewer.assuranceLevel !== 'aal2') return response({ error: 'AAL2_REQUIRED' }, 403);
  const idempotencyKey = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'));
  if (!idempotencyKey.success) return response({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);

  let json: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) {
      return response({ error: 'REQUEST_TOO_LARGE' }, 413);
    }
    json = JSON.parse(body);
  } catch {
    return response({ error: 'INVALID_JSON' }, 400);
  }
  const input = administrationCommandSchema.safeParse(json);
  if (!input.success) return response({ error: 'INVALID_ADMINISTRATION_COMMAND' }, 400);

  try {
    const result = await executeAdministrationCommand(viewer, input.data, idempotencyKey.data);
    if (result.status === 'denied') return response(result, deniedStatus(result.reasonCode));
    return response(result, 200);
  } catch {
    return response({ error: 'ADMINISTRATION_COMMAND_FAILED' }, 500);
  }
}
