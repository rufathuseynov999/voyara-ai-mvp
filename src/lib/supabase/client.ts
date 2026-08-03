'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error('Supabase browser configuration is unavailable.');
  }
  if (!publishableKey.startsWith('sb_publishable_')) {
    throw new Error('Use a Supabase publishable key in browser code.');
  }

  return createBrowserClient(url, publishableKey);
}
