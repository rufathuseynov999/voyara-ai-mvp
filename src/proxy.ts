import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { readPublicSupabaseConfig } from '@/config/env-core';
import { defaultLocale, isLocale } from '@/i18n/config';
import { updateSupabaseSession } from '@/lib/supabase/proxy';

function contentSecurityPolicy(nonce: string, supabaseOrigin: string | null): string {
  const connectSources = ["'self'", supabaseOrigin].filter(Boolean).join(' ');
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : null]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    process.env.NODE_ENV === 'production' ? 'upgrade-insecure-requests' : null
  ]
    .filter(Boolean)
    .join('; ');
}

function applySecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  response.headers.set('Origin-Agent-Cluster', '?1');
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(randomUUID()).toString('base64');
  const config = readPublicSupabaseConfig();
  const supabaseOrigin = config ? new URL(config.url).origin : null;
  const csp = contentSecurityPolicy(nonce, supabaseOrigin);

  if (request.nextUrl.pathname === '/') {
    return applySecurityHeaders(NextResponse.redirect(new URL(`/${defaultLocale}`, request.url)), csp);
  }

  const localeSegment = request.nextUrl.pathname.split('/').filter(Boolean)[0];
  const locale = isLocale(localeSegment) ? localeSegment : defaultLocale;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-voyara-locale', locale);
  requestHeaders.set('x-voyara-pathname', request.nextUrl.pathname);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = config
    ? await updateSupabaseSession(request, requestHeaders, config)
    : NextResponse.next({ request: { headers: requestHeaders } });

  return applySecurityHeaders(response, csp);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
};
