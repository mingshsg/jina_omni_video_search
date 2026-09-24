/**
 * Phase 4a/4b — deterministic local metadata suggestions from the saved title
 * (and optional caller language hint).
 *
 * Never persists. Never invents actors/country. Description/abstract drafts
 * only restate a cleaned work title — caveats live in `evidence`, never in
 * indexed values. External catalog lookup / generative wording remain a
 * later decision and are not implemented here.
 */

import {
  META_BOUNDS,
  PRIMARY_LANGUAGE_SET,
  VIDEO_TYPE_SET,
  canonicalizePrimaryLanguage,
  type PrimaryLanguage,
  type VideoType,
} from './catalogs';

/** Provenance for a draft field. `caller_hint` is never a verified media tag. */
export type SuggestFieldSource =
  | 'local_title'
  | 'media_tag'
  | 'caller_hint'
  | 'external_web';

export interface SuggestFieldDraft<T = string | number | string[]> {
  value: T;
  confidence: number;
  source: SuggestFieldSource;
  evidence: string;
  source_url?: string;
  retrieved_at?: string;
}

export interface LocalSuggestDraft {
  year?: number | null;
  video_type?: string | null;
  primary_language?: string | null;
  country?: string | null;
  description?: string | null;
  abstract?: string | null;
  tags?: string[] | null;
}

export interface LocalSuggestInput {
  title: string;
  /**
   * Optional language hint from the caller. Labeled `caller_hint`, never
   * `media_tag`, unless a future server path reads a verified probe tag.
   */
  media_language?: string | null;
  /** `en` | `zh` — wording for title-clue prose. */
  locale?: string;
  /**
   * Current editor draft. Suggestions are omitted for fields that already
   * have a non-empty value (saved or typed).
   */
  draft?: LocalSuggestDraft;
}

export interface TitleClues {
  /** Cleaned display string used for clue extraction. */
  normalized: string;
  /**
   * Residual work-title after stripping years, type decorations, and quality noise.
   * Empty when abstaining.
   */
  work_title: string;
  abstained: boolean;
  /** Why no description/abstract draft was produced (null when ok). */
  abstain_reason: string | null;
}

export interface LocalSuggestResult {
  title_clues: TitleClues;
  suggestions: {
    year?: SuggestFieldDraft<number>;
    video_type?: SuggestFieldDraft<string>;
    primary_language?: SuggestFieldDraft<string>;
    country?: SuggestFieldDraft<string>;
    description?: SuggestFieldDraft<string>;
    abstract?: SuggestFieldDraft<string>;
    tags?: SuggestFieldDraft<string[]>;
    /** Populated only by web/agent enrichment — no local source exists. */
    reference_urls?: SuggestFieldDraft<string[]>;
  };
}

/** Whole-title year tokens: 19xx / 20xx bounded by non-digits. */
const YEAR_RE = /(?:^|[^\d])((?:19|20)\d{2})(?=[^\d]|$)/g;

const MEDIA_EXT_RE =
  /\.(mp4|mkv|mov|webm|avi|m4v|mpg|mpeg|m2ts|ts|wmv|flv)$/i;

/** Terminal video-platform ids in the current demo filenames (11 chars). */
const PLATFORM_ID_SUFFIX_RE = /[_ .-]+([A-Za-z0-9_-]{11})$/;

/**
 * Letter ordering prefixes used by the demo corpus (`D_Title_…`, `H Hur Jun…`).
 * Underscore/dot/dash after any letter is safe. Spaced prefixes skip English
 * articles A/I so "A Beautiful Mind" is preserved.
 */
const DEMO_LETTER_PREFIX_RE =
  /^(?:[A-Z][_.-]+|[B-HJ-Z]\s+)(?=[\p{L}\p{N}])/u;

/** Leading catalog / disc order prefixes (e.g. `18_JurassicPark`). */
const LEADING_INDEX_RE = /^(?:\d{1,4}|CD\d+|DISC\d+)[_\-\s.]+/i;

/** File-level decorations commonly prefixed onto a work title. */
const DECORATION_PREFIX_RE =
  /^(?:(?:official|hd|new|exclusive)\s+)*(?:trailers?|teasers?|clips?)\s+/i;

/**
 * "Interview with …" is often the real title — do not strip a leading
 * Interview there. Other leading "Interview …" is treated as decoration.
 */
const INTERVIEW_PREFIX_RE = /^interviews?\s+(?!with\b)/i;

/** Trailing file-level decorations (`… Trailer`, `… Official Trailer`). */
const DECORATION_SUFFIX_RE =
  /\s+(?:(?:official|hd|new|exclusive)\s+)*(?:trailers?|teasers?|clips?|interviews?)\b/gi;

/** Common release / quality tokens — stripped for work-title, never suggested as tags. */
const NOISE_TOKEN_RE =
  /\b(?:\d{3,4}p|720|1080|1440|2160|4k|8k|hdr|uhd|bluray|blu-ray|webrip|web-dl|hdtv|x264|x265|h264|h265|hevc|aac|dts|remux|proper|repack|extended|unrated|sample|cam|hdcam|dvdrip|brrip)\b/gi;

/**
 * Source/editorial decorations that are not part of the work title.
 * Includes East-Asian broadcasters commonly glued onto drama filenames
 * (MBC / KBS / SBS / JTBC / tvN / …) and streaming labels.
 */
const CORPUS_DECORATION_RE =
  /\b(?:engsub|netflix|disney\+?|hulu|prime|amazon|hbo|bbc|mbc|kbs|sbs|jtbc|tvn|ena|ocn|bts|behind\s+the\s+scenes|making|kiss\s*reaction|reaction|costume|modern\s*rom\s*com|modernromcom|suspense|\d{1,2}m\d{2}s)\b/gi;

const GENERIC_TITLES = new Set([
  'untitled',
  'video',
  'clip',
  'download',
  'sample',
  'test',
  'unknown',
  'movie',
  'film',
  'new',
  'final',
  'copy',
  '未命名',
  '视频',
  '影片',
]);

/** File-level types beat work-level types when both match (trailer > movie). */
const FILE_LEVEL_TYPES = new Set<VideoType>([
  'trailer',
  'interview',
  'tv_episode',
  'ad',
  'ugc',
  'news',
  'sports',
]);

/**
 * Title tokens that map to controlled video_type values.
 */
const VIDEO_TYPE_ALIASES: Array<{ type: VideoType; pattern: RegExp }> = [
  { type: 'tv_episode', pattern: /\b(?:tv[_ -]?episode|s\d{1,2}e\d{1,3})\b/i },
  { type: 'documentary', pattern: /\bdocumentar(?:y|ies)\b/i },
  { type: 'interview', pattern: /\binterviews?\b/i },
  { type: 'trailer', pattern: /\btrailers?\b/i },
  { type: 'sports', pattern: /\bsports?\b/i },
  { type: 'news', pattern: /\bnews\b/i },
  { type: 'movie', pattern: /\bmovies?\b/i },
  { type: 'ad', pattern: /\b(?:ads?|commercials?)\b/i },
  { type: 'ugc', pattern: /\bugc\b/i },
];

/** Explicit title tokens that may become draft tags (controlled vocabulary). */
const TAG_TOKEN_ALIASES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'trailer', pattern: /\btrailers?\b/i },
  { tag: 'interview', pattern: /\binterviews?\b/i },
  { tag: 'documentary', pattern: /\bdocumentar(?:y|ies)\b/i },
  { tag: 'news', pattern: /\bnews\b/i },
  { tag: 'sports', pattern: /\bsports?\b/i },
  { tag: 'ugc', pattern: /\bugc\b/i },
  { tag: 'tv_episode', pattern: /\b(?:tv[_ -]?episode|s\d{1,2}e\d{1,3})\b/i },
];

function isEmptyYear(v: number | null | undefined): boolean {
  return v == null || !Number.isFinite(v);
}

function isEmptyText(v: string | null | undefined): boolean {
  return v == null || !String(v).trim();
}

function isEmptyTags(v: string[] | null | undefined): boolean {
  return v == null || v.length === 0;
}

function localeIsZh(locale: string | undefined): boolean {
  return (locale ?? 'en').toLowerCase().startsWith('zh');
}

/**
 * Normalize a saved asset title for clue extraction. Does not invent a
 * separate filename — only cleans the title string the editor already shows.
 */
export function normalizeTitle(raw: string): string {
  let s = (raw ?? '').normalize('NFKC').trim();
  s = s.replace(MEDIA_EXT_RE, '');
  s = s.replace(DEMO_LETTER_PREFIX_RE, '');
  const platformId = s.match(PLATFORM_ID_SUFFIX_RE);
  // Avoid deleting ordinary 11-letter title words. Demo platform IDs contain
  // at least one digit or an internal `_` / `-` marker.
  if (platformId?.[1] && /[\d_-]/.test(platformId[1])) {
    s = s.slice(0, platformId.index).trim();
  }
  // Dots/underscores as separators → spaces (keep mid-word hyphens).
  s = s.replace(/[._]+/g, ' ');
  s = s.replace(/[\[\(\{]+/g, ' ').replace(/[\]\)\}]+/g, ' ');
  // Remove known compact noise before CamelCase splitting (`BluRay`, S01E03).
  s = s.replace(NOISE_TOKEN_RE, ' ');
  s = s.replace(CORPUS_DECORATION_RE, ' ');
  s = s.replace(/\bAB\b/g, ' ');
  // Split Latin CamelCase, including acronym-to-word transitions (`AWish`).
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  s = s.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  s = s.replace(LEADING_INDEX_RE, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Residual work title after removing years and edge file decorations.
 * Mid-title words such as "Movie" in "My Movie" are preserved; trailing
 * "Trailer" / leading "Official Trailer" are stripped as decorations.
 */
export function extractWorkTitle(normalized: string): string {
  let s = normalized;
  s = s.replace(LEADING_INDEX_RE, '');
  s = s.replace(YEAR_RE, ' ');
  s = s.replace(DECORATION_PREFIX_RE, '');
  s = s.replace(INTERVIEW_PREFIX_RE, '');
  s = s.replace(DECORATION_SUFFIX_RE, ' ');
  s = s.replace(/\bS\d{1,2}E\d{1,3}\b/gi, ' ');
  s = s.replace(/[-–—|:]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Decide whether the title is strong enough for description/abstract drafts.
 */
export function analyzeTitleClues(rawTitle: string): TitleClues {
  const normalized = normalizeTitle(rawTitle);
  if (!normalized) {
    return {
      normalized: '',
      work_title: '',
      abstained: true,
      abstain_reason: 'empty_title',
    };
  }

  const work = extractWorkTitle(normalized);
  const key = work.toLowerCase();
  if (!work || work.length < 2) {
    return {
      normalized,
      work_title: '',
      abstained: true,
      abstain_reason: 'no_work_title',
    };
  }
  if (GENERIC_TITLES.has(key)) {
    return {
      normalized,
      work_title: work,
      abstained: true,
      abstain_reason: 'generic_title',
    };
  }
  // All residual tokens are generic fillers (e.g. "untitled clip").
  const tokens = key.split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => GENERIC_TITLES.has(t))) {
    return {
      normalized,
      work_title: work,
      abstained: true,
      abstain_reason: 'generic_title',
    };
  }
  // Single very short token (e.g. "A") — abstain.
  if (work.length < 3 && !/[\u3400-\u9fff]/.test(work)) {
    return {
      normalized,
      work_title: work,
      abstained: true,
      abstain_reason: 'too_short',
    };
  }

  return {
    normalized,
    work_title: work,
    abstained: false,
    abstain_reason: null,
  };
}

/**
 * Extract a single unambiguous year from a title. Multiple distinct years → none.
 */
export function suggestYearFromTitle(title: string): SuggestFieldDraft<number> | null {
  const years = new Set<number>();
  for (const match of title.matchAll(YEAR_RE)) {
    const y = Number(match[1]);
    if (y >= META_BOUNDS.yearMin && y <= META_BOUNDS.yearMax) {
      years.add(y);
    }
  }
  if (years.size !== 1) return null;
  const value = [...years][0]!;
  return {
    value,
    confidence: 0.55,
    source: 'local_title',
    evidence: `Unambiguous year ${value} in title`,
  };
}

/**
 * Extract a video_type from explicit title tokens.
 * File-level types (trailer, interview, episode, …) win over work-level
 * (movie, documentary) when both match.
 */
export function suggestVideoTypeFromTitle(
  title: string,
): SuggestFieldDraft<string> | null {
  const hits = new Set<VideoType>();
  for (const row of VIDEO_TYPE_ALIASES) {
    if (row.pattern.test(title)) {
      hits.add(row.type);
    }
  }
  if (hits.size === 0) return null;

  const fileHits = [...hits].filter((t) => FILE_LEVEL_TYPES.has(t));
  let chosen: VideoType | null = null;
  if (fileHits.length === 1) {
    chosen = fileHits[0]!;
  } else if (fileHits.length > 1) {
    return null;
  } else if (hits.size === 1) {
    chosen = [...hits][0]!;
  } else {
    return null;
  }

  if (!chosen || !VIDEO_TYPE_SET.has(chosen)) return null;
  return {
    value: chosen,
    confidence: 0.5,
    source: 'local_title',
    evidence: `Title token matched video_type=${chosen}`,
  };
}

/**
 * Map an explicit media language tag onto the pinned catalog.
 * Prefer server-verified probe tags; caller-supplied values use `caller_hint`.
 */
export function suggestLanguageFromMediaTag(
  mediaLanguage: string | null | undefined,
  opts?: { verified?: boolean },
): SuggestFieldDraft<string> | null {
  if (mediaLanguage == null || !String(mediaLanguage).trim()) return null;
  const canonical = canonicalizePrimaryLanguage(mediaLanguage);
  if (!canonical || !PRIMARY_LANGUAGE_SET.has(canonical)) return null;
  const verified = opts?.verified === true;
  return {
    value: canonical,
    confidence: verified ? 0.7 : 0.3,
    source: verified ? 'media_tag' : 'caller_hint',
    evidence: verified
      ? `Verified media language tag "${mediaLanguage.trim()}" → ${canonical}`
      : `Unverified caller language hint "${mediaLanguage.trim()}" → ${canonical}`,
  };
}

const TITLE_CAVEAT_EN =
  'Draft restates the title clue only — it does not claim scenes, dialogue, cast, or events in this file.';
const TITLE_CAVEAT_ZH =
  '此草稿仅复述标题含义，不表示本文件中确有对应场景、对白、演员或事件。';

/**
 * Concise title-clue description for indexing. Caveat stays in evidence only.
 */
export function suggestDescriptionFromTitle(
  clues: TitleClues,
  locale?: string,
): SuggestFieldDraft<string> | null {
  if (clues.abstained || !clues.work_title) return null;
  const work = clues.work_title;
  const zh = localeIsZh(locale);
  const value = zh ? `标题线索：「${work}」。` : `Title clue: “${work}”.`;
  if (value.length > META_BOUNDS.descriptionMax) return null;
  return {
    value,
    confidence: 0.35,
    source: 'local_title',
    evidence: `${zh ? TITLE_CAVEAT_ZH : TITLE_CAVEAT_EN} work_title="${work}"`,
  };
}

/** Short abstract from the same title clue (no caveat in the value). */
export function suggestAbstractFromTitle(
  clues: TitleClues,
  locale?: string,
): SuggestFieldDraft<string> | null {
  if (clues.abstained || !clues.work_title) return null;
  const work = clues.work_title;
  const zh = localeIsZh(locale);
  const value = zh ? `标题线索：${work}` : `Title clue: ${work}`;
  if (value.length > META_BOUNDS.abstractMax) return null;
  return {
    value,
    confidence: 0.35,
    source: 'local_title',
    evidence: `${zh ? TITLE_CAVEAT_ZH : TITLE_CAVEAT_EN} work_title="${work}"`,
  };
}

/**
 * Tags only from explicit controlled tokens in the title (+ unambiguous year).
 */
export function suggestTagsFromTitle(
  title: string,
): SuggestFieldDraft<string[]> | null {
  const tags: string[] = [];
  for (const row of TAG_TOKEN_ALIASES) {
    if (row.pattern.test(title) && !tags.includes(row.tag)) {
      tags.push(row.tag);
    }
  }
  const year = suggestYearFromTitle(title);
  if (year && !tags.includes(String(year.value))) {
    tags.push(String(year.value));
  }
  if (tags.length === 0) return null;
  const bounded = tags.slice(0, META_BOUNDS.tagsMax);
  return {
    value: bounded,
    confidence: 0.45,
    source: 'local_title',
    evidence: `Explicit title tokens → tags [${bounded.join(', ')}]`,
  };
}

/** Build local suggestions; omits fields already filled in the draft. */
export function buildLocalSuggestions(
  input: LocalSuggestInput,
): LocalSuggestResult {
  const title = input.title ?? '';
  const draft = input.draft ?? {};
  const clues = analyzeTitleClues(title);
  const suggestions: LocalSuggestResult['suggestions'] = {};

  if (isEmptyYear(draft.year)) {
    const year = suggestYearFromTitle(title);
    if (year) suggestions.year = year;
  }

  if (isEmptyText(draft.video_type)) {
    const videoType = suggestVideoTypeFromTitle(title);
    if (videoType) suggestions.video_type = videoType;
  }

  if (isEmptyText(draft.primary_language)) {
    const lang = suggestLanguageFromMediaTag(input.media_language, {
      verified: false,
    });
    if (lang) {
      suggestions.primary_language = lang as SuggestFieldDraft<string> & {
        value: PrimaryLanguage;
      };
    }
  }

  if (isEmptyText(draft.description)) {
    const description = suggestDescriptionFromTitle(clues, input.locale);
    if (description) suggestions.description = description;
  }

  if (isEmptyText(draft.abstract)) {
    const abstract = suggestAbstractFromTitle(clues, input.locale);
    if (abstract) suggestions.abstract = abstract;
  }

  if (isEmptyTags(draft.tags)) {
    const tags = suggestTagsFromTitle(title);
    if (tags) suggestions.tags = tags;
  }

  return { title_clues: clues, suggestions };
}
