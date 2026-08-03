import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { safeLocalPath } from '@/server/auth/redirects';

const permittedTypes = new Set<EmailOtpType>(['invite', 'magiclink', 'signup', 'recovery']);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const nextPath = safeLocalPath(request.nextUrl.searchParams.get('next'));
  const supabase = await createServerSupabaseClient();

  if (tokenHash && type && permittedTypes.has(type) && supabase) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(nextPath, request.url));
  }

  const locale = nextPath.split('/').filter(Boolean)[0] ?? 'az';
  return NextResponse.redirect(new URL(`/${locale}/login?error=confirmation`, request.url));
}
