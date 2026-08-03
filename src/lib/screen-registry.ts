import type { Locale } from '@/i18n/config';

export type ScreenKey =
  | 'landing'
  | 'wizard'
  | 'proposal'
  | 'approvals'
  | 'founder'
  | 'tripRoom'
  | 'payment'
  | 'crm';

export type ScreenAudience = 'public' | 'customer' | 'staff';

export type ScreenDefinition = {
  key: ScreenKey;
  route: (locale: Locale) => string;
  audience: ScreenAudience;
  legacyId: `s${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
};

export const screenRegistry: readonly ScreenDefinition[] = [
  { key: 'landing', route: (locale) => `/${locale}`, audience: 'public', legacyId: 's1' },
  { key: 'wizard', route: (locale) => `/${locale}/trip-wizard`, audience: 'public', legacyId: 's2' },
  { key: 'proposal', route: (locale) => `/${locale}/proposal`, audience: 'customer', legacyId: 's3' },
  { key: 'approvals', route: (locale) => `/${locale}/staff/approvals`, audience: 'staff', legacyId: 's4' },
  { key: 'founder', route: (locale) => `/${locale}/staff/founder`, audience: 'staff', legacyId: 's5' },
  { key: 'tripRoom', route: (locale) => `/${locale}/trip-room`, audience: 'customer', legacyId: 's6' },
  { key: 'payment', route: (locale) => `/${locale}/payment`, audience: 'customer', legacyId: 's7' },
  { key: 'crm', route: (locale) => `/${locale}/staff/crm`, audience: 'staff', legacyId: 's8' }
] as const;

export function screenByKey(key: ScreenKey): ScreenDefinition {
  const screen = screenRegistry.find((candidate) => candidate.key === key);
  if (!screen) throw new Error(`Unknown VOYARA screen: ${key}`);
  return screen;
}
