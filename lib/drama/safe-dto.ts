/**
 * Safe drama DTOs for the Library API + UI (plan/12 P4).
 *
 * Never leaks internal filesystem paths, per-person identity detail, or
 * credentials. `media_path`, `*_path`, and `thumb_path` are deliberately
 * dropped; only read-only enrichment status/summary fields are exposed.
 */
import type { DramaMetaPayload } from './persist-meta';
import type { VideoAssetDocument } from '../es/index-assets';

/**
 * Read-only drama status carried on the Library list row (badge/action gate).
 * Populated from `meta.drama` when present, otherwise the durable request
 * record on `doc.job.drama`.
 */
export interface DramaSummaryDto {
  status: string;
  subtitle_source?: string;
  source_language?: string;
  director_coverage?: string;
  languages?: string[];
  modules?: string[];
  modules_done?: string[];
  synopsis_status?: string;
  error?: string;
  run_id?: string;
}

/** Path-free structure interval for the results flyout. */
export interface SafeStructureInterval {
  kind: string;
  start_ms: number;
  end_ms: number;
  confidence?: number;
  source?: string;
}

/** Path-free key scene for the results flyout. */
export interface SafeKeyScene {
  start_ms: number;
  end_ms: number;
  summary_zh?: string;
  summary_en?: string;
  thumb_url?: string;
}

/** Path-free key actor candidate for the results flyout. */
export interface SafeKeyActor {
  role_zh: string;
  role_en?: string;
  verified: boolean;
  t_ms?: number;
  thumb_url?: string;
}

/**
 * Fuller results DTO (run overview + synopsis + structure + scene/actor
 * summaries) for the results flyout. Still path-free.
 */
export interface DramaResultsDto extends DramaSummaryDto {
  synopsis_zh?: string;
  synopsis_en?: string;
  structure?: SafeStructureInterval[];
  key_scenes?: SafeKeyScene[];
  key_actors?: SafeKeyActor[];
  subtitle_count?: number;
  subtitle_urls?: Partial<Record<'en' | 'zh' | 'ko' | 'th', string>>;
  script_urls?: { zh?: string; en?: string };
}

/** Convert a published run path to a route URL without exposing MEDIA_ROOT. */
function artifactUrl(videoId: string, runId: string, rawPath: string | undefined): string | undefined {
  if (!rawPath || !runId) return undefined;
  const segments = rawPath.split(/[\\/]/).filter(Boolean);
  const marker = segments.findIndex((part, index) => part === 'drama' && segments[index + 1] === runId);
  const relative = rawPath.startsWith('/') ? segments.slice(marker + 2) : segments;
  if ((rawPath.startsWith('/') && marker < 0) || relative.length < 2) return undefined;
  if (relative.some((part) => part === '.' || part === '..' || !/^[\w.-]+$/.test(part))) return undefined;
  return [
    '/api/drama-media',
    encodeURIComponent(videoId),
    encodeURIComponent(runId),
    ...relative.map(encodeURIComponent),
  ].join('/');
}

/**
 * `meta.drama` is not declared on `AssetMeta` (owned separately by the drama
 * runner via `persistDramaMeta`, never part of the editorial PATCH schema),
 * so read it with a local structural assertion to the `DramaMetaPayload`
 * shape it is written with.
 */
function readMetaDrama(
  meta: VideoAssetDocument['meta'],
): DramaMetaPayload | undefined {
  return (meta as { drama?: DramaMetaPayload } | undefined)?.drama;
}

/** Minimal row-safe summary: `meta.drama` first, else `doc.job.drama`. */
export function dramaSummaryFromAsset(
  asset: VideoAssetDocument,
): DramaSummaryDto | undefined {
  const metaDrama = readMetaDrama(asset.meta);
  if (metaDrama) {
    return {
      status: metaDrama.enrichment_status,
      ...(metaDrama.subtitle_source ? { subtitle_source: metaDrama.subtitle_source } : {}),
      ...(metaDrama.source_language ? { source_language: metaDrama.source_language } : {}),
      ...(metaDrama.director_coverage ? { director_coverage: metaDrama.director_coverage } : {}),
      languages: metaDrama.languages,
      modules: metaDrama.modules,
      modules_done: metaDrama.modules_done,
      synopsis_status: metaDrama.synopsis_status,
      error: metaDrama.error?.message,
      run_id: metaDrama.run_id,
    };
  }
  const job = asset.job?.drama;
  if (!job) return undefined;
  return {
    status: job.status,
    ...(job.subtitle_source ? { subtitle_source: job.subtitle_source } : {}),
    ...(job.source_language ? { source_language: job.source_language } : {}),
    ...(job.director_coverage ? { director_coverage: job.director_coverage } : {}),
    languages: job.languages,
    modules: job.modules,
    modules_done: job.modules_done,
    error: job.error_message,
    run_id: job.run_id,
  };
}

/** Fuller results DTO; only `meta.drama` carries the inspectable detail. */
export function dramaResultsFromAsset(
  asset: VideoAssetDocument,
): DramaResultsDto | undefined {
  const metaDrama = readMetaDrama(asset.meta);
  const base = dramaSummaryFromAsset(asset);
  if (!base) return undefined;
  if (!metaDrama) return base;
  const subtitleUrls: NonNullable<DramaResultsDto['subtitle_urls']> = {};
  for (const raw of metaDrama.subtitle_paths ?? []) {
    const parts = raw.split(/[\\/]/).filter(Boolean);
    if (parts.at(-2) !== 'subtitles') continue;
    const match = /^(en|zh|ko|th)\.srt$/.exec(parts.at(-1) ?? '');
    if (!match) continue;
    const lang = match[1] as 'en' | 'zh' | 'ko' | 'th';
    if (!metaDrama.languages.includes(lang)) continue;
    const url = artifactUrl(asset.video_id, metaDrama.run_id, raw);
    if (url) subtitleUrls[lang] = url;
  }
  return {
    ...base,
    script_urls: {
      zh: artifactUrl(asset.video_id, metaDrama.run_id, metaDrama.directors_script_zh_path),
      en: artifactUrl(asset.video_id, metaDrama.run_id, metaDrama.directors_script_en_path),
    },
    synopsis_zh: metaDrama.synopsis_zh,
    synopsis_en: metaDrama.synopsis_en,
    structure: metaDrama.structure?.map((s) => ({
      kind: s.kind,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      confidence: s.confidence,
      source: s.source,
    })),
    key_scenes: metaDrama.key_scenes?.map((s) => ({
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      summary_zh: s.summary_zh,
      summary_en: s.summary_en,
      ...(artifactUrl(asset.video_id, metaDrama.run_id, s.thumb_path)
        ? { thumb_url: artifactUrl(asset.video_id, metaDrama.run_id, s.thumb_path) }
        : {}),
    })),
    key_actors: metaDrama.key_actors?.map((a) => ({
      role_zh: a.role_zh,
      role_en: a.role_en,
      verified: a.verified,
      t_ms: a.t_ms,
      ...(a.verified && artifactUrl(asset.video_id, metaDrama.run_id, a.thumb_path)
        ? { thumb_url: artifactUrl(asset.video_id, metaDrama.run_id, a.thumb_path) }
        : {}),
    })),
    subtitle_count: metaDrama.subtitle_paths?.length,
    subtitle_urls: subtitleUrls,
  };
}
