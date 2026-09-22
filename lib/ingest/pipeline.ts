import fs from 'node:fs';
import path from 'node:path';
import { getConfig, type AppConfig } from '../config';
import {
  assertVariantConfigCompatible,
  createEmbeddingProvider,
} from '../embed/provider';
import type { AssetVariantDoc } from '../es/index-assets';
import {
  bulkUpsertChunks,
  type ChunkDocument,
} from '../es/index-chunks';
import { prepareFiniteMedia } from '../media/prepare-finite-media';
import { embedBudgetBytes } from '../video/budget';
import { encodePlaybackProxy } from '../video/playback';
import { planChunks, type ChunkWindow } from '../video/plan-chunks';
import { ProxyBudgetExhaustedError } from '../video/proxy-encode';
import {
  chunkingFromConfig,
  deriveVariantId,
  proxySettingsForEs,
  variantConfigFromApp,
  type ChunkingConfig,
} from './variant';
import {
  emitJobEvent,
  persistJob,
  updateJob,
  type IngestJob,
  type WorkloadEstimate,
  type WindowErrorInfo,
} from './job-store';

function mediaRoot(cfg: AppConfig): string {
  return path.resolve(cfg.MEDIA_ROOT);
}

function formatMsLabel(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Plan windows and compute inference workload (NFR-10). */
export function estimateWorkload(
  durationMs: number,
  hasAudio: boolean,
  cfg: AppConfig = getConfig(),
  chunking?: ChunkingConfig,
): { windows: ChunkWindow[]; workload: WorkloadEstimate; variantId: string } {
  const variantCfg = variantConfigFromApp(cfg, {
    chunking: chunking ?? chunkingFromConfig(cfg),
  });
  const variantId = deriveVariantId(variantCfg);
  const windows = planChunks({
    durationMs,
    windowMs: variantCfg.chunking.windowMs,
    overlapMs: variantCfg.chunking.overlapMs,
    minMs: variantCfg.chunking.minMs,
  });
  const workload: WorkloadEstimate = {
    windows: windows.length,
    inference_calls: hasAudio ? windows.length * 2 : windows.length,
    has_audio: hasAudio,
    chunk_preset: variantCfg.chunking.preset,
  };
  return { windows, workload, variantId };
}

function buildVariantDoc(
  variantId: string,
  cfg: AppConfig,
  status: string,
  chunkCount: number,
  chunking: ChunkingConfig,
  error?: string,
): AssetVariantDoc {
  const variantCfg = variantConfigFromApp(cfg, { chunking });
  return {
    variant_id: variantId,
    chunk_preset: variantCfg.chunking.preset,
    chunk_window_ms: variantCfg.chunking.windowMs,
    chunk_overlap_ms: variantCfg.chunking.overlapMs,
    chunk_min_ms: variantCfg.chunking.minMs,
    provider: variantCfg.provider,
    model: variantCfg.model,
    task: variantCfg.task,
    dims: variantCfg.dims,
    normalized_by: variantCfg.normalizedBy,
    schema_version: variantCfg.schemaVersion,
    proxy_settings: proxySettingsForEs(variantCfg.proxySettings),
    chunk_count: chunkCount,
    status,
    error,
  };
}

function upsertVariantList(
  existing: AssetVariantDoc[],
  next: AssetVariantDoc,
): AssetVariantDoc[] {
  const idx = existing.findIndex((v) => v.variant_id === next.variant_id);
  if (idx < 0) return [...existing, next];
  const copy = [...existing];
  copy[idx] = next;
  return copy;
}

function safeErrorMessage(err: unknown): { code: string; message: string } {
  if (err instanceof ProxyBudgetExhaustedError) {
    return {
      code: err.code,
      message: `Visual proxy exceeds budget after ladder (budget ${err.budgetBytes} B)`,
    };
  }
  if (err instanceof Error) {
    const code =
      'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : err.name || 'PIPELINE_ERROR';
    // Never leak absolute paths in client-facing messages
    const message = err.message.replace(/\/[^\s:]+/g, '[path]');
    return { code, message: message.slice(0, 400) };
  }
  return { code: 'PIPELINE_ERROR', message: 'Unknown pipeline error' };
}

/**
 * Attach workload estimate to a job and persist; optionally wait for confirm.
 * Call after createIngestJob + before/alongside startPipeline.
 */
export async function prepareJobEstimate(job: IngestJob): Promise<{
  windows: ChunkWindow[];
  workload: WorkloadEstimate;
  variantId: string;
}> {
  const cfg = getConfig();
  const chunking = job.chunking ?? chunkingFromConfig(cfg);
  const { windows, workload, variantId } = estimateWorkload(
    job.probe.duration_ms,
    job.probe.has_audio,
    cfg,
    chunking,
  );

  const variants = upsertVariantList(
    job.variants,
    buildVariantDoc(variantId, cfg, 'pending', windows.length, chunking),
  );

  await updateJob(
    job,
    {
      stage: job.autoStart ? 'estimating' : 'awaiting_confirm',
      status: job.autoStart ? 'pending' : 'awaiting_confirm',
      variantId,
      workload,
      windowsTotal: windows.length,
      windowsDone: 0,
      windowsFailed: 0,
      progressPct: 0,
      variants,
      message: `Estimated ${workload.windows} windows / ${workload.inference_calls} inference calls`,
    },
    { event: 'estimate', persist: true },
  );

  return { windows, workload, variantId };
}

/**
 * Run the full ingest pipeline asynchronously. Idempotent upserts by chunk _id.
 * Failed windows are recorded individually; other windows continue (FR-20).
 */
export async function runIngestPipeline(job: IngestJob): Promise<void> {
  if (job.pipelineRunning) return;
  if (job.status === 'awaiting_confirm') {
    throw new Error('Job is awaiting_confirm — call confirm first');
  }

  job.pipelineRunning = true;
  const cfg = getConfig();
  const root = mediaRoot(cfg);
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();

  try {
    const chunking = job.chunking ?? chunkingFromConfig(cfg);
    const prepared =
      job.workload && job.variantId
        ? {
            windows: planChunks({
              durationMs: job.probe.duration_ms,
              windowMs: chunking.windowMs,
              overlapMs: chunking.overlapMs,
              minMs: chunking.minMs,
            }),
            workload: job.workload,
            variantId: job.variantId,
          }
        : await prepareJobEstimate(job);

    const { windows, workload, variantId } = prepared;
    const variantCfg = variantConfigFromApp(cfg, { chunking });
    const provider = createEmbeddingProvider(cfg);
    assertVariantConfigCompatible(variantCfg, provider);

    const budget = embedBudgetBytes(cfg, variantCfg.provider);
    const proxyDir = path.join(root, 'proxies', job.videoId, variantId);
    const thumbDir = path.join(root, 'thumbs', job.videoId, variantId);
    const playbackDir = path.join(root, 'playback');
    fs.mkdirSync(proxyDir, { recursive: true });
    fs.mkdirSync(thumbDir, { recursive: true });
    fs.mkdirSync(playbackDir, { recursive: true });

    await updateJob(job, {
      status: 'processing',
      stage: 'playback_proxy',
      startedAt,
      variantId,
      workload,
      windowsTotal: windows.length,
      windowsDone: 0,
      windowsFailed: 0,
      progressPct: 2,
      variants: upsertVariantList(
        job.variants,
        buildVariantDoc(
          variantId,
          cfg,
          'processing',
          windows.length,
          chunking,
        ),
      ),
      message: 'Building playback proxy',
    });

    const playbackOut = path.join(playbackDir, `${job.videoId}.mp4`);
    const playback = await encodePlaybackProxy({
      inputPath: job.mediaPath,
      outputPath: playbackOut,
      probe: job.probe,
      maxHeight: cfg.PLAYBACK_MAX_HEIGHT,
    });
    const playbackPath = playback.skipped
      ? job.mediaPath
      : playback.output_path;

    await updateJob(job, {
      playbackPath,
      stage: 'encoding',
      progressPct: 5,
      message: playback.skipped
        ? 'Playback proxy skipped (source suitable)'
        : 'Playback proxy ready',
    });

    const successful: ChunkDocument[] = [];
    const windowErrors: WindowErrorInfo[] = [];
    const total = Math.max(windows.length, 1);

    for (const win of windows) {
      const idx = win.chunk_index;
      job.currentChunkIndex = idx;

      const videoProxyPath = path.join(proxyDir, `${idx}.mp4`);
      const audioProxyPath = path.join(proxyDir, `${idx}.opus`);
      const thumbPath = path.join(thumbDir, `${idx}.jpg`);

      try {
        await updateJob(
          job,
          {
            stage: 'encoding',
            currentChunkIndex: idx,
            progressPct: 5 + (idx / total) * 70,
            message: `Encoding window ${idx + 1}/${windows.length}`,
          },
          { persist: false },
        );

        await updateJob(
          job,
          {
            stage: 'embedding',
            currentChunkIndex: idx,
            message: `Embedding window ${idx + 1}/${windows.length}`,
          },
          { persist: false },
        );

        const prepared = await prepareFiniteMedia({
          inputPath: job.mediaPath,
          startMs: win.start_ms,
          endMs: win.end_ms,
          hasAudio: job.probe.has_audio,
          budgetBytes: budget,
          proxySettings: variantCfg.proxySettings,
          provider,
          paths: {
            videoProxy: videoProxyPath,
            audioProxy: audioProxyPath,
            thumb: thumbPath,
          },
          options: {
            concurrentEmbed: false,
            extractThumb: true,
          },
        });

        const doc: ChunkDocument = {
          video_id: job.videoId,
          variant_id: variantId,
          chunk_index: idx,
          start_ms: win.start_ms,
          end_ms: win.end_ms,
          duration_ms: win.end_ms - win.start_ms,
          start_label: formatMsLabel(win.start_ms),
          end_label: formatMsLabel(win.end_ms),
          embedding_video: prepared.embedding_video,
          embedding_audio: prepared.embedding_audio,
          provider: provider.provider,
          model: provider.model,
          task: provider.task,
          normalized_by: provider.normalizedBy,
          video_proxy: {
            bytes: prepared.videoMeta.bytes,
            width: prepared.videoMeta.width,
            height: prepared.videoMeta.height,
            frames: prepared.videoMeta.frames,
            crf: prepared.videoMeta.crf,
            strategy: prepared.videoMeta.strategy,
            ladder_exhausted: prepared.videoMeta.ladder_exhausted,
          },
          audio_proxy: prepared.audioMeta
            ? {
                bytes: prepared.audioMeta.bytes,
                bitrate: prepared.audioMeta.bitrate,
                codec: prepared.audioMeta.codec,
              }
            : undefined,
          thumb_path: prepared.thumb?.output_path,
          has_audio: prepared.has_audio,
          video_title: job.title,
          source_mode: job.mode,
          created_at: new Date().toISOString(),
        };

        successful.push(doc);
        job.windowsDone = successful.length;
        job.windowsFailed = windowErrors.length;

        emitJobEvent(job, 'window_done', {
          current_chunk_index: idx,
          windows_done: job.windowsDone,
          windows_failed: job.windowsFailed,
          progress_pct: 5 + ((idx + 1) / total) * 70,
          message: `Window ${idx + 1}/${windows.length} ready`,
        });
      } catch (err) {
        const info = safeErrorMessage(err);
        const windowError: WindowErrorInfo = {
          chunk_index: idx,
          code: info.code,
          message: info.message,
        };
        windowErrors.push(windowError);
        job.windowErrors = windowErrors;
        job.windowsFailed = windowErrors.length;
        job.windowsDone = successful.length;

        emitJobEvent(job, 'window_failed', {
          current_chunk_index: idx,
          windows_done: job.windowsDone,
          windows_failed: job.windowsFailed,
          window_error: windowError,
          progress_pct: 5 + ((idx + 1) / total) * 70,
          message: `Window ${idx + 1} failed: ${info.code}`,
        });
        await persistJob(job);
      }
    }

    await updateJob(job, {
      stage: 'indexing',
      progressPct: 90,
      windowsDone: successful.length,
      windowsFailed: windowErrors.length,
      message: `Indexing ${successful.length} chunks`,
    });

    if (successful.length > 0) {
      const bulk = await bulkUpsertChunks(successful);
      if (bulk.errors.length > 0) {
        for (const e of bulk.errors) {
          windowErrors.push({
            chunk_index: -1,
            code: 'BULK_INDEX_ERROR',
            message: `${e.id}: ${e.error}`.slice(0, 400),
          });
        }
        job.windowErrors = windowErrors;
        job.windowsFailed = windowErrors.length;
      }
    }

    const elapsedMin = Math.max((Date.now() - startedMs) / 60_000, 1 / 60);
    const throughput = successful.length / elapsedMin;
    const completedAt = new Date().toISOString();

    if (successful.length === 0) {
      const fatal = {
        code: 'PIPELINE_NO_WINDOWS',
        message:
          windowErrors[0]?.message ||
          'No windows indexed — all windows failed or none planned',
      };
      await updateJob(
        job,
        {
          status: 'failed',
          stage: 'failed',
          progressPct: 100,
          completedAt,
          throughputWindowsPerMin: 0,
          error: fatal,
          variants: upsertVariantList(
            job.variants,
            buildVariantDoc(
              variantId,
              cfg,
              'failed',
              0,
              chunking,
              fatal.message,
            ),
          ),
          message: fatal.message,
        },
        { event: 'error', persist: true, extra: { error: fatal } },
      );
      return;
    }

    const summary =
      windowErrors.length > 0
        ? `Ready with ${successful.length} chunks, ${windowErrors.length} window failures; ${throughput.toFixed(2)} windows/min`
        : `Ready: ${successful.length} chunks; ${throughput.toFixed(2)} windows/min`;

    await updateJob(
      job,
      {
        status: 'ready',
        stage: 'complete',
        progressPct: 100,
        completedAt,
        throughputWindowsPerMin: throughput,
        windowsDone: successful.length,
        windowsFailed: windowErrors.length,
        variants: upsertVariantList(
          job.variants,
          buildVariantDoc(
            variantId,
            cfg,
            'ready',
            successful.length,
            chunking,
            windowErrors.length
              ? `${windowErrors.length} window(s) failed`
              : undefined,
          ),
        ),
        message: summary,
        error: null,
      },
      {
        event: 'complete',
        persist: true,
        extra: { throughput_windows_per_min: throughput, message: summary },
      },
    );
  } catch (err) {
    const fatal = safeErrorMessage(err);
    await updateJob(
      job,
      {
        status: 'failed',
        stage: 'failed',
        progressPct: 100,
        completedAt: new Date().toISOString(),
        error: fatal,
        pipelineRunning: false,
        message: fatal.message,
        variants: job.variantId
          ? upsertVariantList(
              job.variants,
              buildVariantDoc(
                job.variantId,
                cfg,
                'failed',
                job.windowsDone,
                job.chunking ?? chunkingFromConfig(cfg),
                fatal.message,
              ),
            )
          : job.variants,
      },
      { event: 'error', persist: true, extra: { error: fatal } },
    );
  } finally {
    job.pipelineRunning = false;
  }
}

/**
 * Fire-and-forget pipeline start after HTTP response.
 * Errors are recorded on the job via SSE — never thrown to the route.
 */
export function startPipelineAsync(job: IngestJob): void {
  if (!job.autoStart && job.status === 'awaiting_confirm') return;
  void runIngestPipeline(job).catch(async (err) => {
    const fatal = safeErrorMessage(err);
    try {
      await updateJob(
        job,
        {
          status: 'failed',
          stage: 'failed',
          error: fatal,
          pipelineRunning: false,
          message: fatal.message,
        },
        { event: 'error', persist: true, extra: { error: fatal } },
      );
    } catch {
      job.pipelineRunning = false;
    }
  });
}

/** Move awaiting_confirm → processing and start. */
export async function confirmAndStartJob(job: IngestJob): Promise<void> {
  if (job.status === 'processing' || job.pipelineRunning) return;
  if (job.status === 'ready' || job.status === 'failed') return;

  job.autoStart = true;
  await updateJob(job, {
    status: 'processing',
    stage: 'playback_proxy',
    message: 'Confirmed — starting pipeline',
  });
  startPipelineAsync(job);
}
