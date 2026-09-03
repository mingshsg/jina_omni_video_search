import type { Locale } from './en';
import { ingestErrorsEn } from './en';
import { ingestErrorsZh } from './zh';
import type { IngestErrorCode } from '../ingest/errors';

export type { Locale };

const maps: Record<Locale, Record<IngestErrorCode, string>> = {
  en: ingestErrorsEn,
  zh: ingestErrorsZh,
};

export function ingestErrorMessage(
  code: IngestErrorCode,
  locale: Locale = 'en',
): string {
  return maps[locale][code] ?? ingestErrorsEn[code];
}

export function resolveLocale(
  acceptLanguage: string | null,
  defaultLocale: Locale = 'en',
): Locale {
  if (!acceptLanguage) return defaultLocale;
  const lower = acceptLanguage.toLowerCase();
  if (lower.includes('zh')) return 'zh';
  if (lower.includes('en')) return 'en';
  return defaultLocale;
}
