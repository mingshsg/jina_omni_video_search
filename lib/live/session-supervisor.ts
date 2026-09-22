import fs from 'node:fs';
import path from 'node:path';
import type { LiveConfig } from './config';
import {
  appendManifestRecord,
  manifestPath,
  sha256File,
  type ManifestRecord,
  type ManifestRecordType,
} from './fragment-manifest';
import { buildFragmentCaptureArgs } from './fragment-capture';
import { HlsFragmentWatcher } from './fragment-watcher';
import {
  ProcessSupervisor,
  nextReconnectDelayMs,
  type ProcessSupervisorResult,
} from './process-supervisor';
import {
  assembleWindowsFromFragments,
  chunkIdFor,
  type AssembledWindow,
  type FinalizedFragment,
} from './window-assembler';
import { remuxFragmentsToMp4 } from './window-remux';
import {
  createIndexAckQueue,
  createWorkQueue,
  IndexMicroBatcher,
  type DroppedWindow,
  type LiveWorkItem,
} from './queue';
import {
  LiveWindowProcessor,
  newWorkerBootId,
  type WindowProcessorHooks,
} from './processor';
import { createLiveEmbedWindowHook } from './embed-window';
import { LiveIndexer } from './indexer';
import {
  defaultRetentionPolicy,
  evaluateSpoolPressure,
  measureSpoolUsage,
  readDiskFreeBytes,
} from './spool-accounting';
import {
  ensureSessionSpoolLayout,
  ensureEpochFragmentDir,
  sessionSpoolDir,
} from './spool-paths';
import { supervisorHealthPatch } from './ownership';
import type { LiveSessionDocument, LiveSessionHealth, LiveObservedState } from './types';
import type { ValidatedConnectDescriptor } from './source-adapter';
import type { SessionRecoveryPlan } from './recovery';
import { buildRecoveryWorkItem } from './recovery';
import { createLiveSourceAdapter } from './adapters/registry';
import { createSingleFlight, type SingleFlight } from './concurrency';
import {
  hlsPlaylistListSize,
  pruneCaptureWorkingSet,
  unlinkPrunedFragmentFiles,
} from './working-set';

/**
 * Per-session capture + queue wiring. One active session for MVP.
 */

export interface SessionRuntimeHooks {
  updateObserved: (
    sessionId: string,
    patch: Partial<{
      observed_state: LiveObservedState;
      worker_id: string;
      stream_epoch: number;
      last_sequence_no_in_current_epoch: number;
      health: Partial<LiveSessionHealth>;
      current_error: LiveSessionDocument['current_error'];
      timestamps: Partial<LiveSessionDocument['timestamps']>;
    }>,
  ) => Promise<void>;
  /**
   * Re-resolve connection_ref + destination policy before reconnect.
   * Required for auto-reconnect after unexpected FFmpeg exit.
   */
  resolveSource?: () => Promise<ValidatedConnectDescriptor>;
  /** Called when the session reaches a terminal observed state (stopped/failed). */
  onTerminal?: (
    sessionId: string,
    observed: Extract<LiveObservedState, 'stopped' | 'failed'>,
  ) => Promise<void>;
  processorHooks?: Partial<WindowProcessorHooks>;
  /** Override FFmpeg spawn for tests. */
  spawnCapture?: (args: {
    argv: string[];
    sessionDir: string;
    inputScriptPath: string;
  }) => ProcessSupervisor;
  now?: () => number;
  monotonicNs?: () => bigint;
  /** Override backoff sleep in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SessionRuntimeSnapshot {
  session_id: string;
  observed_state: LiveObservedState;
  work_queue: ReturnType<LiveWorkItemQueue['stats']>;
  index_ack_queue: ReturnType<LiveWorkItemQueue['stats']>;
  windows_dropped: number;
  stream_epoch: number;
}

type LiveWorkItemQueue = ReturnType<typeof createWorkQueue>;

export class SessionRuntime {
  readonly workQueue: LiveWorkItemQueue;
  readonly indexAckQueue: ReturnType<typeof createIndexAckQueue>;
  readonly microBatcher: IndexMicroBatcher;
  readonly processor: LiveWindowProcessor;
  readonly sessionDir: string;
  readonly bootId: string;

  private observed: LiveObservedState = 'created';
  private streamEpoch = 1;
  private lastSequence = 0;
  private fragments: FinalizedFragment[] = [];
  private emittedWindows = new Set<string>();
  private supervisor: ProcessSupervisor | null = null;
  private watcher: HlsFragmentWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly fragmentPollFlight: SingleFlight = createSingleFlight();
  private capturePromise: Promise<void> | null = null;
  private windowsDropped = 0;
  private reconnectCount = 0;
  private captureGeneration = 0;
  private inputScriptPath: string;
  private health: LiveSessionHealth = {
    queue_depth: 0,
    queue_high_water: 0,
    indexing_batches_in_flight: 0,
    spool_bytes: 0,
    reconnect_count: 0,
    windows_searchable: 0,
    windows_failed: 0,
    windows_dropped: 0,
  };
  private stopRequested = false;
  private terminalNotified = false;

  constructor(
    private readonly cfg: LiveConfig,
    private readonly session: LiveSessionDocument,
    private readonly workerId: string,
    private readonly hooks: SessionRuntimeHooks,
  ) {
    this.sessionDir = sessionSpoolDir(cfg.LIVE_SPOOL_DIR, session.session_id);
    this.inputScriptPath = path.join(
      this.sessionDir,
      'private',
      'ffmpeg-input.ffconcat',
    );
    this.bootId = newWorkerBootId();
    this.workQueue = createWorkQueue(cfg.LIVE_QUEUE_MAX_WINDOWS);
    this.indexAckQueue = createIndexAckQueue(cfg.LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS);
    this.microBatcher = new IndexMicroBatcher(
      this.indexAckQueue,
      Math.max(1, Math.min(8, cfg.LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS)),
      cfg.LIVE_INDEX_MAX_IN_FLIGHT_BATCHES,
    );

    const indexer = new LiveIndexer(cfg);
    const embedHook =
      hooks.processorHooks?.processWindow ??
      createLiveEmbedWindowHook({
        cfg,
        ctx: {
          session,
          workerBootId: this.bootId,
        },
      });

    this.processor = new LiveWindowProcessor(
      cfg,
      this.workQueue,
      this.indexAckQueue,
      this.microBatcher,
      {
        processWindow: embedHook,
        onIndexBatchAck:
          hooks.processorHooks?.onIndexBatchAck ??
          ((items) => indexer.indexAckBatch(items)),
        onWindowFailed: async (item, error) => {
          this.health.windows_failed += 1;
          this.appendManifest({
            type: 'window_failed',
            chunk_id: item.chunk_id,
            error,
          });
          await hooks.processorHooks?.onWindowFailed?.(item, error);
          await this.publishHealth();
        },
        onIndexAckDrops: async (drops) => {
          this.persistDrops(drops);
          await hooks.processorHooks?.onIndexAckDrops?.(drops);
          await this.publishHealth();
        },
        now: hooks.now,
      },
    );
  }

  get sessionId(): string {
    return this.session.session_id;
  }

  snapshot(): SessionRuntimeSnapshot {
    return {
      session_id: this.session.session_id,
      observed_state: this.observed,
      work_queue: this.workQueue.stats(),
      index_ack_queue: this.indexAckQueue.stats(),
      windows_dropped: this.windowsDropped,
      stream_epoch: this.streamEpoch,
    };
  }

  /** Apply recovery plan before capture (replay finalized windows into work queue). */
  applyRecovery(plan: SessionRecoveryPlan): void {
    this.streamEpoch = plan.next_stream_epoch;
    this.lastSequence = Math.max(0, plan.next_sequence_hint - 1);
    for (const chunkId of plan.replay_chunk_ids) {
      const state = plan.windows.get(chunkId);
      if (!state) continue;
      const item = buildRecoveryWorkItem({
        sessionId: this.session.session_id,
        sessionDir: this.sessionDir,
        state,
        defaultDurationMs: this.cfg.LIVE_WINDOW_MS,
        streamEpochFallback: this.streamEpoch,
      });
      const { accepted, drops } = this.workQueue.enqueue(item);
      void accepted;
      this.persistDrops(drops);
    }
  }

  async startCapture(source: ValidatedConnectDescriptor): Promise<void> {
    ensureSessionSpoolLayout(this.sessionDir);
    this.stopRequested = false;
    this.terminalNotified = false;
    const generation = ++this.captureGeneration;
    this.observed = 'connecting';
    await this.hooks.updateObserved(this.session.session_id, {
      observed_state: 'connecting',
      worker_id: this.workerId,
      stream_epoch: this.streamEpoch,
      last_sequence_no_in_current_epoch: this.lastSequence,
      timestamps: {
        connect_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    this.appendManifest({
      type: 'epoch_started',
      stream_epoch: this.streamEpoch,
      worker_boot_id: this.bootId,
    });

    // A-07: epoch-isolated fragment dir + playlist so reconnect cannot re-ingest
    // the prior epoch's unbounded playlist / overwritten frag_%06d.ts names.
    const fragmentDir = ensureEpochFragmentDir(this.sessionDir, this.streamEpoch);
    const playlistPath = path.join(fragmentDir, 'live.m3u8');
    const segmentPattern = path.join(fragmentDir, 'frag_%06d.ts');
    if (fs.existsSync(playlistPath)) {
      fs.unlinkSync(playlistPath);
    }
    const protocol = source.snapshot.protocol;
    const adapter = createLiveSourceAdapter(protocol, this.cfg, {
      requireSrtCapability: false,
      transport: source.snapshot.transport,
    });
    const captureSource: ValidatedConnectDescriptor =
      protocol === 'rtsp' || protocol === 'whip'
        ? {
            ...source,
            inputScriptOptions: {
              ...source.inputScriptOptions,
              // A-17: wire LIVE_READ_TIMEOUT_MS into ffconcat RTSP timeout (µs).
              timeout: String(this.cfg.LIVE_READ_TIMEOUT_MS * 1000),
            },
          }
        : source;
    const inputArgs = adapter.buildFfmpegInput(
      captureSource,
      this.inputScriptPath,
    );
    const argv = buildFragmentCaptureArgs({
      source: captureSource,
      inputScriptPath: this.inputScriptPath,
      segmentFilenamePattern: segmentPattern,
      playlistPath,
      fragmentSeconds: this.cfg.LIVE_FRAGMENT_MS / 1000,
      startNumber: 0,
      // A-10: bound playlist working set (not retained media/).
      hlsListSize: hlsPlaylistListSize(this.cfg.LIVE_FRAGMENTS_PER_WINDOW),
      inputArgs,
    });

    this.watcher = new HlsFragmentWatcher(playlistPath, fragmentDir);
    this.processor.start();

    const redact = [
      source.authenticatedInputUrl,
      source.bindInputUrl,
    ];
    const supervisor =
      this.hooks.spawnCapture?.({
        argv,
        sessionDir: this.sessionDir,
        inputScriptPath: this.inputScriptPath,
      }) ??
      new ProcessSupervisor({
        args: argv,
        redact,
        // A-17: honor LIVE_CONNECT_TIMEOUT_MS; cleared once FFmpeg reports media.
        connectTimeoutMs: this.cfg.LIVE_CONNECT_TIMEOUT_MS,
      });
    this.supervisor = supervisor;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollTimer = setInterval(() => {
      // A-19: single-flight fragment polls — skip if prior tick still running.
      void this.fragmentPollFlight.run(() => this.pollFragments());
    }, 200);

    this.capturePromise = supervisor
      .run()
      .then(async (result) => {
        if (generation !== this.captureGeneration) return;
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        // Session-requested stop only. Connect-timeout (timedOut) must reconnect.
        if (this.stopRequested) {
          return;
        }
        if (result.stopped && !result.timedOut) {
          return;
        }
        await this.handleCaptureExit(result, source);
      })
      .catch(async (err) => {
        if (generation !== this.captureGeneration) return;
        if (this.stopRequested) return;
        this.observed = 'failed';
        await this.hooks.updateObserved(this.session.session_id, {
          observed_state: 'failed',
          current_error: {
            code: 'LIVE_CAPTURE_FAILED',
            message: err instanceof Error ? err.message : String(err),
            at: new Date().toISOString(),
          },
          timestamps: {
            stopped_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
        await this.notifyTerminal('failed');
      });
  }

  private async handleCaptureExit(
    result: ProcessSupervisorResult,
    lastSource: ValidatedConnectDescriptor,
  ): Promise<void> {
    const adapter = createLiveSourceAdapter(
      lastSource.snapshot.protocol,
      this.cfg,
      { requireSrtCapability: false, transport: lastSource.snapshot.transport },
    );
    const classification = adapter.classifyExit(result);
    if (classification === 'stopped') {
      return;
    }
    if (classification === 'fatal') {
      this.observed = 'failed';
      await this.hooks.updateObserved(this.session.session_id, {
        observed_state: 'failed',
        health: supervisorHealthPatch(this.health),
        current_error: {
          code: 'LIVE_CAPTURE_FAILED',
          message: `capture fatal exit code=${result.code} signal=${result.signal}`,
          at: new Date().toISOString(),
        },
        timestamps: {
          stopped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      await this.notifyTerminal('failed');
      return;
    }

    // Retryable — degrade, backoff, re-resolve, bump epoch, startCapture again.
    this.reconnectCount += 1;
    this.health.reconnect_count = this.reconnectCount;
    this.observed = 'degraded';
    await this.hooks.updateObserved(this.session.session_id, {
      observed_state: 'degraded',
      health: supervisorHealthPatch(this.health),
      current_error: {
        code: 'LIVE_CAPTURE_EXIT',
        message: `capture exited code=${result.code} signal=${result.signal}; reconnecting`,
        at: new Date().toISOString(),
      },
      timestamps: { updated_at: new Date().toISOString() },
    });

    const delay = nextReconnectDelayMs(this.reconnectCount, {
      maxMs: this.cfg.LIVE_RECONNECT_MAX_MS,
    });
    const sleep = this.hooks.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    await sleep(delay);
    if (this.stopRequested) return;

    this.streamEpoch += 1;
    this.lastSequence = 0;
    this.fragments = [];
    this.emittedWindows = new Set();

    try {
      const source = this.hooks.resolveSource
        ? await this.hooks.resolveSource()
        : lastSource;
      if (this.stopRequested) return;
      await this.startCapture(source);
    } catch (err) {
      if (this.stopRequested) return;
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code ?? 'LIVE_SOURCE_INVALID')
          : 'LIVE_SOURCE_INVALID';
      this.observed = 'failed';
      await this.hooks.updateObserved(this.session.session_id, {
        observed_state: 'failed',
        current_error: {
          code,
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        },
        timestamps: {
          stopped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      await this.notifyTerminal('failed');
    }
  }

  private async notifyTerminal(
    observed: Extract<LiveObservedState, 'stopped' | 'failed'>,
  ): Promise<void> {
    if (this.terminalNotified) return;
    this.terminalNotified = true;
    await this.hooks.onTerminal?.(this.session.session_id, observed);
  }

  private async pollFragments(): Promise<void> {
    if (!this.watcher || this.stopRequested) return;
    const newly = this.watcher.poll();
    if (newly.length === 0) return;

    if (this.observed === 'connecting') {
      this.observed = 'live';
      await this.hooks.updateObserved(this.session.session_id, {
        observed_state: 'live',
        timestamps: {
          live_at: new Date().toISOString(),
          last_media_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    } else if (this.observed === 'degraded') {
      this.observed = 'live';
      await this.hooks.updateObserved(this.session.session_id, {
        observed_state: 'live',
        current_error: null,
        timestamps: {
          last_media_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
    }

    for (const frag of newly) {
      // A-17: first published fragment proves media is flowing — clear connect timeout
      // even when FFmpeg loglevel=warning produces no matching stderr.
      this.supervisor?.clearConnectTimeout();
      const abs = frag.absolutePath;
      const seq = this.lastSequence + 1;
      this.lastSequence = seq;
      const finalizedAt = new Date().toISOString();
      const mediaSha = sha256File(abs);
      const durationMs = Math.round(frag.durationSec * 1000);
      const startPts =
        this.fragments.length === 0
          ? 0
          : this.fragments[this.fragments.length - 1]!.end_pts_ms;
      const record: FinalizedFragment = {
        stream_epoch: this.streamEpoch,
        sequence_no: seq,
        start_pts_ms: startPts,
        end_pts_ms: startPts + Math.max(1, durationMs),
        media_signature: 'h264_aac_live',
        finalized_at: finalizedAt,
        program_date_time: frag.programDateTime,
        path: abs,
        media_sha256: mediaSha,
      };
      this.fragments.push(record);
      this.appendManifest({
        type: 'fragment_finalized',
        stream_epoch: this.streamEpoch,
        sequence_no: seq,
        path: abs,
        media_sha256: mediaSha,
        duration_ms: durationMs,
        program_date_time: frag.programDateTime,
      });
    }

    const { windows } = assembleWindowsFromFragments(this.fragments, {
      nominalFragmentMs: this.cfg.LIVE_FRAGMENT_MS,
    });
    for (const w of windows) {
      await this.finalizeWindow(w);
    }
    // A-10: prune in-memory fragment/window IDs and consumed .ts after remux.
    this.pruneWorkingSet();
    await this.publishHealth();
  }

  /** Bound capture working set; retained media/ is untouched. */
  private pruneWorkingSet(): void {
    const pruned = pruneCaptureWorkingSet({
      fragments: this.fragments,
      emittedWindows: this.emittedWindows,
      sessionId: this.session.session_id,
    });
    this.fragments = pruned.fragments;
    this.emittedWindows = pruned.emittedWindows;
    unlinkPrunedFragmentFiles(pruned.prunedPaths);
  }

  private appendManifest(
    record: Omit<ManifestRecord, 'record_id' | 'at' | 'schema_version'> &
      Partial<Pick<ManifestRecord, 'record_id' | 'at' | 'schema_version'>> & {
        type: ManifestRecordType;
      },
  ): ManifestRecord {
    return appendManifestRecord(manifestPath(this.sessionDir), record, {
      reserveBytes: this.cfg.LIVE_MANIFEST_RESERVE_BYTES,
    });
  }

  private async finalizeWindow(w: AssembledWindow): Promise<void> {
    const chunkId = chunkIdFor(
      this.session.session_id,
      w.stream_epoch,
      w.sequence_no,
    );
    if (this.emittedWindows.has(chunkId)) return;

    // Soft free-space floor: stop accepting more retained media before remux.
    const freeBytes = readDiskFreeBytes(this.sessionDir);
    const freePressure = evaluateSpoolPressure(
      measureSpoolUsage(this.sessionDir),
      defaultRetentionPolicy({
        pendingMaxBytes: this.cfg.LIVE_PENDING_SPOOL_MAX_BYTES,
        retainedMediaMaxBytes: this.cfg.LIVE_RETAINED_MEDIA_MAX_BYTES,
        minFreeBytes: this.cfg.LIVE_SPOOL_MIN_FREE_BYTES,
      }),
      { freeBytes },
    );
    if (freePressure.level === 'disk_free_low') {
      this.observed = 'degraded';
      await this.hooks.updateObserved(this.session.session_id, {
        observed_state: 'degraded',
        current_error: {
          code: 'LIVE_DISK_FREE_LOW',
          message: `spool free space ${freePressure.freeBytes} below floor ${freePressure.minFreeBytes}; pausing capture`,
          at: new Date().toISOString(),
        },
      });
      await this.stop('disk_free_low');
      return;
    }

    this.emittedWindows.add(chunkId);

    this.appendManifest({
      type: 'window_allocated',
      chunk_id: chunkId,
      stream_epoch: w.stream_epoch,
      sequence_no: w.sequence_no,
    });

    const mediaPath = path.join(this.sessionDir, 'media', `${chunkId}.mp4`);
    try {
      await remuxFragmentsToMp4({
        fragmentPaths: w.fragment_paths,
        outputPath: mediaPath,
        sessionDir: this.sessionDir,
      });
    } catch (err) {
      this.appendManifest({
        type: 'window_failed',
        chunk_id: chunkId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.health.windows_failed += 1;
      return;
    }

    const mediaSha256 = sha256File(mediaPath);
    const receiveAnchorUtc = new Date().toISOString();
    const receiveAnchorMono = this.hooks.monotonicNs?.() ?? process.hrtime.bigint();

    this.appendManifest({
      type: 'window_finalized',
      chunk_id: chunkId,
      stream_epoch: w.stream_epoch,
      sequence_no: w.sequence_no,
      media_path: mediaPath,
      media_sha256: mediaSha256,
      receive_anchor_utc: receiveAnchorUtc,
      receive_anchor_monotonic_ns: receiveAnchorMono.toString(),
      worker_boot_id: this.bootId,
      window_end_at: w.window_end_at,
      duration_ms: w.duration_ms,
      start_pts_ms: w.start_pts_ms,
      end_pts_ms: w.end_pts_ms,
    });

    const item: LiveWorkItem = {
      chunk_id: chunkId,
      session_id: this.session.session_id,
      stream_epoch: w.stream_epoch,
      sequence_no: w.sequence_no,
      media_path: mediaPath,
      media_sha256: mediaSha256,
      duration_ms: w.duration_ms,
      window_end_at: w.window_end_at,
      receive_anchor_utc: receiveAnchorUtc,
      receive_anchor_monotonic_ns: Number(receiveAnchorMono % BigInt(Number.MAX_SAFE_INTEGER)),
      enqueued_at: new Date().toISOString(),
      state: 'queued',
      attempt: 1,
    };

    // Spool / queue pressure
    const usage = measureSpoolUsage(this.sessionDir);
    const pressure = evaluateSpoolPressure(
      usage,
      defaultRetentionPolicy({
        pendingMaxBytes: this.cfg.LIVE_PENDING_SPOOL_MAX_BYTES,
        retainedMediaMaxBytes: this.cfg.LIVE_RETAINED_MEDIA_MAX_BYTES,
        minFreeBytes: this.cfg.LIVE_SPOOL_MIN_FREE_BYTES,
      }),
      { freeBytes: readDiskFreeBytes(this.sessionDir) },
    );
    if (
      pressure.level === 'pending_hard' ||
      pressure.level === 'retained_hard' ||
      pressure.level === 'disk_free_low'
    ) {
      if (pressure.level === 'disk_free_low') {
        this.observed = 'degraded';
        await this.hooks.updateObserved(this.session.session_id, {
          observed_state: 'degraded',
          current_error: {
            code: 'LIVE_DISK_FREE_LOW',
            message: `spool free space ${pressure.freeBytes} below floor ${pressure.minFreeBytes}`,
            at: new Date().toISOString(),
          },
        });
        await this.stop('disk_free_low');
        return;
      }
      const drop = this.workQueue.claimOldestQueuedForDrop('spool_hard_limit');
      if (drop) this.persistDrops([drop]);
      else {
        this.observed = 'failed';
        await this.hooks.updateObserved(this.session.session_id, {
          observed_state: 'failed',
          current_error: {
            code: 'LIVE_SPOOL_SATURATED',
            message: 'spool hard limit with no droppable window',
            at: new Date().toISOString(),
          },
        });
        await this.stop('spool_saturated');
        return;
      }
      if (this.observed === 'live') {
        this.observed = 'degraded';
        await this.hooks.updateObserved(this.session.session_id, {
          observed_state: 'degraded',
        });
      }
    }

    const { accepted, drops } = this.workQueue.enqueue(item);
    this.persistDrops(drops);
    if (!accepted) {
      // All slots processing — stop capture rather than silent loss.
      this.observed = 'failed';
      await this.hooks.updateObserved(this.session.session_id, {
        observed_state: 'failed',
        current_error: {
          code: 'LIVE_QUEUE_SATURATED',
          message: 'work queue hard limit with no droppable window',
          at: new Date().toISOString(),
        },
      });
      await this.stop('queue_saturated');
      return;
    }

    if (this.workQueue.isAtWarning() && this.observed === 'live') {
      this.observed = 'degraded';
      await this.hooks.updateObserved(this.session.session_id, {
        observed_state: 'degraded',
      });
    }
  }

  private persistDrops(drops: DroppedWindow[]): void {
    for (const d of drops) {
      this.windowsDropped += 1;
      this.health.windows_dropped = this.windowsDropped;
      this.appendManifest({
        type: 'window_dropped',
        chunk_id: d.chunk_id,
        stream_epoch: d.stream_epoch,
        sequence_no: d.sequence_no,
        reason: d.reason,
        dropped_at: d.dropped_at,
      });
    }
  }

  private async publishHealth(): Promise<void> {
    const wq = this.workQueue.stats();
    const usage = measureSpoolUsage(this.sessionDir);
    this.health = {
      ...this.health,
      queue_depth: wq.depth,
      queue_high_water: wq.highWater,
      indexing_batches_in_flight: this.microBatcher.inFlight,
      spool_bytes: usage.totalBytes,
      reconnect_count: this.reconnectCount,
      windows_dropped: this.windowsDropped,
    };
    await this.hooks.updateObserved(this.session.session_id, {
      // Omit indexer-owned windows_searchable so ES merge preserves it.
      health: supervisorHealthPatch(this.health),
      stream_epoch: this.streamEpoch,
      last_sequence_no_in_current_epoch: this.lastSequence,
      timestamps: {
        last_media_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }

  async stop(reason = 'stop_requested'): Promise<void> {
    this.stopRequested = true;
    this.captureGeneration += 1;
    this.observed = 'stopping';
    await this.hooks.updateObserved(this.session.session_id, {
      observed_state: 'stopping',
      timestamps: { updated_at: new Date().toISOString() },
    });

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.fragmentPollFlight.waitIdle();
    if (this.supervisor) {
      await this.supervisor.stop('SIGTERM');
    }
    await this.processor.stop(this.cfg.LIVE_STOP_DRAIN_TIMEOUT_MS);
    if (this.capturePromise) {
      await this.capturePromise.catch(() => undefined);
    }

    try {
      if (fs.existsSync(this.inputScriptPath)) {
        fs.unlinkSync(this.inputScriptPath);
      }
    } catch {
      // best-effort scrub of credential-bearing script
    }

    const terminal: Extract<LiveObservedState, 'stopped' | 'failed'> =
      reason === 'queue_saturated' ||
      reason === 'spool_saturated' ||
      reason === 'disk_free_low'
        ? 'failed'
        : 'stopped';
    this.observed = terminal;
    await this.hooks.updateObserved(this.session.session_id, {
      observed_state: terminal,
      health: supervisorHealthPatch(this.health),
      timestamps: {
        stopped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    await this.notifyTerminal(terminal);
  }
}
