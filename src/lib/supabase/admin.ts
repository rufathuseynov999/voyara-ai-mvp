import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { readServerSupabaseAdminConfig } from '@/config/env-core';

export function createAdminSupabaseClient() {
  const config = readServerSupabaseAdminConfig();
  if (!config) return null;

  return createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}
