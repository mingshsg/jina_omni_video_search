/**
 * Pinned catalogs shared by metadata validation, Library editor facets,
 * and (later) the Phase 3.5 query matcher.
 */

/** Controlled video_type starter set (plan §A2). */
export const VIDEO_TYPES = [
  'trailer',
  'movie',
  'tv_episode',
  'documentary',
  'interview',
  'news',
  'sports',
  'ugc',
  'ad',
  'other',
] as const;

export type VideoType = (typeof VIDEO_TYPES)[number];

export const VIDEO_TYPE_SET: ReadonlySet<string> = new Set(VIDEO_TYPES);

/**
 * MVP production country/region catalog — ISO-3166-1 alpha-2 codes.
 * Exactly 20 options; HK/TW are region choices. Store the code only.
 */
export const COUNTRY_OPTIONS = [
  { code: 'DE', name_en: 'Germany', name_zh: '德国' },
  { code: 'FR', name_en: 'France', name_zh: '法国' },
  { code: 'IT', name_en: 'Italy', name_zh: '意大利' },
  { code: 'ES', name_en: 'Spain', name_zh: '西班牙' },
  { code: 'NL', name_en: 'Netherlands', name_zh: '荷兰' },
  { code: 'PL', name_en: 'Poland', name_zh: '波兰' },
  { code: 'SE', name_en: 'Sweden', name_zh: '瑞典' },
  { code: 'IE', name_en: 'Ireland', name_zh: '爱尔兰' },
  { code: 'CN', name_en: 'China', name_zh: '中国' },
  { code: 'HK', name_en: 'Hong Kong', name_zh: '香港' },
  { code: 'TW', name_en: 'Taiwan', name_zh: '台湾' },
  { code: 'KR', name_en: 'South Korea', name_zh: '韩国' },
  { code: 'JP', name_en: 'Japan', name_zh: '日本' },
  { code: 'SG', name_en: 'Singapore', name_zh: '新加坡' },
  { code: 'MY', name_en: 'Malaysia', name_zh: '马来西亚' },
  { code: 'ID', name_en: 'Indonesia', name_zh: '印度尼西亚' },
  { code: 'TH', name_en: 'Thailand', name_zh: '泰国' },
  { code: 'VN', name_en: 'Vietnam', name_zh: '越南' },
  { code: 'PH', name_en: 'Philippines', name_zh: '菲律宾' },
  { code: 'US', name_en: 'United States', name_zh: '美国' },
] as const;

export type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code'];

export const COUNTRY_CODE_SET: ReadonlySet<string> = new Set(
  COUNTRY_OPTIONS.map((c) => c.code),
);

/** Pinned BCP-47-ish language tags for primary_language. */
export const PRIMARY_LANGUAGES = [
  'en',
  'zh',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'sv',
  'th',
  'vi',
  'id',
  'ms',
  'tl',
  'other',
] as const;

export type PrimaryLanguage = (typeof PRIMARY_LANGUAGES)[number];

export const PRIMARY_LANGUAGE_SET: ReadonlySet<string> = new Set(
  PRIMARY_LANGUAGES,
);

/** Case-insensitive resolve to the pinned catalog spelling (e.g. zh-Hans). */
export function canonicalizePrimaryLanguage(
  raw: string,
): PrimaryLanguage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const lang of PRIMARY_LANGUAGES) {
    if (lang.toLowerCase() === lower) return lang;
  }
  return null;
}

export const META_BOUNDS = {
  descriptionMax: 4000,
  abstractMax: 500,
  actorsMax: 30,
  tagsMax: 30,
  actorIdMaxLen: 100,
  tagMaxLen: 64,
  yearMin: 1800,
  yearMax: 2100,
  facetArrayMax: 20,
} as const;

export function countryLabel(
  code: string,
  locale: 'en' | 'zh' = 'en',
): string {
  const row = COUNTRY_OPTIONS.find((c) => c.code === code);
  if (!row) return code;
  const name = locale === 'zh' ? row.name_zh : row.name_en;
  return `${row.code} — ${name}`;
}
