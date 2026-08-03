'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function StaffActivation({ loading, failed, nextPath }: { loading: string; failed: string; nextPath: string }) {
  const [status, setStatus] = useState<'loading' | 'failed'>('loading');

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let active = true;

    async function continueWhenVerified() {
      const { data, error } = await supabase.auth.getClaims();
      if (active && !error && data?.claims?.sub) window.location.replace(nextPath);
    }

    void continueWhenVerified();
    const { data } = supabase.auth.onAuthStateChange(() => {
      void continueWhenVerified();
    });
    const timeout = window.setTimeout(() => active && setStatus('failed'), 12_000);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      data.subscription.unsubscribe();
    };
  }, [nextPath]);

  return <p aria-live={status === 'failed' ? 'assertive' : 'polite'}>{status === 'loading' ? loading : failed}</p>;
}
