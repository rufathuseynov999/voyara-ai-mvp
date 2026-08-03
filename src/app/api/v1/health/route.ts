import { NextResponse } from 'next/server';
import { livenessHealth } from '@/server/bos/health';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(livenessHealth(), {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}
