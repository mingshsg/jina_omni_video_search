/**
 * Phase 3 entry gate — 50-window MediaMTX / FFmpeg / EIS / Elasticsearch spike.
 *
 * Uses uniquely prefixed scratch data stream on the `.env` Elastic endpoint,
 * then deletes only those scratch resources.
 *
 * Usage:
 *   docker compose -f docker-compose.live.yml up -d
 *   yarn live-feasibility-spike
 *
 * Optional: SPIKE_WINDOW_COUNT=10 yarn live-feasibility-spike
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadDotenv } from './load-dotenv';

loadDotenv();

import { loadConfig, getConfig } from '../lib/config';
import { getEsClient, resetEsClient } from '../lib/es/client';
import { createEmbeddingProvider } from '../lib/embed/provider';
import { loadLiveConfig, resetLiveConfig } from '../lib/live/config';
import { RtspSourceAdapter } from '../lib/live/adapters/rtsp';
import { ProcessSupervisor } from '../lib/live/process-supervisor';
import { buildFragmentCaptureArgs } from '../lib/live/fragment-capture';
import { HlsFragmentWatcher } from '../lib/live/fragment-watcher';
import {
  assembleWindowsFromFragments,
  chunkIdFor,
  type FinalizedFragment,
} from '../lib/live/window-assembler';
import { remuxFragmentsToMp4, probePtsCoverageMs } from '../lib/live/window-remux';
import {
  ensureSessionSpoolLayout,
  sessionSpoolDir,
} from '../lib/live/spool-paths';
import { sha256File } from '../lib/live/fragment-manifest';
import { encodeVideoProxy, encodeAudioProxy } from '../lib/video/proxy-encode';
import type { LiveSourceSnapshot } from '../lib/live/types';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function summarize(ms: number[]): { p50: number; p95: number; p99: number; n: number } {
  const s = [...ms].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
  };
}

async function waitForFragments(
  playlistPath: string,
  fragmentDir: string,
  minCount: number,
  timeoutMs: number,
): Promise<FinalizedFragment[]> {
  // Accumulate across sliding HLS windows (bounded hls_list_size).
  const watcher = new HlsFragmentWatcher(playlistPath, fragmentDir);
  const accumulated: FinalizedFragment[] = [];
  let ptsCursor = 0;
  const started = Date.now();
  let lastProgress = 0;

  while (Date.now() - started < timeoutMs) {
    for (const frag of watcher.poll()) {
      if (!fs.existsSync(frag.absolutePath)) {
        throw new Error(`Playlist references missing fragment ${frag.absolutePath}`);
      }
      if (fs.existsSync(`${frag.absolutePath}.tmp`)) {
        throw new Error(
          `Partial .tmp still present for finalized ${frag.absolutePath}`,
        );
      }
      const durationMs = Math.round(frag.durationSec * 1000);
      const start_pts_ms = ptsCursor;
      const end_pts_ms = ptsCursor + durationMs;
      ptsCursor = end_pts_ms;
      accumulated.push({
        stream_epoch: 1,
        sequence_no: frag.sequence_no,
        start_pts_ms,
        end_pts_ms,
        media_signature: 'spike-sig',
        finalized_at: frag.discovered_at,
        program_date_time: frag.programDateTime,
        path: frag.absolutePath,
        media_sha256: sha256File(frag.absolutePath),
      });
    }
    if (accumulated.length !== lastProgress) {
      lastProgress = accumulated.length;
      console.error(
        JSON.stringify({
          progress: 'fragments',
          count: lastProgress,
          need: minCount,
        }),
      );
    }
    if (accumulated.length >= minCount) {
      return accumulated.slice(0, minCount);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Timeout waiting for ${minCount} fragments (have ${accumulated.length})`,
  );
}

async function main(): Promise<void> {
  resetEsClient();
  resetLiveConfig();
  loadConfig();
  const liveCfg = loadLiveConfig({
    LIVE_ALLOWED_HOSTS: 'localhost,127.0.0.1',
    LIVE_ALLOWED_PORTS: '554,8554',
  });

  const windowCount = Math.max(
    1,
    Number(process.env.SPIKE_WINDOW_COUNT ?? '50') || 50,
  );
  // windows end at seq 3,6,...,3+(n-1)*3 → need fragments 0..end inclusive
  const lastSeq = 3 + (windowCount - 1) * 3;
  const fragmentNeed = lastSeq + 1;

  const runId = `spike${Date.now().toString(36)}`;
  const scratchStream = `live-spike-${runId}`;
  const scratchTemplate = `${scratchStream}-template`;
  const spoolRoot = path.resolve('./data/live-spool');
  const sessionId = `ls_${runId}`;
  const sessionDir = sessionSpoolDir(spoolRoot, sessionId);
  ensureSessionSpoolLayout(sessionDir);
  const fragmentDir = path.join(sessionDir, 'fragments');
  const playlistPath = path.join(fragmentDir, 'live.m3u8');
  const segmentPattern = path.join(fragmentDir, 'frag_%06d.ts');

  const adapter = new RtspSourceAdapter(liveCfg);
  const snapshot: LiveSourceSnapshot = {
    source_revision: 1,
    protocol: 'rtsp',
    transport: 'tcp',
    connection_ref: 'LIVE_SOURCE_FIXTURE_URL',
    endpoint_fingerprint: '',
    allowed_host: '127.0.0.1',
    allowed_port: 8554,
  };
  const source = await adapter.resolve(snapshot, {
    url: 'rtsp://127.0.0.1:8554/fixture',
  });

  const captureArgs = buildFragmentCaptureArgs({
    source,
    inputScriptPath: path.join(sessionDir, 'private', 'ffmpeg-input.ffconcat'),
    segmentFilenamePattern: segmentPattern,
    playlistPath,
    fragmentSeconds: 2,
    includeAudio: false,
    loglevel: 'info',
  });

  const report: Record<string, unknown> = {
    runId,
    windowCount,
    fragmentNeed,
    scratchStream,
    rtsp_flags: {
      rtsp_transport: 'tcp',
      timeout_us: 15_000_000,
      protocol_whitelist: captureArgs[
        captureArgs.indexOf('-protocol_whitelist') + 1
      ],
    },
    started_at: new Date().toISOString(),
  };

  const stderrLog = path.join(sessionDir, 'tmp', 'capture.stderr.log');
  const stderrStream = fs.createWriteStream(stderrLog, { flags: 'a' });
  const supervisor = new ProcessSupervisor({
    args: captureArgs,
    redact: [],
    disableConnectTimeout: true,
    connectTimeoutMs: 0,
    onStderr: (chunk) => {
      stderrStream.write(chunk);
    },
  });

  const capturePromise = supervisor.run();
  const captureStarted = performance.now();

  let fragments: FinalizedFragment[];
  try {
    fragments = await waitForFragments(
      playlistPath,
      fragmentDir,
      fragmentNeed,
      fragmentNeed * 3000 + 90_000,
    );
  } catch (err) {
    await supervisor.stop('SIGTERM');
    const result = await capturePromise.catch(() => null);
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}; capture_state=${result?.state ?? 'unknown'}; stderr_tail=${(result?.stderrTail ?? supervisor.getStderrTail()).slice(-2000)}`,
    );
  } finally {
    await supervisor.stop('SIGTERM');
    await capturePromise.catch(() => undefined);
    stderrStream.end();
  }
  const captureMs = performance.now() - captureStarted;

  const durations = fragments.map((f) => f.end_pts_ms - f.start_pts_ms);
  const drift = durations.map((d) => Math.abs(d - 2000));
  const anchorDeltas: number[] = [];
  for (const f of fragments) {
    if (!f.program_date_time) continue;
    const pdt = Date.parse(f.program_date_time);
    const fin = Date.parse(f.finalized_at);
    if (Number.isFinite(pdt) && Number.isFinite(fin)) {
      anchorDeltas.push(Math.abs(fin - pdt));
    }
  }

  const { windows } = assembleWindowsFromFragments(fragments);
  if (windows.length < windowCount) {
    throw new Error(`Expected ${windowCount} windows, got ${windows.length}`);
  }
  const selected = windows.slice(0, windowCount);

  const remuxMs: number[] = [];
  const proxyMs: number[] = [];
  const inferMs: number[] = [];
  const indexMs: number[] = [];

  const client = getEsClient();
  const cfg = getConfig();

  // Scratch data stream (create-only, indefinite lifecycle)
  await client.indices.putIndexTemplate({
    name: scratchTemplate,
    index_patterns: [scratchStream],
    data_stream: {},
    priority: 600,
    template: {
      mappings: {
        dynamic: 'strict',
        properties: {
          '@timestamp': { type: 'date' },
          chunk_id: { type: 'keyword' },
          spike_run: { type: 'keyword' },
          embedding_video: {
            type: 'dense_vector',
            dims: 1024,
            index: true,
            similarity: 'cosine',
          },
          embedding_audio: {
            type: 'dense_vector',
            dims: 1024,
            index: true,
            similarity: 'cosine',
          },
        },
      },
      lifecycle: { enabled: true },
    },
  });
  try {
    await client.indices.createDataStream({ name: scratchStream });
  } catch (err: unknown) {
    const status =
      typeof err === 'object' &&
      err !== null &&
      'meta' in err &&
      typeof (err as { meta?: { statusCode?: number } }).meta?.statusCode ===
        'number'
        ? (err as { meta: { statusCode: number } }).meta.statusCode
        : undefined;
    if (status !== 400) throw err;
  }

  const provider = createEmbeddingProvider(cfg);
  const budget =
    cfg.EIS_MAX_BINARY_BYTES ??
    cfg.JINA_MAX_BINARY_BYTES ??
    cfg.LOCAL_MAX_BINARY_BYTES ??
    4_000_000;

  for (let i = 0; i < selected.length; i++) {
    const w = selected[i]!;
    const chunkId = chunkIdFor(sessionId, w.stream_epoch, w.sequence_no);
    const mp4Path = path.join(sessionDir, 'media', `${chunkId}.mp4`);

    const t0 = performance.now();
    await remuxFragmentsToMp4({
      fragmentPaths: w.fragment_paths,
      outputPath: mp4Path,
      sessionDir,
    });
    remuxMs.push(performance.now() - t0);

    const coverage = await probePtsCoverageMs(mp4Path);
    void coverage;

    const proxyPath = path.join(sessionDir, 'tmp', `${chunkId}.proxy.mp4`);
    const audioPath = path.join(sessionDir, 'tmp', `${chunkId}.proxy.opus`);
    const t1 = performance.now();
    const videoMeta = await encodeVideoProxy({
      inputPath: mp4Path,
      outputPath: proxyPath,
      startMs: 0,
      endMs: Math.max(1000, w.duration_ms),
      budgetBytes: budget,
      proxySettings: {
        max_long_edge: liveCfg.LIVE_PROXY_MAX_LONG_EDGE,
        video_frames: 16,
      },
    });
    let hasAudio = true;
    try {
      await encodeAudioProxy({
        inputPath: mp4Path,
        outputPath: audioPath,
        startMs: 0,
        endMs: Math.max(1000, w.duration_ms),
        hasAudio: true,
      });
    } catch {
      hasAudio = false;
    }
    proxyMs.push(performance.now() - t1);

    const videoBuf = fs.readFileSync(proxyPath);
    const t2 = performance.now();
    const [videoEmb, audioEmb] = await Promise.all([
      provider.embedVideo(videoBuf, 'passage'),
      hasAudio && fs.existsSync(audioPath)
        ? provider.embedAudio(fs.readFileSync(audioPath), 'passage')
        : Promise.resolve(null),
    ]);
    inferMs.push(performance.now() - t2);

    const t3 = performance.now();
    await client.index({
      index: scratchStream,
      id: chunkId,
      op_type: 'create',
      refresh: 'wait_for',
      document: {
        '@timestamp': w.window_end_at,
        chunk_id: chunkId,
        spike_run: runId,
        embedding_video: videoEmb.vector,
        ...(audioEmb ? { embedding_audio: audioEmb.vector } : {}),
      },
    });
    indexMs.push(performance.now() - t3);

    console.error(
      JSON.stringify({
        progress: 'window',
        i: i + 1,
        windowCount,
        chunkId,
        proxyBytes: videoMeta.bytes,
        remux_ms: remuxMs[i],
        proxy_ms: proxyMs[i],
        infer_ms: inferMs[i],
        index_ms: indexMs[i],
      }),
    );
  }

  // Cleanup scratch only
  try {
    await client.indices.deleteDataStream({ name: scratchStream });
  } catch {
    // ignore
  }
  try {
    await client.indices.deleteIndexTemplate({ name: scratchTemplate });
  } catch {
    // ignore
  }

  report.capture_ms = Math.round(captureMs);
  report.fragment_duration_ms = summarize(durations);
  report.fragment_drift_from_2000_ms = summarize(drift);
  report.receive_anchor_uncertainty_ms = summarize(anchorDeltas);
  report.stage_timings_ms = {
    remux: summarize(remuxMs),
    proxy: summarize(proxyMs),
    inference: summarize(inferMs),
    index_refresh: summarize(indexMs),
  };
  report.end_to_end_close_to_searchable_p95_ms =
    summarize(
      selected.map((_, i) => remuxMs[i]! + proxyMs[i]! + inferMs[i]! + indexMs[i]!),
    ).p95;
  report.finished_at = new Date().toISOString();
  report.ok = true;
  report.notes = [
    'Retention forever / unlimited spool unchanged.',
    'Scratch stream deleted after run.',
    'Architecture remains fragment-aligned 4/3.',
  ];

  // Latency budget check (planning 10s close-to-searchable)
  const p95 = report.end_to_end_close_to_searchable_p95_ms as number;
  report.budget = {
    close_to_searchable_target_ms: 10_000,
    p95_ms: p95,
    within_budget: p95 <= 10_000,
  };

  const outDir = path.join(process.cwd(), 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `live-feasibility-spike-${runId}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, outFile }, null, 2));
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
