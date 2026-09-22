import type { Client } from '@elastic/elasticsearch';
import { getLiveConfig, type LiveConfig } from './config';
import { getEsClient } from '../es/client';

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

const LIVE_SCHEMA_META = {
  schema_version: 1,
  owner: 'live-video-search',
  retention_policy: 'until_explicit_delete',
};

export function liveSourcesMapping(): IndexCreateBody {
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        source_id: { type: 'keyword' },
        name: { type: 'keyword' },
        protocol: { type: 'keyword' },
        source_revision: { type: 'long' },
        connection_ref: { type: 'keyword' },
        transport: { type: 'keyword' },
        enabled: { type: 'boolean' },
        validation_state: { type: 'keyword' },
        endpoint_redacted: { type: 'keyword', index: false },
        endpoint_fingerprint: { type: 'keyword' },
        allowed_host: { type: 'keyword' },
        allowed_port: { type: 'integer' },
        validation_error: {
          type: 'object',
          properties: {
            code: { type: 'keyword' },
            message: { type: 'text', index: false },
            at: { type: 'date' },
          },
        },
        active_session_id: { type: 'keyword' },
        created_at: { type: 'date' },
        updated_at: { type: 'date' },
      },
    },
  };
}

export function liveSessionsMapping(): IndexCreateBody {
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        session_id: { type: 'keyword' },
        source_id: { type: 'keyword' },
        idempotency_key: { type: 'keyword' },
        desired_state: { type: 'keyword' },
        observed_state: { type: 'keyword' },
        reserved_revision: { type: 'long' },
        published_revision: { type: 'long' },
        worker_id: { type: 'keyword' },
        stream_epoch: { type: 'long' },
        last_sequence_no_in_current_epoch: { type: 'long' },
        source_snapshot: {
          type: 'object',
          properties: {
            source_revision: { type: 'long' },
            protocol: { type: 'keyword' },
            transport: { type: 'keyword' },
            connection_ref: { type: 'keyword' },
            endpoint_fingerprint: { type: 'keyword' },
            allowed_host: { type: 'keyword' },
            allowed_port: { type: 'integer' },
          },
        },
        variant_id: { type: 'keyword' },
        retention: {
          type: 'object',
          properties: {
            mode: { type: 'keyword' },
          },
        },
        window: {
          type: 'object',
          properties: {
            fragment_ms: { type: 'long' },
            window_ms: { type: 'long' },
            overlap_ms: { type: 'long' },
          },
        },
        embedding: {
          type: 'object',
          properties: {
            provider: { type: 'keyword' },
            model: { type: 'keyword' },
            task: { type: 'keyword' },
            dims: { type: 'integer' },
            normalized_by: { type: 'keyword' },
          },
        },
        timestamps: {
          type: 'object',
          properties: {
            created_at: { type: 'date' },
            command_requested_at: { type: 'date' },
            connect_started_at: { type: 'date' },
            live_at: { type: 'date' },
            last_media_at: { type: 'date' },
            last_searchable_at: { type: 'date' },
            stopped_at: { type: 'date' },
            updated_at: { type: 'date' },
          },
        },
        health: {
          type: 'object',
          properties: {
            capture_lag_ms: { type: 'long' },
            processing_lag_ms: { type: 'long' },
            queue_depth: { type: 'long' },
            queue_high_water: { type: 'long' },
            indexing_batches_in_flight: { type: 'long' },
            spool_bytes: { type: 'long' },
            reconnect_count: { type: 'long' },
            windows_searchable: { type: 'long' },
            windows_failed: { type: 'long' },
            windows_dropped: { type: 'long' },
          },
        },
        current_error: {
          type: 'object',
          properties: {
            code: { type: 'keyword' },
            message: { type: 'text', index: false },
            at: { type: 'date' },
          },
        },
      },
    },
  };
}

export function liveWorkersMapping(): IndexCreateBody {
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        worker_id: { type: 'keyword' },
        started_at: { type: 'date' },
        heartbeat_at: { type: 'date' },
        spool_lock_held: { type: 'boolean' },
        version: { type: 'keyword' },
        image_digest: { type: 'keyword' },
        capabilities_hash: { type: 'keyword' },
      },
    },
  };
}

/** A-20 protect/keep control documents (absolute UTC ranges). */
export function liveProtectRangesMapping(): IndexCreateBody {
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        range_id: { type: 'keyword' },
        start_at: { type: 'date' },
        end_at: { type: 'date' },
        session_id: { type: 'keyword' },
        note: { type: 'text', index: false },
        created_at: { type: 'date' },
        updated_at: { type: 'date' },
      },
    },
  };
}

export function liveChunksMapping(): IndexCreateBody {
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        '@timestamp': { type: 'date' },
        event_ingested: { type: 'date' },
        chunk_id: { type: 'keyword' },
        source_id: { type: 'keyword' },
        session_id: { type: 'keyword' },
        stream_epoch: { type: 'long' },
        sequence_no: { type: 'long' },
        variant_id: { type: 'keyword' },
        window_start_at: { type: 'date' },
        window_end_at: { type: 'date' },
        start_pts_ms: { type: 'long' },
        end_pts_ms: { type: 'long' },
        start_offset_ms: { type: 'long' },
        end_offset_ms: { type: 'long' },
        duration_ms: { type: 'long' },
        clock: {
          type: 'object',
          properties: {
            mode: { type: 'keyword' },
            epoch_pts_origin_ms: { type: 'long' },
            epoch_anchor_utc: { type: 'date' },
            uncertainty_ms: { type: 'long' },
          },
        },
        discontinuity_before: { type: 'boolean' },
        media_sha256: { type: 'keyword' },
        immutable_fingerprint: { type: 'keyword' },
        schema_version: { type: 'long' },
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
        media: {
          type: 'object',
          properties: {
            clip_ref: { type: 'keyword', index: false },
            thumb_ref: { type: 'keyword', index: false },
            clip_expires_at: { type: 'date' },
            thumb_expires_at: { type: 'date' },
          },
        },
        processing: {
          type: 'object',
          enabled: true,
          properties: {
            window_ready_at: { type: 'date' },
            inference_started_at: { type: 'date' },
            inference_finished_at: { type: 'date' },
            index_requested_at: { type: 'date' },
            worker_boot_id: { type: 'keyword' },
            attempt: { type: 'integer' },
            queue_wait_ms: { type: 'long' },
            proxy_duration_ms: { type: 'long' },
            inference_duration_ms: { type: 'long' },
            stage_clock: {
              type: 'object',
              enabled: false,
            },
          },
        },
      },
    },
  };
}

export function liveEventsMapping(): IndexCreateBody {
  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        '@timestamp': { type: 'date' },
        event_id: { type: 'keyword' },
        session_id: { type: 'keyword' },
        source_id: { type: 'keyword' },
        revision: { type: 'long' },
        type: { type: 'keyword' },
        chunk_id: { type: 'keyword' },
        manifest_record_id: { type: 'keyword' },
        event_fingerprint: { type: 'keyword' },
        searchable_at: { type: 'date' },
        processing_lag_ms: { type: 'long' },
        index_duration_ms: { type: 'long' },
        payload: { type: 'object', enabled: false },
      },
    },
  };
}

export type EnsureAction = 'created' | 'updated' | 'skipped';

export interface LifecycleReadBack {
  name: string;
  configured_data_retention: string | null;
  effective_retention: string | null;
  retention_determined_by: string | null;
  retention_source: 'indefinite_until_explicit_delete';
  enabled: boolean | null;
}

export interface EnsureLiveIndicesResult {
  sources: EnsureAction;
  sessions: EnsureAction;
  workers: EnsureAction;
  protectRanges: EnsureAction;
  chunksTemplate: EnsureAction;
  eventsTemplate: EnsureAction;
  chunksStream: EnsureAction;
  eventsStream: EnsureAction;
  elasticsearchUrlHost: string;
  names: {
    sources: string;
    sessions: string;
    workers: string;
    protectRanges: string;
    chunks: string;
    events: string;
  };
  lifecycle: {
    chunks: LifecycleReadBack;
    events: LifecycleReadBack;
  };
  dims: 1024;
  similarity: 'cosine';
  mappingStrictness: 'strict';
  timestampField: '@timestamp';
}

async function ensurePlainIndex(
  client: Client,
  indexName: string,
  body: IndexCreateBody,
): Promise<EnsureAction> {
  const exists = await client.indices.exists({ index: indexName });
  if (exists) {
    return 'skipped';
  }
  await client.indices.create({ index: indexName, ...body });
  return 'created';
}

/**
 * Indefinite retention: DSL enabled without data_retention.
 * Never configure an age that auto-deletes backing indices.
 */
function indefiniteLifecycle(cfg: LiveConfig) {
  return { ...cfg.LIVE_DSL_LIFECYCLE };
}

async function putDataStreamTemplate(
  client: Client,
  templateName: string,
  streamName: string,
  mappings: IndexCreateBody['mappings'],
  cfg: LiveConfig,
): Promise<EnsureAction> {
  let existed = false;
  try {
    await client.indices.getIndexTemplate({ name: templateName });
    existed = true;
  } catch (err: unknown) {
    const status =
      typeof err === 'object' &&
      err !== null &&
      'meta' in err &&
      typeof (err as { meta?: { statusCode?: number } }).meta?.statusCode ===
        'number'
        ? (err as { meta: { statusCode: number } }).meta.statusCode
        : undefined;
    if (status !== 404) throw err;
  }

  await client.indices.putIndexTemplate({
    name: templateName,
    index_patterns: [streamName],
    data_stream: {},
    priority: 500,
    _meta: {
      ...LIVE_SCHEMA_META,
      data_stream: streamName,
    },
    template: {
      mappings,
      lifecycle: indefiniteLifecycle(cfg),
    },
  });

  return existed ? 'updated' : 'created';
}

async function ensureDataStream(
  client: Client,
  name: string,
): Promise<EnsureAction> {
  try {
    await client.indices.getDataStream({ name });
    return 'skipped';
  } catch (err: unknown) {
    const status =
      typeof err === 'object' &&
      err !== null &&
      'meta' in err &&
      typeof (err as { meta?: { statusCode?: number } }).meta?.statusCode ===
        'number'
        ? (err as { meta: { statusCode: number } }).meta.statusCode
      : undefined;
    if (status !== 404) throw err;
  }
  await client.indices.createDataStream({ name });
  return 'created';
}

async function readLifecycle(
  client: Client,
  name: string,
): Promise<LifecycleReadBack> {
  const res = await client.indices.getDataLifecycle({ name });
  const entry = res.data_streams?.[0] as
    | {
        name?: string;
        lifecycle?: {
          enabled?: boolean;
          data_retention?: string;
          effective_retention?: string;
          retention_determined_by?: string;
        };
      }
    | undefined;

  const lifecycle = entry?.lifecycle;
  const configured = lifecycle?.data_retention ?? null;
  const effective = lifecycle?.effective_retention ?? null;

  if (configured != null || (effective != null && effective !== '')) {
    throw new Error(
      `Live data stream "${name}" has age-based retention ` +
        `(configured=${String(configured)}, effective=${String(effective)}). ` +
        `Product policy requires indefinite retention until explicit delete.`,
    );
  }

  return {
    name,
    configured_data_retention: configured,
    effective_retention: effective,
    retention_determined_by: lifecycle?.retention_determined_by ?? null,
    retention_source: 'indefinite_until_explicit_delete',
    enabled: lifecycle?.enabled ?? null,
  };
}

function elasticsearchUrlHost(): string {
  const raw = process.env.ELASTICSEARCH_URL ?? '';
  try {
    return new URL(raw).host || '(unparsed)';
  } catch {
    return '(unparsed)';
  }
}

/**
 * Idempotent live index / template / data-stream setup.
 * Targets only the `.env`-configured external Elasticsearch client.
 * Does not touch file-video `video-assets` / `video-chunks`.
 */
export async function ensureLiveIndices(
  client: Client = getEsClient(),
  cfg: LiveConfig = getLiveConfig(),
): Promise<EnsureLiveIndicesResult> {
  const sources = await ensurePlainIndex(
    client,
    cfg.ES_INDEX_LIVE_SOURCES,
    liveSourcesMapping(),
  );
  const sessions = await ensurePlainIndex(
    client,
    cfg.ES_INDEX_LIVE_SESSIONS,
    liveSessionsMapping(),
  );
  const workers = await ensurePlainIndex(
    client,
    cfg.ES_INDEX_LIVE_WORKERS,
    liveWorkersMapping(),
  );
  const protectRanges = await ensurePlainIndex(
    client,
    cfg.ES_INDEX_LIVE_PROTECT_RANGES,
    liveProtectRangesMapping(),
  );

  const chunksTemplate = await putDataStreamTemplate(
    client,
    `${cfg.ES_DATA_STREAM_LIVE_CHUNKS}-template`,
    cfg.ES_DATA_STREAM_LIVE_CHUNKS,
    liveChunksMapping().mappings,
    cfg,
  );
  const eventsTemplate = await putDataStreamTemplate(
    client,
    `${cfg.ES_DATA_STREAM_LIVE_EVENTS}-template`,
    cfg.ES_DATA_STREAM_LIVE_EVENTS,
    liveEventsMapping().mappings,
    cfg,
  );

  const chunksStream = await ensureDataStream(
    client,
    cfg.ES_DATA_STREAM_LIVE_CHUNKS,
  );
  const eventsStream = await ensureDataStream(
    client,
    cfg.ES_DATA_STREAM_LIVE_EVENTS,
  );

  // Enforce indefinite lifecycle on existing streams (no data_retention).
  await client.indices.putDataLifecycle({
    name: cfg.ES_DATA_STREAM_LIVE_CHUNKS,
    enabled: true,
  });
  await client.indices.putDataLifecycle({
    name: cfg.ES_DATA_STREAM_LIVE_EVENTS,
    enabled: true,
  });

  const chunksLife = await readLifecycle(
    client,
    cfg.ES_DATA_STREAM_LIVE_CHUNKS,
  );
  const eventsLife = await readLifecycle(
    client,
    cfg.ES_DATA_STREAM_LIVE_EVENTS,
  );

  return {
    sources,
    sessions,
    workers,
    protectRanges,
    chunksTemplate,
    eventsTemplate,
    chunksStream,
    eventsStream,
    elasticsearchUrlHost: elasticsearchUrlHost(),
    names: {
      sources: cfg.ES_INDEX_LIVE_SOURCES,
      sessions: cfg.ES_INDEX_LIVE_SESSIONS,
      workers: cfg.ES_INDEX_LIVE_WORKERS,
      protectRanges: cfg.ES_INDEX_LIVE_PROTECT_RANGES,
      chunks: cfg.ES_DATA_STREAM_LIVE_CHUNKS,
      events: cfg.ES_DATA_STREAM_LIVE_EVENTS,
    },
    lifecycle: {
      chunks: chunksLife,
      events: eventsLife,
    },
    dims: 1024,
    similarity: 'cosine',
    mappingStrictness: 'strict',
    timestampField: '@timestamp',
  };
}
