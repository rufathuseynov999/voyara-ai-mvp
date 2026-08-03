import 'server-only';
import { headers } from 'next/headers';
import type { Locale } from '@/i18n/config';
import { safeLocalePath } from './redirects';

export async function readRequestedPath(locale: Locale, fallback: string): Promise<string> {
  const requestHeaders = await headers();
  return safeLocalePath(requestHeaders.get('x-voyara-pathname'), locale, fallback);
}
