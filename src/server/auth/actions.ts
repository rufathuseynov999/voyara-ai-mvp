'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isLocale } from '@/i18n/config';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getViewer } from './viewer';

const logoutSchema = z.object({
  locale: z.string().refine(isLocale),
  scope: z.enum(['local', 'global'])
});

export async function logoutAction(formData: FormData) {
  const parsed = logoutSchema.safeParse({ locale: formData.get('locale'), scope: formData.get('scope') });
  if (!parsed.success) redirect('/az/login');

  const { locale, scope } = parsed.data;
  const viewer = await getViewer();
  if (!viewer || viewer.source === 'demo') redirect(`/${locale}/login`);

  const admin = createAdminSupabaseClient();
  const userClient = await createServerSupabaseClient();
  if (!admin || !userClient) throw new Error('AUTH_CONFIGURATION_UNAVAILABLE');

  if (scope === 'local') {
    const { error } = await admin.from('session_revocations').insert({
      session_id: viewer.sessionId,
      user_id: viewer.id,
      revoked_by: viewer.id,
      reason: 'user_logout'
    });
    if (error && error.code !== '23505') throw new Error('SESSION_REVOCATION_FAILED');
  } else {
    const { error } = await admin.from('user_session_security').upsert(
      {
        user_id: viewer.id,
        revoked_before: new Date().toISOString(),
        updated_by: viewer.id,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error('GLOBAL_SESSION_REVOCATION_FAILED');
  }

  await userClient.auth.signOut({ scope });
  redirect(`/${locale}/login?signed_out=1`);
}
