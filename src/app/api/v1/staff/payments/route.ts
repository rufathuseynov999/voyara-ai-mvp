import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/server/auth/viewer';
import { executePaymentCommand } from '@/server/payment/command';
import { staffPaymentCommandSchema } from '@/server/payment/contract';

const idempotencyKeySchema = z.string().min(12).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const maximumBodyBytes = 32_768;
const financeReviewRoles = ['finance', 'admin', 'founder'] as const;
const allocationRoles = ['finance', 'founder'] as const;

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

function deniedStatus(reasonCode?: string): number {
  if (reasonCode === 'RATE_LIMITED') return 429;
  if (
    reasonCode?.includes('STATE')
    || reasonCode?.includes('MISMATCH')
    || reasonCode?.includes('EXISTS')
  ) return 409;
  if (reasonCode?.includes('INVALID') || reasonCode?.includes('REQUIRED')) return 400;
  return 403;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStore({ error: 'REQUEST_ORIGIN_DENIED' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return noStore({ error: 'JSON_REQUIRED' }, 415);
  }
  const viewer = await getViewer();
  if (!viewer) return noStore({ error: 'AUTHENTICATION_REQUIRED' }, 401);
  if (!financeReviewRoles.some((role) => viewer.roles.includes(role))) {
    return noStore({ error: 'FINANCE_AUTHORITY_REQUIRED' }, 403);
  }
  if (viewer.assuranceLevel !== 'aal2') return noStore({ error: 'AAL2_REQUIRED' }, 403);

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

  const input = staffPaymentCommandSchema.safeParse(json);
  if (!input.success) return noStore({ error: 'INVALID_PAYMENT_COMMAND' }, 400);
  if (
    ['funds.allocate', 'payment.evaluate_readiness'].includes(input.data.action)
    && !allocationRoles.some((role) => viewer.roles.includes(role))
  ) {
    return noStore({ error: 'ALLOCATION_AUTHORITY_REQUIRED' }, 403);
  }

  try {
    const result = await executePaymentCommand(viewer, input.data, idempotencyKey.data);
    if (result.status === 'denied') return noStore(result, deniedStatus(result.reasonCode));
    return noStore(result, 200);
  } catch {
    return noStore({ error: 'PAYMENT_COMMAND_FAILED' }, 500);
  }
}
