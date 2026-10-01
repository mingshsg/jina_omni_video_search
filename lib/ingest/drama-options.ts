/**
 * Drama enrichment option catalogs + resolved request shape (plan/12).
 */
export const DRAMA_LANGUAGES = ['zh', 'en', 'ko', 'th'] as const;
export type DramaLanguage = (typeof DRAMA_LANGUAGES)[number];

export const DRAMA_MODULES = [
  'subtitles',
  'structure',
  'directors_script',
  'key_actors',
  'key_scenes',
] as const;
export type DramaModule = (typeof DRAMA_MODULES)[number];

/** Status of the follow-on drama job (after embed `ready`). */
export type DramaEnrichmentStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'skipped';

/**
 * Per-run subtitle resolution policy (plan/12 P4).
 * - `auto`: matching sidecar → matching embedded stream → host SRT → configured ASR.
 * - `existing_only`: sidecar/embedded only; never call ASR. Missing
 *   language-tagged source fails that language visibly.
 * - `force_asr`: skip sidecar/embedded; require host/configured ASR.
 *   When EN and ZH are both requested, an available timed original is
 *   translated to the missing language rather than transcribing twice.
 */
export const DRAMA_SUBTITLE_SOURCES = [
  'auto',
  'existing_only',
  'force_asr',
] as const;
export type DramaSubtitleSource = (typeof DRAMA_SUBTITLE_SOURCES)[number];

/**
 * Director coverage policy (plan/12 P4). Only `sampled` is offered: full
 * coverage generation/audit is not implemented, so "full episode" is never
 * selectable. `sampled` caps windows at DRAMA_DIRECTORS_MAX_WINDOWS and
 * names gaps on mixed-success runs.
 */
export const DRAMA_DIRECTOR_COVERAGES = ['sampled'] as const;
export type DramaDirectorCoverage = (typeof DRAMA_DIRECTOR_COVERAGES)[number];

export interface DramaRequestOptions {
  enabled: true;
  languages: DramaLanguage[];
  modules: DramaModule[];
  /** Subtitle resolution policy; `auto` when omitted (matches P1). */
  subtitleSource: DramaSubtitleSource;
  /** Spoken language for EN/ZH ASR only, when no timed source is available. */
  sourceLanguage?: 'en' | 'zh';
  /** Director coverage; `sampled` when omitted. */
  directorCoverage: DramaDirectorCoverage;
}

export interface DramaJobState {
  status: DramaEnrichmentStatus;
  languages: DramaLanguage[];
  modules: DramaModule[];
  modules_done: DramaModule[];
  run_id?: string;
  error?: { code: string; message: string };
  /** Per-run subtitle resolution policy (P4); persisted for retry parity. */
  subtitleSource: DramaSubtitleSource;
  sourceLanguage?: 'en' | 'zh';
  /** Per-run director coverage (P4). */
  directorCoverage: DramaDirectorCoverage;
}

export function isDramaLanguage(v: string): v is DramaLanguage {
  return (DRAMA_LANGUAGES as readonly string[]).includes(v);
}

export function isDramaModule(v: string): v is DramaModule {
  return (DRAMA_MODULES as readonly string[]).includes(v);
}

export function isDramaSubtitleSource(v: string): v is DramaSubtitleSource {
  return (DRAMA_SUBTITLE_SOURCES as readonly string[]).includes(v);
}

export function isDramaDirectorCoverage(
  v: string,
): v is DramaDirectorCoverage {
  return (DRAMA_DIRECTOR_COVERAGES as readonly string[]).includes(v);
}
