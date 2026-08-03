import { defaultLocale, isLocale, type Locale } from '@/i18n/config';

const localOrigin = 'https://voyara.invalid';

export function safeLocalPath(value: unknown, fallback = `/${defaultLocale}`): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }

  try {
    const parsed = new URL(value, localOrigin);
    const decodedPathname = decodeURIComponent(parsed.pathname);
    const localeSegment = parsed.pathname.split('/').filter(Boolean)[0];
    if (
      parsed.origin !== localOrigin
      || decodedPathname.startsWith('//')
      || decodedPathname.includes('\\')
      || !isLocale(localeSegment)
    ) return fallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

export function safeLocalePath(value: unknown, locale: Locale, fallback = `/${locale}`): string {
  const candidate = safeLocalPath(value, fallback);
  return candidate === `/${locale}` || candidate.startsWith(`/${locale}/`) || candidate.startsWith(`/${locale}?`)
    ? candidate
    : fallback;
}
