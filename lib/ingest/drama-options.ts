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

export interface DramaRequestOptions {
  enabled: true;
  languages: DramaLanguage[];
  modules: DramaModule[];
}

export interface DramaJobState {
  status: DramaEnrichmentStatus;
  languages: DramaLanguage[];
  modules: DramaModule[];
  modules_done: DramaModule[];
  run_id?: string;
  error?: { code: string; message: string };
}

export function isDramaLanguage(v: string): v is DramaLanguage {
  return (DRAMA_LANGUAGES as readonly string[]).includes(v);
}

export function isDramaModule(v: string): v is DramaModule {
  return (DRAMA_MODULES as readonly string[]).includes(v);
}
