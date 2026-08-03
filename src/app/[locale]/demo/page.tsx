import { redirect } from 'next/navigation';
import { requireLocale } from '@/i18n/server';

export default async function DemoRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  redirect(`/${locale}#screens`);
}
