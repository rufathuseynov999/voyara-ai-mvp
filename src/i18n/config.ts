export const locales = ['az', 'ru', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'az';

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function localePath(locale: Locale, path = ''): string {
  const normalised = path === '/' ? '' : path.replace(/^\/+/, '');
  return normalised ? `/${locale}/${normalised}` : `/${locale}`;
}
