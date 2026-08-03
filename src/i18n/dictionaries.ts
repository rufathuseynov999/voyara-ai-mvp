import az from './messages/az.json';
import en from './messages/en.json';
import ru from './messages/ru.json';
import type { Locale } from './config';

const dictionaries = { az, ru, en } as const;

export type Dictionary = typeof az;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
