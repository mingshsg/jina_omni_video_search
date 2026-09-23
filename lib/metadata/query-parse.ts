/**
 * Deterministic query matcher (Phase 3.5 C1).
 * Shapes search *inputs* only — never scores or reorders results.
 */
import {
  COUNTRY_OPTIONS,
  VIDEO_TYPES,
  type CountryCode,
  type VideoType,
} from './catalogs';
import { findContainedAliases } from './people';

export type QueryParserKind = 'dictionary' | 'eis' | 'raw' | 'disabled' | 'unavailable';

export interface ParsedQueryExtraction {
  actor_ids?: string[];
  year_from?: number;
  year_to?: number;
  country?: CountryCode[];
  video_type?: VideoType[];
}

export interface ParseRejection {
  field: string;
  value: string;
  reason: string;
}

export interface DictionaryParseResult {
  parser: 'dictionary';
  vector_query: string;
  free_text: string;
  scene_terms_present: boolean;
  extracted: ParsedQueryExtraction;
  applied: ParsedQueryExtraction;
  rejected: ParseRejection[];
  confidence: Record<string, number>;
  elapsed_ms: number;
  cache: 'hit' | 'miss';
}

/** Unified parse result across dictionary / EIS / raw tiers. */
export interface QueryParseResult {
  parser: QueryParserKind;
  vector_query: string;
  free_text: string;
  scene_terms_present: boolean;
  extracted: ParsedQueryExtraction;
  applied: ParsedQueryExtraction;
  rejected: ParseRejection[];
  confidence: Record<string, number>;
  elapsed_ms: number;
  cache: 'hit' | 'miss';
  eis_skipped?: boolean;
  eis_skip_reason?: string;
  repair_attempted?: boolean;
  /** Set when EIS ran; never includes secrets. */
  inference_id?: string;
}


/** Demonym / place-name → ISO code (longest match first). */
export const COUNTRY_DEMONYMS: Array<{ phrase: string; code: CountryCode }> = [
  { phrase: 'south korea', code: 'KR' },
  { phrase: 'united states', code: 'US' },
  { phrase: 'hong kong', code: 'HK' },
  { phrase: 'singapore', code: 'SG' },
  { phrase: 'indonesia', code: 'ID' },
  { phrase: 'philippines', code: 'PH' },
  { phrase: 'malaysia', code: 'MY' },
  { phrase: 'thailand', code: 'TH' },
  { phrase: 'vietnam', code: 'VN' },
  { phrase: 'germany', code: 'DE' },
  { phrase: 'france', code: 'FR' },
  { phrase: 'italy', code: 'IT' },
  { phrase: 'spain', code: 'ES' },
  { phrase: 'netherlands', code: 'NL' },
  { phrase: 'poland', code: 'PL' },
  { phrase: 'sweden', code: 'SE' },
  { phrase: 'ireland', code: 'IE' },
  { phrase: 'china', code: 'CN' },
  { phrase: 'taiwan', code: 'TW' },
  { phrase: 'japan', code: 'JP' },
  { phrase: 'korean', code: 'KR' },
  { phrase: 'korea', code: 'KR' },
  { phrase: 'american', code: 'US' },
  { phrase: 'chinese', code: 'CN' },
  { phrase: 'japanese', code: 'JP' },
  { phrase: 'french', code: 'FR' },
  { phrase: 'german', code: 'DE' },
  { phrase: 'italian', code: 'IT' },
  { phrase: 'spanish', code: 'ES' },
  { phrase: 'dutch', code: 'NL' },
  { phrase: 'swedish', code: 'SE' },
  { phrase: 'irish', code: 'IE' },
  { phrase: 'polish', code: 'PL' },
  { phrase: 'thai', code: 'TH' },
  { phrase: 'vietnamese', code: 'VN' },
  { phrase: 'indonesian', code: 'ID' },
  { phrase: 'malaysian', code: 'MY' },
  { phrase: 'filipino', code: 'PH' },
  { phrase: '新加坡', code: 'SG' },
  { phrase: '印度尼西亚', code: 'ID' },
  { phrase: '菲律宾', code: 'PH' },
  { phrase: '马来西亚', code: 'MY' },
  { phrase: '泰国', code: 'TH' },
  { phrase: '越南', code: 'VN' },
  { phrase: '德国', code: 'DE' },
  { phrase: '法国', code: 'FR' },
  { phrase: '意大利', code: 'IT' },
  { phrase: '西班牙', code: 'ES' },
  { phrase: '荷兰', code: 'NL' },
  { phrase: '波兰', code: 'PL' },
  { phrase: '瑞典', code: 'SE' },
  { phrase: '爱尔兰', code: 'IE' },
  { phrase: '中国', code: 'CN' },
  { phrase: '香港', code: 'HK' },
  { phrase: '台湾', code: 'TW' },
  { phrase: '韩国', code: 'KR' },
  { phrase: '日本', code: 'JP' },
  { phrase: '美国', code: 'US' },
  { phrase: '한국', code: 'KR' },
  { phrase: '일본', code: 'JP' },
  { phrase: '중국', code: 'CN' },
  { phrase: '미국', code: 'US' },
  ...COUNTRY_OPTIONS.map((c) => ({
    phrase: c.name_en.toLowerCase(),
    code: c.code as CountryCode,
  })),
];

/** Synonym → controlled video_type. */
export const VIDEO_TYPE_SYNONYMS: Array<{ phrase: string; type: VideoType }> = [
  { phrase: 'tv episode', type: 'tv_episode' },
  { phrase: 'tv_episode', type: 'tv_episode' },
  { phrase: 'documentary', type: 'documentary' },
  { phrase: 'interview', type: 'interview' },
  { phrase: 'trailer', type: 'trailer' },
  { phrase: 'movie', type: 'movie' },
  { phrase: 'film', type: 'movie' },
  { phrase: 'news', type: 'news' },
  { phrase: 'sports', type: 'sports' },
  { phrase: 'sport', type: 'sports' },
  { phrase: 'ugc', type: 'ugc' },
  { phrase: 'ad', type: 'ad' },
  { phrase: 'advert', type: 'ad' },
  { phrase: 'commercial', type: 'ad' },
  { phrase: '纪录片', type: 'documentary' },
  { phrase: '访谈', type: 'interview' },
  { phrase: '预告片', type: 'trailer' },
  { phrase: '电影', type: 'movie' },
  { phrase: '新闻', type: 'news' },
  { phrase: '体育', type: 'sports' },
  { phrase: '广告', type: 'ad' },
  ...VIDEO_TYPES.map((t) => ({ phrase: t, type: t })),
];

function isLatinWordBoundary(hay: string, start: number, end: number): boolean {
  const span = hay.slice(start, end);
  if (!/[a-z0-9]/i.test(span)) return true;
  const before = start === 0 ? '' : hay[start - 1]!;
  const after = end >= hay.length ? '' : hay[end]!;
  const word = /[a-z0-9]/i;
  if (before && word.test(before)) return false;
  if (after && word.test(after)) return false;
  return true;
}

function markSpan(
  occupied: boolean[],
  start: number,
  end: number,
): boolean {
  for (let i = start; i < end; i++) {
    if (occupied[i]) return false;
  }
  for (let i = start; i < end; i++) occupied[i] = true;
  return true;
}

function findPhraseMatches(
  hayLower: string,
  phrases: Array<{ phrase: string; value: string }>,
  occupied: boolean[],
): Array<{ phrase: string; value: string; start: number; end: number }> {
  const sorted = phrases
    .map((p) => ({
      phrase: p.phrase.normalize('NFKC').toLowerCase().trim(),
      value: p.value,
    }))
    .filter((p) => p.phrase.length > 0)
    .sort((a, b) => b.phrase.length - a.phrase.length);

  const out: Array<{ phrase: string; value: string; start: number; end: number }> =
    [];
  for (const { phrase, value } of sorted) {
    let from = 0;
    while (from <= hayLower.length - phrase.length) {
      const idx = hayLower.indexOf(phrase, from);
      if (idx < 0) break;
      const end = idx + phrase.length;
      if (isLatinWordBoundary(hayLower, idx, end) && markSpan(occupied, idx, end)) {
        out.push({ phrase, value, start: idx, end });
        break;
      }
      from = idx + 1;
    }
  }
  return out;
}

/** Year / decade patterns. */
export function extractYears(query: string): {
  year_from?: number;
  year_to?: number;
  spans: Array<{ start: number; end: number }>;
  rejected: ParseRejection[];
} {
  const rejected: ParseRejection[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const hay = query.normalize('NFKC');

  const decade = /\b((?:19|20)\d{2})\s*s\b/gi;
  let m: RegExpExecArray | null;
  let yearFrom: number | undefined;
  let yearTo: number | undefined;

  while ((m = decade.exec(hay)) !== null) {
    const y = Number(m[1]);
    yearFrom = yearFrom == null ? y : Math.min(yearFrom, y);
    yearTo = yearTo == null ? y + 9 : Math.max(yearTo, y + 9);
    spans.push({ start: m.index, end: m.index + m[0].length });
  }

  const cnDecade = /(\d{2})\s*年代/g;
  while ((m = cnDecade.exec(hay)) !== null) {
    const yy = Number(m[1]);
    const y = yy >= 80 ? 1900 + yy : 2000 + yy;
    if (y < 1800 || y > 2100) {
      rejected.push({ field: 'year', value: m[0], reason: 'out of range' });
    } else {
      yearFrom = yearFrom == null ? y : Math.min(yearFrom, y);
      yearTo = yearTo == null ? y + 9 : Math.max(yearTo, y + 9);
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  const before = /\bbefore\s+((?:19|20)\d{2})\b/gi;
  while ((m = before.exec(hay)) !== null) {
    const y = Number(m[1]);
    yearTo = yearTo == null ? y - 1 : Math.min(yearTo, y - 1);
    spans.push({ start: m.index, end: m.index + m[0].length });
  }

  const after = /\bafter\s+((?:19|20)\d{2})\b/gi;
  while ((m = after.exec(hay)) !== null) {
    const y = Number(m[1]);
    yearFrom = yearFrom == null ? y + 1 : Math.max(yearFrom, y + 1);
    spans.push({ start: m.index, end: m.index + m[0].length });
  }

  const single = /\b((?:19|20)\d{2})\b/g;
  while ((m = single.exec(hay)) !== null) {
    // Skip if already covered by a longer span
    const start = m.index;
    const end = m.index + m[0].length;
    if (spans.some((s) => start >= s.start && end <= s.end)) continue;
    const y = Number(m[1]);
    yearFrom = yearFrom == null ? y : Math.min(yearFrom, y);
    yearTo = yearTo == null ? y : Math.max(yearTo, y);
    spans.push({ start, end });
  }

  return { year_from: yearFrom, year_to: yearTo, spans, rejected };
}

function stripSpans(query: string, spans: Array<{ start: number; end: number }>): string {
  if (spans.length === 0) return query.trim();
  const sorted = spans.slice().sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const s of sorted) {
    if (s.start < cursor) continue;
    out += query.slice(cursor, s.start);
    out += ' ';
    cursor = s.end;
  }
  out += query.slice(cursor);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Dictionary parse of a free-text query into multi-field inputs.
 * Catalog-validated only; unrecognized values go to `rejected`.
 */
export function parseQueryDictionary(query: string): DictionaryParseResult {
  const t0 = performance.now();
  const raw = query.normalize('NFKC');
  const hayLower = raw.toLowerCase();
  const occupied = new Array<boolean>(hayLower.length).fill(false);
  const rejected: ParseRejection[] = [];
  const confidence: Record<string, number> = {};
  const extracted: ParsedQueryExtraction = {};
  const spans: Array<{ start: number; end: number }> = [];

  // Actors — longest catalog aliases first.
  const actors = findContainedAliases(raw);
  if (actors.length > 0) {
    const ids = [...new Set(actors.map((a) => a.person_id))];
    extracted.actor_ids = ids;
    confidence.actor_ids = 0.95;
    for (const a of actors) {
      markSpan(occupied, a.start, a.end);
      spans.push({ start: a.start, end: a.end });
    }
  }

  // Countries
  const countryHits = findPhraseMatches(
    hayLower,
    COUNTRY_DEMONYMS.map((d) => ({ phrase: d.phrase, value: d.code })),
    occupied,
  );
  if (countryHits.length > 0) {
    const codes = [...new Set(countryHits.map((h) => h.value as CountryCode))];
    extracted.country = codes;
    confidence.country = 0.85;
    for (const h of countryHits) spans.push({ start: h.start, end: h.end });
  }

  // Video types
  const typeHits = findPhraseMatches(
    hayLower,
    VIDEO_TYPE_SYNONYMS.map((d) => ({ phrase: d.phrase, value: d.type })),
    occupied,
  );
  if (typeHits.length > 0) {
    const types = [...new Set(typeHits.map((h) => h.value as VideoType))];
    extracted.video_type = types;
    confidence.video_type = 0.8;
    for (const h of typeHits) spans.push({ start: h.start, end: h.end });
  }

  // Years
  const years = extractYears(raw);
  rejected.push(...years.rejected);
  for (const s of years.spans) {
    if (markSpan(occupied, s.start, s.end)) spans.push(s);
  }
  if (years.year_from != null || years.year_to != null) {
    if (years.year_from != null) extracted.year_from = years.year_from;
    if (years.year_to != null) extracted.year_to = years.year_to;
    confidence.year = 0.9;
  }

  const residual = stripSpans(raw, spans);
  const freeParts: string[] = [];
  if (extracted.actor_ids?.length) {
    freeParts.push(...actors.map((a) => a.alias));
  }
  // Bug fix (todo/22 F2): free_text previously dropped the residual whenever
  // an actor matched, so title terms ("Roman Holiday") never reached BM25 for
  // a query like "Audrey Hepburn Roman Holiday" — only the actor alias did.
  // free_text must carry alias terms *and* whatever text remains, which is
  // exactly why the structured bool.should (not a flat multi_match) was
  // chosen: a name can straddle fields, alias in meta.search_text and title
  // in `title`.
  if (residual) {
    freeParts.push(residual);
  }
  const free_text = freeParts.length > 0 ? freeParts.join(' ') : raw.trim();
  const vector_query = residual;
  const scene_terms_present = residual.length > 0;

  // applied = extracted for dictionary (boosts applied later by ranking layer)
  const applied: ParsedQueryExtraction = { ...extracted };

  return {
    parser: 'dictionary',
    vector_query: vector_query || raw.trim(),
    free_text,
    scene_terms_present,
    extracted,
    applied,
    rejected,
    confidence,
    elapsed_ms: Math.round(performance.now() - t0),
    cache: 'miss',
  };
}

/**
 * Drop extracted facets that the operator already selected as hard filters
 * (filter wins — never double-count as boosts).
 */
export function boostsMinusHardFilters(
  extracted: ParsedQueryExtraction,
  filters: {
    actor_ids?: string[];
    year_from?: number;
    year_to?: number;
    country?: string[];
    video_type?: string[];
  } | null | undefined,
): ParsedQueryExtraction {
  const out: ParsedQueryExtraction = { ...extracted };
  if (!filters) return out;

  if (filters.actor_ids && filters.actor_ids.length > 0) {
    delete out.actor_ids;
  }
  if (filters.year_from != null || filters.year_to != null) {
    delete out.year_from;
    delete out.year_to;
  }
  if (filters.country && filters.country.length > 0) {
    delete out.country;
  }
  if (filters.video_type && filters.video_type.length > 0) {
    delete out.video_type;
  }
  return out;
}
