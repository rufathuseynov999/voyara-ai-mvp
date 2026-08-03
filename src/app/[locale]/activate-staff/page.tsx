import { StaffActivation } from '@/components/staff-activation';
import { readPublicSupabaseConfig } from '@/config/env-core';
import { getDictionary } from '@/i18n/dictionaries';
import { requireLocale } from '@/i18n/server';

export default async function ActivateStaffPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const dictionary = getDictionary(locale);
  const nextPath = `/${locale}/mfa?next=${encodeURIComponent(`/${locale}/staff`)}`;

  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <span className="eyebrow">{dictionary.common.protected}</span>
        <h1>{dictionary.staffActivation.title}</h1>
        <p>{dictionary.staffActivation.body}</p>
        {readPublicSupabaseConfig() ? (
          <StaffActivation
            failed={dictionary.staffActivation.failed}
            loading={dictionary.staffActivation.loading}
            nextPath={nextPath}
          />
        ) : (
          <div className="auth-notice">{dictionary.auth.configuration}</div>
        )}
      </section>
    </main>
  );
}
