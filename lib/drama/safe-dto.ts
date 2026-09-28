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
}

/** Path-free key actor candidate for the results flyout. */
export interface SafeKeyActor {
  role_zh: string;
  role_en?: string;
  verified: boolean;
  t_ms?: number;
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
  return {
    ...base,
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
    })),
    key_actors: metaDrama.key_actors?.map((a) => ({
      role_zh: a.role_zh,
      role_en: a.role_en,
      verified: a.verified,
      t_ms: a.t_ms,
    })),
    subtitle_count: metaDrama.subtitle_paths?.length,
  };
}