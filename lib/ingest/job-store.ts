import { randomUUID } from 'node:crypto';
import type { VideoProbeResult } from '../video/probe';
import {
  findAssetByJobId,
  getAsset,
  persistIngestAsset,
  type AssetVariantDoc,
  type VideoAssetDocument,
} from '../es/index-assets';
import type { SourceMode } from './sources';
import type { UrlProvenance } from './url-sanitize';
import type { ChunkPreset, ChunkingConfig } from './variant';

/** Terminal + active statuses from docs/api-contract.md. */
export type JobStatus =
  | 'pending'
  | 'awaiting_confirm'
  | 'processing'
  | 'ready'
  | 'failed';

export type JobStage =
  | 'accepted'
  | 'estimating'
  | 'awaiting_confirm'
  | 'playback_proxy'
  | 'encoding'
  | 'embedding'
  | 'indexing'
  | 'complete'
  | 'failed';

export interface WorkloadEstimate {
  windows: number;
  inference_calls: number;
  has_audio: boolean;
  chunk_preset: ChunkPreset;
}

export interface WindowErrorInfo {
  chunk_index: number;
  code: string;
  message: string;
}

export interface JobErrorInfo {
  code: string;
  message: string;
}

/** SSE / snapshot payload (docs/api-contract.md). */
export interface JobProgressEvent {
  job_id: string;
  video_id: string;
  status: JobStatus;
  stage: JobStage;
  progress_pct: number;
  windows_total: number;
  windows_done: number;
  windows_failed: number;
  current_chunk_index?: number;
  variant_id?: string;
  workload?: WorkloadEstimate;
  throughput_windows_per_min?: number | null;
  message?: string;
  window_error?: WindowErrorInfo;
  error?: JobErrorInfo;
  ts: string;
}

export type JobEventName =
  | 'snapshot'
  | 'estimate'
  | 'progress'
  | 'window_done'
  | 'window_failed'
  | 'complete'
  | 'error'
  | 'heartbeat';

export type JobEventListener = (
  event: JobEventName,
  payload: JobProgressEvent,
) => void;

export interface IngestJob {
  id: string;
  videoId: string;
  mode: SourceMode;
  status: JobStatus;
  stage: JobStage;
  mediaPath: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  provenance?: UrlProvenance;
  probe: VideoProbeResult;
  variantId?: string;
  workload?: WorkloadEstimate;
  windowsTotal: number;
  windowsDone: number;
  windowsFailed: number;
  progressPct: number;
  currentChunkIndex?: number;
  throughputWindowsPerMin?: number | null;
  message?: string;
  error?: JobErrorInfo;
  windowErrors: WindowErrorInfo[];
  startedAt?: string;
  completedAt?: string;
  /** In-memory variant list for ES merge. */
  variants: AssetVariantDoc[];
  playbackPath?: string;
  autoStart: boolean;
  /** Per-job chunking (from request or env default). */
  chunking: ChunkingConfig;
  /** Prevent double pipeline starts. */
  pipelineRunning: boolean;
}

const jobs = new Map<string, IngestJob>();
const listeners = new Map<string, Set<JobEventListener>>();
/** Map video_id → latest job_id for retry lookups. */
const videoToJob = new Map<string, string>();
/** Timers to drop terminal jobs from process memory (ES/media untouched). */
const memoryDropTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** How long a ready/failed job stays in the in-memory map after terminal status. */
export const TERMINAL_JOB_MEMORY_TTL_MS = 5 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalStatus(status: JobStatus): boolean {
  return status === 'ready' || status === 'failed';
}

/**
 * Drop a job from process memory only. Does **not** delete ES docs or media
 * files (NFR-5). Retry can still hydrate from `video-assets`.
 */
export function dropIngestJobFromMemory(jobId: string): void {
  const timer = memoryDropTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    memoryDropTimers.delete(jobId);
  }
  const job = jobs.get(jobId);
  jobs.delete(jobId);
  listeners.delete(jobId);
  if (job && videoToJob.get(job.videoId) === jobId) {
    videoToJob.delete(job.videoId);
  }
}

/** Schedule memory drop for terminal jobs so the Map does not grow unboundedly. */
export function scheduleJobMemoryDrop(
  jobId: string,
  ttlMs: number = TERMINAL_JOB_MEMORY_TTL_MS,
): void {
  const existing = memoryDropTimers.get(jobId);
  if (existing) clearTimeout(existing);
  memoryDropTimers.set(
    jobId,
    setTimeout(() => {
      memoryDropTimers.delete(jobId);
      const job = jobs.get(jobId);
      if (!job || !isTerminalStatus(job.status)) return;
      // Keep while SSE listeners are still attached.
      if (listeners.get(jobId)?.size) {
        scheduleJobMemoryDrop(jobId, Math.min(ttlMs, 30_000));
        return;
      }
      dropIngestJobFromMemory(jobId);
    }, ttlMs),
  );
}

export function toProgressEvent(job: IngestJob): JobProgressEvent {
  return {
    job_id: job.id,
    video_id: job.videoId,
    status: job.status,
    stage: job.stage,
    progress_pct: job.progressPct,
    windows_total: job.windowsTotal,
    windows_done: job.windowsDone,
    windows_failed: job.windowsFailed,
    current_chunk_index: job.currentChunkIndex,
    variant_id: job.variantId,
    workload: job.workload,
    throughput_windows_per_min: job.throughputWindowsPerMin ?? null,
    message: job.message,
    error: job.error,
    ts: nowIso(),
  };
}

export function emitJobEvent(
  job: IngestJob,
  event: JobEventName,
  extra?: Partial<JobProgressEvent>,
): void {
  const payload: JobProgressEvent = {
    ...toProgressEvent(job),
    ...extra,
    ts: nowIso(),
  };
  const set = listeners.get(job.id);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event, payload);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function subscribeJob(
  jobId: string,
  listener: JobEventListener,
): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) {
      listeners.delete(jobId);
      const job = jobs.get(jobId);
      if (job && isTerminalStatus(job.status)) {
        // Client disconnected after success/failure — drop sooner than full TTL.
        scheduleJobMemoryDrop(jobId, 30_000);
      }
    }
  };
}

function jobToAssetDoc(job: IngestJob): VideoAssetDocument {
  return {
    video_id: job.videoId,
    title: job.title,
    source_mode: job.mode,
    source_origin_path: job.provenance?.source_origin_path,
    source_fingerprint: job.provenance?.source_fingerprint,
    media_path: job.mediaPath,
    duration_ms: job.probe.duration_ms,
    width: job.probe.width,
    height: job.probe.height,
    fps: job.probe.fps,
    has_audio: job.probe.has_audio,
    size_bytes: job.probe.size_bytes,
    container: job.probe.container,
    video_codec: job.probe.video_codec,
    playback_path: job.playbackPath,
    variants: job.variants,
    status: job.status,
    job: {
      job_id: job.id,
      stage: job.stage,
      progress_pct: job.progressPct,
      windows_total: job.windowsTotal,
      windows_done: job.windowsDone,
      started_at: job.startedAt,
      updated_at: job.updatedAt,
      completed_at: job.completedAt,
    },
    error: job.error
      ? `${job.error.code}: ${job.error.message}`
      : job.windowErrors.length > 0
        ? `windows_failed=${job.windowErrors.length}: ${job.windowErrors
            .map((w) => `#${w.chunk_index} ${w.code}`)
            .join('; ')}`
        : undefined,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

/**
 * Persist current job state to video-assets (durable).
 * Uses create-or-partial-update so editorial `meta` is never replaced.
 */
export async function persistJob(job: IngestJob): Promise<void> {
  job.updatedAt = nowIso();
  await persistIngestAsset(jobToAssetDoc(job));
}

export function createIngestJob(input: {
  mode: SourceMode;
  mediaPath: string;
  probe: VideoProbeResult;
  title?: string;
  provenance?: UrlProvenance;
  autoStart?: boolean;
  videoId?: string;
  chunking: ChunkingConfig;
}): IngestJob {
  const id = randomUUID();
  const videoId = input.videoId ?? randomUUID();
  const createdAt = nowIso();
  const title =
    input.title?.trim() ||
    input.mediaPath.split('/').pop() ||
    videoId;

  const job: IngestJob = {
    id,
    videoId,
    mode: input.mode,
    status: 'pending',
    stage: 'accepted',
    mediaPath: input.mediaPath,
    createdAt,
    updatedAt: createdAt,
    title,
    provenance: input.provenance,
    probe: input.probe,
    windowsTotal: 0,
    windowsDone: 0,
    windowsFailed: 0,
    progressPct: 0,
    windowErrors: [],
    variants: [],
    autoStart: input.autoStart !== false,
    chunking: input.chunking,
    pipelineRunning: false,
  };
  jobs.set(id, job);
  videoToJob.set(videoId, id);
  return job;
}

export function getIngestJob(id: string): IngestJob | undefined {
  return jobs.get(id);
}

export function getJobByVideoId(videoId: string): IngestJob | undefined {
  const jobId = videoToJob.get(videoId);
  return jobId ? jobs.get(jobId) : undefined;
}

/**
 * Resolve job from memory, or hydrate a read-only snapshot from ES
 * (after process restart — pipeline will not auto-resume).
 */
export async function resolveIngestJob(
  jobId: string,
): Promise<IngestJob | null> {
  const mem = jobs.get(jobId);
  if (mem) return mem;

  const asset = await findAssetByJobId(jobId);
  if (!asset || asset.job.job_id !== jobId) return null;

  const hydrated = hydrateFromAsset(asset);
  jobs.set(jobId, hydrated);
  videoToJob.set(hydrated.videoId, jobId);
  return hydrated;
}

function hydrateFromAsset(asset: VideoAssetDocument): IngestJob {
  const status = asset.status as JobStatus;
  const stage = (asset.job.stage || 'failed') as JobStage;
  const firstVariant = asset.variants[0];
  const chunking: ChunkingConfig = firstVariant
    ? {
        preset: firstVariant.chunk_preset as ChunkPreset,
        windowMs: firstVariant.chunk_window_ms,
        overlapMs: firstVariant.chunk_overlap_ms,
        minMs: firstVariant.chunk_min_ms,
      }
    : {
        preset: '2s',
        windowMs: 64_000,
        overlapMs: 4_000,
        minMs: 4_000,
      };
  return {
    id: asset.job.job_id,
    videoId: asset.video_id,
    mode: asset.source_mode as SourceMode,
    status,
    stage,
    mediaPath: asset.media_path,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
    title: asset.title,
    provenance:
      asset.source_origin_path && asset.source_fingerprint
        ? {
            source_origin_path: asset.source_origin_path,
            source_fingerprint: asset.source_fingerprint,
          }
        : undefined,
    probe: {
      duration_ms: asset.duration_ms,
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
      video_codec: asset.video_codec,
      container: asset.container,
      has_audio: asset.has_audio,
      size_bytes: asset.size_bytes,
    },
    variantId: firstVariant?.variant_id,
    windowsTotal: asset.job.windows_total ?? 0,
    windowsDone: asset.job.windows_done ?? 0,
    windowsFailed: 0,
    progressPct: asset.job.progress_pct ?? 0,
    windowErrors: [],
    variants: asset.variants ?? [],
    playbackPath: asset.playback_path,
    autoStart: false,
    chunking,
    pipelineRunning: false,
    startedAt: asset.job.started_at,
    completedAt: asset.job.completed_at,
    error: asset.error
      ? { code: 'PIPELINE_FATAL', message: asset.error }
      : undefined,
    message: 'Hydrated from Elasticsearch after process restart (no auto-resume)',
  };
}

export async function loadAssetForVideo(
  videoId: string,
): Promise<VideoAssetDocument | null> {
  return getAsset(videoId);
}

type JobPatch = Partial<{
  status: JobStatus;
  stage: JobStage;
  progressPct: number;
  windowsTotal: number;
  windowsDone: number;
  windowsFailed: number;
  currentChunkIndex: number;
  variantId: string;
  workload: WorkloadEstimate;
  throughputWindowsPerMin: number | null;
  message: string;
  /** Pass `null` to clear a previous error. */
  error: JobErrorInfo | null;
  startedAt: string;
  completedAt: string;
  playbackPath: string;
  variants: AssetVariantDoc[];
  pipelineRunning: boolean;
}>;

/** Patch job fields, emit progress, optionally persist. */
export async function updateJob(
  job: IngestJob,
  patch: JobPatch,
  opts?: {
    event?: JobEventName;
    persist?: boolean;
    extra?: Partial<JobProgressEvent>;
  },
): Promise<void> {
  const { error, ...rest } = patch;
  Object.assign(job, rest);
  if (error === null) {
    job.error = undefined;
  } else if (error !== undefined) {
    job.error = error;
  }
  job.updatedAt = nowIso();
  const event = opts?.event ?? 'progress';
  emitJobEvent(job, event, opts?.extra);
  if (opts?.persist !== false) {
    await persistJob(job);
  }
  if (patch.status && isTerminalStatus(patch.status)) {
    scheduleJobMemoryDrop(job.id);
  }
}

/** Test helper — not for production pipeline. */
export function clearIngestJobs(): void {
  for (const timer of memoryDropTimers.values()) clearTimeout(timer);
  memoryDropTimers.clear();
  jobs.clear();
  listeners.clear();
  videoToJob.clear();
}
