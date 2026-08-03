import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { readHealthToken } from '@/config/env';
import { readinessHealth } from '@/server/bos/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  let configured: string | null = null;
  try {
    configured = readHealthToken();
  } catch {
    return false;
  }
  const supplied = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? null;
  if (!configured || !supplied) return false;
  const configuredBytes = Buffer.from(configured);
  const suppliedBytes = Buffer.from(supplied);
  return configuredBytes.length === suppliedBytes.length
    && timingSafeEqual(configuredBytes, suppliedBytes);
}

function responseHeaders() {
  return {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: 'HEALTH_AUTHENTICATION_REQUIRED' },
      {
        status: 401,
        headers: { ...responseHeaders(), 'WWW-Authenticate': 'Bearer' }
      }
    );
  }

  const health = await readinessHealth();
  return NextResponse.json(health, {
    status: health.status === 'ready' ? 200 : 503,
    headers: responseHeaders()
  });
}
