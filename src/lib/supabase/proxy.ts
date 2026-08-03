import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { PublicSupabaseConfig } from '@/config/env-core';

export async function updateSupabaseSession(
  request: NextRequest,
  requestHeaders: Headers,
  config: PublicSupabaseConfig
) {
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  // getClaims verifies the token. getSession must not be used for authorisation.
  await supabase.auth.getClaims();
  return response;
}
