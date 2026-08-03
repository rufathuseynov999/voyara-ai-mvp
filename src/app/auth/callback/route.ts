import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { safeLocalPath } from '@/server/auth/redirects';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const nextPath = safeLocalPath(request.nextUrl.searchParams.get('next'));
  const supabase = await createServerSupabaseClient();

  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(nextPath, request.url));
  }

  const locale = nextPath.split('/').filter(Boolean)[0] ?? 'az';
  return NextResponse.redirect(new URL(`/${locale}/login?error=callback`, request.url));
}
