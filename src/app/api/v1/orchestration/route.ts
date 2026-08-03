import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/server/auth/viewer';
import {
  executeOrchestrationCommand,
  executeOrchestrationQuery
} from '@/server/supplier/orchestration-service';

/**
 * Phase 3B — orchestration HTTP endpoint (thin transport wrapper).
 *
 * Transport concerns only: same-origin enforcement, JSON content type, body
 * size limit, idempotency-key header, no-store responses. All authority
 * decisions (session source, roles, AAL2, human approval, ownership) happen in
 * the orchestration service using the session-derived viewer exclusively.
 */

const maximumBodyBytes = 16_384;
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
  const viewer = await getViewer();
  if (!viewer) return noStore({ error: 'AUTHENTICATION_REQUIRED' }, 401);

  const idempotencyKey = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'));
  if (!idempotencyKey.success) return noStore({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);

  let json: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) {
      return noStore({ error: 'REQUEST_TOO_LARGE' }, 413);
    }
    json = JSON.parse(body);
  } catch {
    return noStore({ error: 'INVALID_JSON' }, 400);
  }

  const result = await executeOrchestrationCommand({
    viewer: {
      id: viewer.id,
      roles: viewer.roles,
      source: viewer.source,
      assuranceLevel: viewer.assuranceLevel
    },
    idempotencyKey: idempotencyKey.data,
    correlationId: request.headers.get('x-correlation-id') ?? undefined,
    input: json
  });
  return noStore(result.body, result.status);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return noStore({ error: 'AUTHENTICATION_REQUIRED' }, 401);

  const view = request.nextUrl.searchParams.get('view');
  const quoteId = request.nextUrl.searchParams.get('quoteId');
  const input = view === 'health' ? { view } : { view, quoteId };

  const result = await executeOrchestrationQuery({
    viewer: {
      id: viewer.id,
      roles: viewer.roles,
      source: viewer.source,
      assuranceLevel: viewer.assuranceLevel
    },
    input
  });
  return noStore(result.body, result.status);
}
