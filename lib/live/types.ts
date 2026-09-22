/** Live video TypeScript contracts — mirrors docs/live-video-data-model.md */

/** Source protocols. WHIP publishes via MediaMTX; worker consumes internal RTSP. */
export type LiveProtocol = 'rtsp' | 'hls' | 'srt' | 'whip';
export type LiveTransport = 'tcp' | 'udp' | 'caller' | 'listener';

export type LiveValidationState =
  | 'pending_validation'
  | 'ready'
  | 'invalid';

export type LiveDesiredState = 'running' | 'stopped';

export type LiveObservedState =
  | 'created'
  | 'connecting'
  | 'live'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type LiveEventType =
  | 'session_state'
  | 'window_ready'
  | 'window_failed'
  | 'window_dropped'
  | 'searchable'
  | 'recovery_gap'
  | 'error';

export type LiveRetentionMode = 'until_explicit_delete';

export interface LiveWorkerDocument {
  worker_id: string;
  started_at: string;
  heartbeat_at: string;
  spool_lock_held: boolean;
  version: string;
  image_digest: string;
  capabilities_hash: string;
}

export interface LiveSourceValidationError {
  code: string;
  message: string;
  at: string;
}

/** API-owned source fields (desired / operator input). */
export interface LiveSourceApiFields {
  name: string;
  protocol: LiveProtocol;
  connection_ref: string;
  transport?: LiveTransport;
  enabled: boolean;
}

/** Worker-owned source fields (observed validation / provenance). */
export interface LiveSourceWorkerFields {
  validation_state: LiveValidationState;
  endpoint_redacted?: string;
  endpoint_fingerprint?: string;
  allowed_host?: string;
  allowed_port?: number;
  validation_error?: LiveSourceValidationError | null;
}

export interface LiveSourceDocument
  extends LiveSourceApiFields,
    LiveSourceWorkerFields {
  source_id: string;
  source_revision: number;
  active_session_id?: string;
  created_at: string;
  updated_at: string;
}

export interface LiveSourceSnapshot {
  source_revision: number;
  protocol: LiveProtocol;
  transport?: LiveTransport;
  connection_ref: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
}

export interface LiveSessionHealth {
  capture_lag_ms?: number;
  processing_lag_ms?: number;
  queue_depth: number;
  queue_high_water: number;
  indexing_batches_in_flight: number;
  spool_bytes: number;
  reconnect_count: number;
  windows_searchable: number;
  windows_failed: number;
  windows_dropped: number;
}

export interface LiveSessionError {
  code: string;
  message: string;
  at: string;
}

export interface LiveSessionTimestamps {
  created_at: string;
  command_requested_at: string;
  connect_started_at?: string;
  live_at?: string;
  last_media_at?: string;
  last_searchable_at?: string;
  stopped_at?: string;
  updated_at: string;
}

/** API may mutate only these session fields. */
export interface LiveSessionDesiredFields {
  desired_state: LiveDesiredState;
}

/** Worker alone mutates observed runtime fields. */
export interface LiveSessionObservedFields {
  observed_state: LiveObservedState;
  reserved_revision: number;
  published_revision: number;
  worker_id?: string;
  stream_epoch: number;
  last_sequence_no_in_current_epoch: number;
  health: LiveSessionHealth;
  current_error?: LiveSessionError | null;
  timestamps: LiveSessionTimestamps;
}

export interface LiveSessionDocument
  extends LiveSessionDesiredFields,
    LiveSessionObservedFields {
  session_id: string;
  source_id: string;
  idempotency_key: string;
  source_snapshot: LiveSourceSnapshot;
  variant_id: string;
  retention: {
    mode: LiveRetentionMode;
  };
  window: {
    fragment_ms: number;
    window_ms: number;
    overlap_ms: number;
  };
  embedding: {
    provider: string;
    model: string;
    task: string;
    /** Follows `EMBED_DIMS` (default 1024); not hard-coded to the mapping default. */
    dims: number;
    normalized_by: string;
  };
}

export interface LiveEventDocument {
  '@timestamp': string;
  event_id: string;
  session_id: string;
  source_id: string;
  revision: number;
  type: LiveEventType;
  chunk_id?: string;
  manifest_record_id?: string;
  event_fingerprint: string;
  searchable_at?: string;
  processing_lag_ms?: number;
  index_duration_ms?: number;
  payload: Record<string, unknown>;
}

export interface StageClockSample {
  worker_boot_id: string;
  monotonic_ns: number;
  utc: string;
  uncertainty_ms: number;
}

export interface LiveChunkDocument {
  '@timestamp': string;
  event_ingested: string;
  chunk_id: string;
  source_id: string;
  session_id: string;
  stream_epoch: number;
  sequence_no: number;
  variant_id: string;
  window_start_at: string;
  window_end_at: string;
  start_pts_ms: number;
  end_pts_ms: number;
  start_offset_ms: number;
  end_offset_ms: number;
  duration_ms: number;
  clock: {
    mode: 'receive_anchor';
    epoch_pts_origin_ms: number;
    epoch_anchor_utc: string;
    uncertainty_ms: number;
  };
  discontinuity_before: boolean;
  media_sha256: string;
  immutable_fingerprint: string;
  schema_version: number;
  embedding_video: number[];
  embedding_audio?: number[];
  provider: string;
  model: string;
  task: string;
  normalized_by: string;
  video_proxy: {
    bytes: number;
    width: number;
    height: number;
    frames: number;
    crf: number;
    strategy: string;
  };
  audio_proxy?: {
    bytes: number;
    bitrate: string;
    codec: string;
  };
  media: {
    clip_ref: string;
    thumb_ref: string;
    clip_expires_at: string | null;
    thumb_expires_at: string | null;
  };
  processing: {
    window_ready_at: string;
    inference_started_at: string;
    inference_finished_at: string;
    index_requested_at: string;
    worker_boot_id: string;
    attempt: number;
    queue_wait_ms: number;
    proxy_duration_ms: number;
    inference_duration_ms: number;
    stage_clock: {
      window_closed: StageClockSample;
      inference_started: StageClockSample;
      inference_finished: StageClockSample;
      index_requested: StageClockSample;
    };
  };
}

export interface EsVersionMeta {
  _seq_no: number;
  _primary_term: number;
}

export type VersionedDoc<T> = {
  id: string;
  source: T;
} & EsVersionMeta;

export const LIVE_TERMINAL_OBSERVED_STATES: ReadonlySet<LiveObservedState> =
  new Set(['stopped', 'failed']);

export function isTerminalObservedState(
  state: LiveObservedState,
): boolean {
  return LIVE_TERMINAL_OBSERVED_STATES.has(state);
}

/** Fixed worker heartbeat document id (diagnostics, not a lease). */
export const LIVE_WORKER_DOC_ID = 'singleton' as const;

/**
 * Ops protect/keep range (A-20). Absolute UTC interval keyed by chunk
 * `window_end_at` (and event `@timestamp`). Age-delete skips protected times.
 */
export interface LiveProtectRangeDocument {
  range_id: string;
  /** Inclusive UTC start (ISO-8601). */
  start_at: string;
  /** Inclusive UTC end (ISO-8601). */
  end_at: string;
  /** When set, only windows/events for this session are protected. */
  session_id?: string;
  note?: string;
  created_at: string;
  updated_at: string;
}
