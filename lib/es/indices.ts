import { getConfig } from '../config';
import { getEsClient } from './client';
import { videoAssetsMetaMappingProperties } from './asset-meta-mapping';
import {
  diffMappingProperties,
  MappingUpgradeConflictError,
} from './mapping-diff';

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
          properties: {
            job_id: { type: 'keyword' },
            stage: { type: 'keyword' },
            progress_pct: { type: 'float' },
            windows_total: { type: 'integer' },
            windows_done: { type: 'integer' },
            started_at: { type: 'date' },
            updated_at: { type: 'date' },
            completed_at: { type: 'date' },
          },
        },
        error: { type: 'text', index: false },
        created_at: { type: 'date' },
        updated_at: { type: 'date' },
        ...videoAssetsMetaMappingProperties(),
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
  indexAssets: string;
  indexChunks: string;
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
 * Recursively compares desired `meta.*` children. Incompatible types,
 * analyzers, or copy_to targets fail with MappingUpgradeConflictError.
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

  const desired = videoAssetsMetaMappingProperties();
  const diff = diffMappingProperties(desired, props);

  if (diff.conflicts.length > 0) {
    throw new MappingUpgradeConflictError(diff.conflicts);
  }

  if (diff.addedPaths.length === 0) {
    return {
      action: 'skipped',
      addedProperties: [],
      alreadyPresent: diff.alreadyPresent,
      conflicts: [],
    };
  }

  await client.indices.putMapping({
    index: indexName,
    // Mapping fragment is validated against the create body; ES client typings
    // for MappingProperty are a large closed union we do not reconstruct here.
    properties: diff.toPut as never,
  });
  return {
    action: 'upgraded',
    addedProperties: diff.addedPaths,
    alreadyPresent: diff.alreadyPresent,
    conflicts: [],
  };
}

/**
 * Idempotent create + mapping upgrade for both project indices (NFR-6).
 * Existing video-assets indices receive new `meta.*` properties when missing.
 */
export async function ensureIndices(): Promise<EnsureIndicesResult> {
  const cfg = getConfig();
  let assets = await ensureIndex(cfg.ES_INDEX_ASSETS, videoAssetsMapping());
  const chunks = await ensureIndex(cfg.ES_INDEX_CHUNKS, videoChunksMapping());

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
      addedProperties: Object.keys(videoAssetsMetaMappingProperties()),
      alreadyPresent: [],
    };
  }

  return {
    assets,
    chunks,
    indexAssets: cfg.ES_INDEX_ASSETS,
    indexChunks: cfg.ES_INDEX_CHUNKS,
    assetsMapping,
  };
}
