import { getConfig } from '../config';
import { getDramaEnv } from '../drama/env';
import { getEsClient } from './client';
import { videoAssetsMetaMappingProperties } from './asset-meta-mapping';
import { dramaSubtitlesMapping } from './drama-subtitles-mapping';
import {
  diffMappingProperties,
  MappingUpgradeConflictError,
} from './mapping-diff';

/**
 * `job` object properties for video-assets. Shared by create and upgrade
 * (I4): the durable drama request/status record lives here so a restart
 * can recover even when `meta.drama` was never written (e.g. handoff
 * marker failure).
 */
export function videoAssetsJobMappingProperties(): Record<string, unknown> {
  return {
    job_id: { type: 'keyword' },
    stage: { type: 'keyword' },
    progress_pct: { type: 'float' },
    windows_total: { type: 'integer' },
    windows_done: { type: 'integer' },
    started_at: { type: 'date' },
    updated_at: { type: 'date' },
    completed_at: { type: 'date' },
    drama: {
      type: 'object',
      properties: {
        status: { type: 'keyword' },
        languages: { type: 'keyword' },
        modules: { type: 'keyword' },
        modules_done: { type: 'keyword' },
        run_id: { type: 'keyword', index: false },
        // P4: per-run policy persisted for retry parity. `index:false` —
        // stored for hydration, never queried.
        subtitle_source: { type: 'keyword', index: false },
        director_coverage: { type: 'keyword', index: false },
        error_code: { type: 'keyword', index: false },
        error_message: { type: 'text', index: false },
      },
    },
  };
}

/** Body passed to `indices.create` (index name supplied by caller). */
type IndexCreateBody = {
  mappings: Record<string, unknown>;
};

const DENSE_VECTOR_1024 = {
  type: 'dense_vector' as const,
  dims: 1024,
  index: true,
  similarity: 'cosine' as const,
  index_options: {
    type: 'bbq_hnsw' as const,
    m: 16,
    ef_construction: 100,
  },
};

/** Full create body for `video-assets` — mirrors docs/data-model.md */
export function videoAssetsMapping(): IndexCreateBody {
  const cfg = getConfig();
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        video_id: { type: 'keyword' },
        title: {
          type: 'text',
          fields: {
            keyword: { type: 'keyword', ignore_above: 256 },
          },
        },
        source_mode: { type: 'keyword' },
        source_origin_path: { type: 'keyword', index: false },
        source_fingerprint: { type: 'keyword' },
        media_path: { type: 'keyword', index: false },
        duration_ms: { type: 'long' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        fps: { type: 'float' },
        has_audio: { type: 'boolean' },
        size_bytes: { type: 'long' },
        container: { type: 'keyword' },
        video_codec: { type: 'keyword' },
        playback_path: { type: 'keyword', index: false },
        variants: {
          type: 'nested',
          properties: {
            variant_id: { type: 'keyword' },
            chunk_preset: { type: 'keyword' },
            chunk_window_ms: { type: 'integer' },
            chunk_overlap_ms: { type: 'integer' },
            chunk_min_ms: { type: 'integer' },
            provider: { type: 'keyword' },
            model: { type: 'keyword' },
            task: { type: 'keyword' },
            dims: { type: 'integer' },
            normalized_by: { type: 'keyword' },
            schema_version: { type: 'keyword' },
            proxy_settings: {
              type: 'object',
              properties: {
                video_frames: { type: 'integer' },
                max_long_edge: { type: 'integer' },
                resolution_ladder: { type: 'integer' },
                crf_ladder: { type: 'integer' },
              },
            },
            chunk_count: { type: 'integer' },
            status: { type: 'keyword' },
            error: { type: 'text', index: false },
          },
        },
        status: { type: 'keyword' },
        job: {
          type: 'object',
          properties: videoAssetsJobMappingProperties(),
        },
        error: { type: 'text', index: false },
        created_at: { type: 'date' },
        updated_at: { type: 'date' },
        ...videoAssetsMetaMappingProperties(cfg.EMBED_INFERENCE_ID || undefined),
      },
    },
  };
}

/** Full create body for `video-chunks` — mirrors docs/data-model.md */
export function videoChunksMapping(): IndexCreateBody {
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        video_id: { type: 'keyword' },
        variant_id: { type: 'keyword' },
        chunk_index: { type: 'integer' },
        start_ms: { type: 'long' },
        end_ms: { type: 'long' },
        duration_ms: { type: 'long' },
        start_label: { type: 'keyword' },
        end_label: { type: 'keyword' },
        embedding_video: DENSE_VECTOR_1024,
        embedding_audio: DENSE_VECTOR_1024,
        provider: { type: 'keyword' },
        model: { type: 'keyword' },
        task: { type: 'keyword' },
        normalized_by: { type: 'keyword' },
        video_proxy: {
          type: 'object',
          properties: {
            bytes: { type: 'integer' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            frames: { type: 'integer' },
            crf: { type: 'integer' },
            strategy: { type: 'keyword' },
            ladder_exhausted: { type: 'boolean' },
          },
        },
        audio_proxy: {
          type: 'object',
          properties: {
            bytes: { type: 'integer' },
            bitrate: { type: 'keyword' },
            codec: { type: 'keyword' },
          },
        },
        thumb_path: { type: 'keyword', index: false },
        has_audio: { type: 'boolean' },
        video_title: {
          type: 'text',
          fields: {
            keyword: { type: 'keyword', ignore_above: 256 },
          },
        },
        source_mode: { type: 'keyword' },
        created_at: { type: 'date' },
      },
    },
  };
}

export type IndexEnsureAction = 'created' | 'skipped' | 'upgraded';

export interface EnsureIndicesResult {
  assets: IndexEnsureAction;
  chunks: IndexEnsureAction;
  dramaSubtitles: IndexEnsureAction;
  indexAssets: string;
  indexChunks: string;
  indexDramaSubtitles: string;
  /** Present when assets mapping was compared / upgraded. */
  assetsMapping?: {
    addedProperties: string[];
    alreadyPresent: string[];
    conflicts?: string[];
  };
}

async function ensureIndex(
  indexName: string,
  body: IndexCreateBody,
): Promise<IndexEnsureAction> {
  const client = getEsClient();
  const exists = await client.indices.exists({ index: indexName });
  if (exists) {
    return 'skipped';
  }
  await client.indices.create({ index: indexName, ...body });
  return 'created';
}

/**
 * Idempotently add *missing* properties under an existing strict mapping.
 * Recursively compares desired `meta.*` children plus the durable
 * `job.drama` request record (I4). Incompatible types, analyzers, or
 * copy_to targets fail with MappingUpgradeConflictError.
 */
export async function upgradeVideoAssetsMapping(): Promise<{
  action: 'upgraded' | 'skipped';
  addedProperties: string[];
  alreadyPresent: string[];
  conflicts: string[];
}> {
  const client = getEsClient();
  const cfg = getConfig();
  const indexName = cfg.ES_INDEX_ASSETS;
  const exists = await client.indices.exists({ index: indexName });
  if (!exists) {
    return {
      action: 'skipped',
      addedProperties: [],
      alreadyPresent: [],
      conflicts: [],
    };
  }

  const current = await client.indices.getMapping({ index: indexName });
  const indexKey = Object.keys(current)[0];
  const props =
    (current[indexKey]?.mappings?.properties as
      | Record<string, unknown>
      | undefined) ?? {};

  const desired = videoAssetsMetaMappingProperties(
    cfg.EMBED_INFERENCE_ID || undefined,
  );
  const diff = diffMappingProperties(desired, props);

  // I4: the same upgrade covers the durable drama request record under
  // `job.drama` (the create body shares this source via
  // videoAssetsJobMappingProperties).
  const jobExisting = isRecord(props.job)
    ? (props.job.properties as Record<string, unknown> | undefined)
    : undefined;
  const jobDramaDesired = videoAssetsJobMappingProperties()
    .drama as Record<string, unknown>;
  const jobDiff = diffMappingProperties(
    { drama: jobDramaDesired },
    jobExisting ?? {},
    'job',
  );

  const conflicts = [...diff.conflicts, ...jobDiff.conflicts];
  if (conflicts.length > 0) {
    throw new MappingUpgradeConflictError(conflicts);
  }

  const addedProperties = [...diff.addedPaths, ...jobDiff.addedPaths];
  const alreadyPresent = [...diff.alreadyPresent, ...jobDiff.alreadyPresent];
  if (addedProperties.length === 0) {
    return {
      action: 'skipped',
      addedProperties: [],
      alreadyPresent,
      conflicts: [],
    };
  }

  const toPut: Record<string, unknown> = { ...diff.toPut };
  if (Object.keys(jobDiff.toPut).length > 0) {
    toPut.job = { properties: jobDiff.toPut };
  }
  await client.indices.putMapping({
    index: indexName,
    // Mapping fragment is validated against the create body; ES client typings
    // for MappingProperty are a large closed union we do not reconstruct here.
    properties: toPut as never,
  });
  return {
    action: 'upgraded',
    addedProperties,
    alreadyPresent,
    conflicts: [],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Idempotent create + mapping upgrade for both project indices (NFR-6).
 * Existing video-assets indices receive new `meta.*` properties when missing.
 */
export async function ensureIndices(): Promise<EnsureIndicesResult> {
  const cfg = getConfig();
  const dramaEnv = getDramaEnv();
  let assets = await ensureIndex(cfg.ES_INDEX_ASSETS, videoAssetsMapping());
  const chunks = await ensureIndex(cfg.ES_INDEX_CHUNKS, videoChunksMapping());
  const dramaSubtitles = await ensureIndex(
    dramaEnv.ES_INDEX_DRAMA_SUBTITLES,
    dramaSubtitlesMapping({
      inferenceId: cfg.EMBED_INFERENCE_ID || undefined,
      dims: cfg.EMBED_DIMS,
    }),
  );

  let assetsMapping: EnsureIndicesResult['assetsMapping'];
  if (assets === 'skipped') {
    const upgrade = await upgradeVideoAssetsMapping();
    assetsMapping = {
      addedProperties: upgrade.addedProperties,
      alreadyPresent: upgrade.alreadyPresent,
      conflicts: upgrade.conflicts,
    };
    if (upgrade.action === 'upgraded') {
      assets = 'upgraded';
    }
  } else {
    assetsMapping = {
      addedProperties: Object.keys(
        videoAssetsMetaMappingProperties(cfg.EMBED_INFERENCE_ID || undefined),
      ),
      alreadyPresent: [],
    };
  }

  return {
    assets,
    chunks,
    dramaSubtitles,
    indexAssets: cfg.ES_INDEX_ASSETS,
    indexChunks: cfg.ES_INDEX_CHUNKS,
    indexDramaSubtitles: dramaEnv.ES_INDEX_DRAMA_SUBTITLES,
    assetsMapping,
  };
}
