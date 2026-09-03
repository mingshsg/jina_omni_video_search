/**
 * Phase 10 end-to-end verification (bounded).
 *
 * Usage:
 *   yarn tsx scripts/phase10-e2e.ts              # full: ingest both + search + range
 *   yarn tsx scripts/phase10-e2e.ts --ingest-only standard|fine
 *   yarn tsx scripts/phase10-e2e.ts --eval-only
 *   yarn tsx scripts/phase10-e2e.ts --import-modes
 *
 * Writes JSON under data/uploads/phase10/ (gitignored).
 * Do not print secrets.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadDotenv } from './load-dotenv';

loadDotenv();

const PHASE10_DIR = path.resolve('data/uploads/phase10');
const STATE_PATH = path.join(PHASE10_DIR, 'e2e-state.json');
const RESULTS_PATH = path.join(PHASE10_DIR, 'e2e-results.json');
const VIDEO_CANDIDATES = [
  path.join(PHASE10_DIR, 'tiffany-trailer.mp4'),
  path.join(PHASE10_DIR, 'phase10-synthetic-120s.mp4'),
];

type PresetName = 'standard' | 'fine';

interface PresetEnv {
  CHUNK_PRESET: PresetName;
  CHUNK_WINDOW_MS: string;
  CHUNK_OVERLAP_MS: string;
  CHUNK_MIN_MS: string;
}

const PRESETS: Record<PresetName, PresetEnv> = {
  standard: {
    CHUNK_PRESET: 'standard',
    CHUNK_WINDOW_MS: '64000',
    CHUNK_OVERLAP_MS: '4000',
    CHUNK_MIN_MS: '4000',
  },
  fine: {
    CHUNK_PRESET: 'fine',
    CHUNK_WINDOW_MS: '10000',
    CHUNK_OVERLAP_MS: '2000',
    CHUNK_MIN_MS: '4000',
  },
};

/** Expected ranges for Tiffany trailer (approximate; same-corpus only). */
interface QueryFixture {
  id: string;
  query: string;
  modality: 'visual' | 'audio' | 'both';
  /** Inclusive expected [start_ms, end_ms] intervals (any overlap counts). */
  expected_ranges_ms: Array<[number, number]>;
  notes: string;
}

/** Thumb cadence = 5 s (t001≈0s … t031≈150s). Ranges from inspected frames. */
const TIFFANY_FIXTURES: QueryFixture[] = [
  {
    id: 'tiffany_window',
    query: 'woman in black dress looking at Tiffany jewelry store window',
    modality: 'visual',
    expected_ranges_ms: [[0, 20000]],
    notes: 't001–t002 opening storefront + title card (~0–5s)',
  },
  {
    id: 'orange_coat',
    query: 'woman in orange coat and fur hat with sunglasses on city street',
    modality: 'visual',
    expected_ranges_ms: [[30000, 45000]],
    notes: 't008 ~35s Dont Walk / orange coat',
  },
  {
    id: 'kiss_rain',
    query: 'man and woman kissing in the rain on a city street',
    modality: 'visual',
    expected_ranges_ms: [[100000, 115000]],
    notes: 't022 ~105s rainy embrace/kiss',
  },
  {
    id: 'cat_mask',
    query: 'woman holding a colorful cat mask',
    modality: 'visual',
    expected_ranges_ms: [[110000, 125000]],
    notes: 't024 ~115s cat mask + STARRING AUDREY HEPBURN text',
  },
  {
    id: 'mickey_rooney_credit',
    query: 'Mickey Rooney',
    modality: 'visual',
    expected_ranges_ms: [[130000, 145000]],
    notes: 't028 ~135s credit card OCR (AND ALSO STARRING MICKEY ROONEY)',
  },
];

const SYNTHETIC_FIXTURES: QueryFixture[] = [
  {
    id: 'red_block',
    query: 'solid red color screen',
    modality: 'visual',
    expected_ranges_ms: [[0, 30000]],
    notes: 'Synthetic segment 0–30s red',
  },
  {
    id: 'green_block',
    query: 'solid green color screen',
    modality: 'visual',
    expected_ranges_ms: [[30000, 60000]],
    notes: 'Synthetic segment 30–60s green',
  },
  {
    id: 'blue_block',
    query: 'solid blue color screen',
    modality: 'visual',
    expected_ranges_ms: [[60000, 90000]],
    notes: 'Synthetic segment 60–90s blue',
  },
  {
    id: 'high_tone',
    query: 'high pitched sine tone beep',
    modality: 'audio',
    expected_ranges_ms: [[90000, 120000]],
    notes: 'Synthetic 90–120s high sine',
  },
];

interface E2eState {
  corpus: {
    kind: 'tiffany' | 'synthetic';
    path: string;
    duration_ms: number;
    width: number;
    height: number;
    has_audio: boolean;
    substitution_reason?: string;
    source?: string;
  };
  video_id?: string;
  variants: Record<
    string,
    {
      preset: PresetName;
      variant_id: string;
      windows: number;
      windows_done: number;
      windows_failed: number;
      status: string;
      elapsed_ms: number;
      throughput?: number | null;
      encoder_rungs: {
        resolution_ladder: number[];
        crf_ladder: number[];
      };
      sample_proxy?: {
        width: number;
        height: number;
        crf: number;
        strategy: string;
        bytes: number;
      };
    }
  >;
}

function readState(): E2eState | null {
  if (!fs.existsSync(STATE_PATH)) return null;
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as E2eState;
}

function writeState(state: E2eState): void {
  fs.mkdirSync(PHASE10_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function overlaps(
  hitStart: number,
  hitEnd: number,
  ranges: Array<[number, number]>,
): boolean {
  return ranges.some(([a, b]) => hitStart < b && hitEnd > a);
}

function ensureSynthetic120s(): string {
  const out = path.join(PHASE10_DIR, 'phase10-synthetic-120s.mp4');
  if (fs.existsSync(out) && fs.statSync(out).size > 10_000) return out;
  fs.mkdirSync(PHASE10_DIR, { recursive: true });
  // Four 30s visual blocks with distinct tones
  const filter =
    "color=c=red:s=640x360:d=30[r];" +
    "color=c=green:s=640x360:d=30[g];" +
    "color=c=blue:s=640x360:d=30[b];" +
    "testsrc=size=640x360:rate=1:duration=30[t];" +
    "[r][g][b][t]concat=n=4:v=1:a=0[v]";
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      filter,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=16000:duration=30,' +
        'sine=frequency=440:sample_rate=16000:duration=30,' +
        'sine=frequency=660:sample_rate=16000:duration=30,' +
        'sine=frequency=880:sample_rate=16000:duration=30',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      out,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    // Simpler fallback: one continuous testsrc 120s
    const r2 = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=16000',
        '-t',
        '120',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        out,
      ],
      { encoding: 'utf8' },
    );
    if (r2.status !== 0) {
      console.error(r2.stderr?.slice(-800) || r.stderr?.slice(-800));
      throw new Error('Failed to generate synthetic 120s sample');
    }
  }
  return out;
}

async function resolveCorpus(): Promise<E2eState['corpus']> {
  const downloadStatusPath = path.join(PHASE10_DIR, 'download-status.json');
  let source: string | undefined;
  if (fs.existsSync(downloadStatusPath)) {
    try {
      const st = JSON.parse(fs.readFileSync(downloadStatusPath, 'utf8')) as {
        source?: string;
      };
      source = st.source;
    } catch {
      /* ignore */
    }
  }

  for (const p of VIDEO_CANDIDATES) {
    if (!fs.existsSync(p) || fs.statSync(p).size < 10_000) continue;
    const { probeVideo } = await import('../lib/video/probe');
    const probe = await probeVideo(p);
    if (probe.duration_ms < 100_000) continue;
    const kind = p.includes('synthetic') ? 'synthetic' : 'tiffany';
    return {
      kind,
      path: p,
      duration_ms: probe.duration_ms,
      width: probe.width,
      height: probe.height,
      has_audio: probe.has_audio,
      source: kind === 'tiffany' ? source ?? 'wikimedia-commons' : 'ffmpeg-lavfi',
      substitution_reason:
        kind === 'synthetic'
          ? 'Public trailer download unavailable; used ≥120s lavfi sample'
          : undefined,
    };
  }

  // Ensure mp4 from ogv if present
  const ogv = path.join(PHASE10_DIR, 'tiffany-trailer.ogv');
  const mp4 = path.join(PHASE10_DIR, 'tiffany-trailer.mp4');
  if (fs.existsSync(ogv) && !fs.existsSync(mp4)) {
    console.log(JSON.stringify({ phase10: 'transcoding_ogv' }));
    const r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i',
        ogv,
        '-vf',
        'scale=-2:720',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        mp4,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      console.error(r.stderr?.slice(-1000));
    }
  }

  if (fs.existsSync(mp4) && fs.statSync(mp4).size > 10_000) {
    const { probeVideo } = await import('../lib/video/probe');
    const probe = await probeVideo(mp4);
    return {
      kind: 'tiffany',
      path: mp4,
      duration_ms: probe.duration_ms,
      width: probe.width,
      height: probe.height,
      has_audio: probe.has_audio,
      source: source ?? 'wikimedia-commons',
    };
  }

  console.log(
    JSON.stringify({
      phase10: 'corpus_fallback',
      reason: 'Tiffany mp4 missing; generating synthetic ≥120s',
    }),
  );
  const synth = ensureSynthetic120s();
  const { probeVideo } = await import('../lib/video/probe');
  const probe = await probeVideo(synth);
  return {
    kind: 'synthetic',
    path: synth,
    duration_ms: probe.duration_ms,
    width: probe.width,
    height: probe.height,
    has_audio: probe.has_audio,
    source: 'ffmpeg-lavfi',
    substitution_reason:
      'Public trailer not ready as mp4; used ≥120s locally generated sample',
  };
}

async function ingestPreset(preset: PresetName): Promise<void> {
  // Apply preset env BEFORE first getConfig() in this process
  const pe = PRESETS[preset];
  process.env.CHUNK_PRESET = pe.CHUNK_PRESET;
  process.env.CHUNK_WINDOW_MS = pe.CHUNK_WINDOW_MS;
  process.env.CHUNK_OVERLAP_MS = pe.CHUNK_OVERLAP_MS;
  process.env.CHUNK_MIN_MS = pe.CHUNK_MIN_MS;

  const { getConfig } = await import('../lib/config');
  const { createIngestJob, loadAssetForVideo } = await import(
    '../lib/ingest/job-store'
  );
  const { prepareJobEstimate, runIngestPipeline } = await import(
    '../lib/ingest/pipeline'
  );
  const { probeVideo } = await import('../lib/video/probe');
  const {
    DEFAULT_CRF_LADDER,
    DEFAULT_RESOLUTION_LADDER,
    chunkingForPreset,
  } = await import('../lib/ingest/variant');
  const { getEsClient } = await import('../lib/es/client');

  const cfg = getConfig();
  let state = readState();
  if (!state) {
    const corpus = await resolveCorpus();
    state = { corpus, variants: {} };
    writeState(state);
  }

  // Copy into originals for stable media_path under MEDIA_ROOT
  const originals = path.resolve(cfg.MEDIA_ROOT, 'originals');
  fs.mkdirSync(originals, { recursive: true });
  const mediaPath = path.join(originals, 'phase10-tiffany.mp4');
  if (!fs.existsSync(mediaPath) || fs.statSync(mediaPath).size < 10_000) {
    fs.copyFileSync(state.corpus.path, mediaPath);
  }

  const probe = await probeVideo(mediaPath);
  const videoId = state.video_id;
  const existing = videoId ? await loadAssetForVideo(videoId) : null;

  const job = createIngestJob({
    mode: 'upload',
    mediaPath,
    probe,
    title:
      state.corpus.kind === 'tiffany'
        ? "Breakfast at Tiffany's trailer (1961 PD)"
        : 'Phase10 synthetic 120s',
    autoStart: true,
    videoId: videoId ?? undefined,
    chunking: chunkingForPreset(preset),
  });

  if (existing?.variants?.length) {
    job.variants = [...existing.variants];
  }

  await prepareJobEstimate(job);
  console.log(
    JSON.stringify({
      phase10: 'ingest_start',
      preset,
      job_id: job.id,
      video_id: job.videoId,
      variant_id: job.variantId,
      workload: job.workload,
    }),
  );

  const t0 = Date.now();
  await runIngestPipeline(job);
  const elapsed = Date.now() - t0;

  // Sample first chunk proxy metadata from ES
  let sample_proxy: E2eState['variants'][string]['sample_proxy'];
  try {
    const client = getEsClient();
    const res = await client.search({
      index: cfg.ES_INDEX_CHUNKS,
      size: 1,
      query: {
        bool: {
          filter: [
            { term: { video_id: job.videoId } },
            { term: { variant_id: job.variantId } },
          ],
        },
      },
      sort: [{ chunk_index: 'asc' }],
      _source: ['video_proxy'],
    });
    const src = res.hits.hits[0]?._source as
      | {
          video_proxy?: {
            width: number;
            height: number;
            crf: number;
            strategy: string;
            bytes: number;
          };
        }
      | undefined;
    if (src?.video_proxy) {
      sample_proxy = {
        width: src.video_proxy.width,
        height: src.video_proxy.height,
        crf: src.video_proxy.crf,
        strategy: src.video_proxy.strategy,
        bytes: src.video_proxy.bytes,
      };
    }
  } catch {
    /* non-fatal */
  }

  state.video_id = job.videoId;
  state.variants[preset] = {
    preset,
    variant_id: job.variantId!,
    windows: job.windowsTotal,
    windows_done: job.windowsDone,
    windows_failed: job.windowsFailed,
    status: job.status,
    elapsed_ms: elapsed,
    throughput: job.throughputWindowsPerMin ?? null,
    encoder_rungs: {
      resolution_ladder: [...DEFAULT_RESOLUTION_LADDER],
      crf_ladder: [...DEFAULT_CRF_LADDER],
    },
    sample_proxy,
  };
  writeState(state);

  console.log(
    JSON.stringify({
      phase10: 'ingest_done',
      preset,
      status: job.status,
      windows_done: job.windowsDone,
      windows_failed: job.windowsFailed,
      elapsed_ms: elapsed,
      variant_id: job.variantId,
      error: job.error ?? null,
    }),
  );

  if (job.status !== 'ready') {
    process.exitCode = 1;
  }
}

async function evaluateSearch(): Promise<void> {
  const state = readState();
  if (!state?.video_id || Object.keys(state.variants).length === 0) {
    throw new Error('Missing e2e-state.json — run ingest first');
  }

  const { searchChunks } = await import('../lib/es/search');
  const { getAsset } = await import('../lib/es/index-assets');
  const { getEsClient } = await import('../lib/es/client');
  const { getConfig } = await import('../lib/config');
  const cfg = getConfig();

  const fixtures =
    state.corpus.kind === 'tiffany' ? TIFFANY_FIXTURES : SYNTHETIC_FIXTURES;

  const asset = await getAsset(state.video_id);
  const coexistence = {
    asset_variant_ids: (asset?.variants ?? []).map((v) => v.variant_id),
    asset_presets: (asset?.variants ?? []).map((v) => ({
      variant_id: v.variant_id,
      chunk_preset: v.chunk_preset,
      chunk_count: v.chunk_count,
      status: v.status,
    })),
    state_variants: Object.keys(state.variants),
  };

  // Count chunks per variant in ES
  const client = getEsClient();
  const chunkCounts: Record<string, number> = {};
  for (const [preset, v] of Object.entries(state.variants)) {
    const res = await client.count({
      index: cfg.ES_INDEX_CHUNKS,
      query: {
        bool: {
          filter: [
            { term: { video_id: state.video_id } },
            { term: { variant_id: v.variant_id } },
          ],
        },
      },
    });
    chunkCounts[preset] = res.count;
  }

  const k = 3;
  const perVariant: Record<string, unknown> = {};

  for (const [preset, v] of Object.entries(state.variants)) {
    const rows = [];
    for (const fx of fixtures) {
      const t0 = Date.now();
      const result = await searchChunks({
        query: fx.query,
        modality: fx.modality,
        variantId: v.variant_id,
        videoId: state.video_id,
        size: k,
      });
      const wall_ms = Date.now() - t0;
      const top = result.hits.slice(0, k);
      const top1_hit = top[0]
        ? overlaps(top[0].start_ms, top[0].end_ms, fx.expected_ranges_ms)
        : false;
      const topk_hit = top.some((h) =>
        overlaps(h.start_ms, h.end_ms, fx.expected_ranges_ms),
      );
      rows.push({
        id: fx.id,
        query: fx.query,
        modality: fx.modality,
        expected_ranges_ms: fx.expected_ranges_ms,
        notes: fx.notes,
        top1_in_range: top1_hit,
        topk_in_range: topk_hit,
        took_ms: result.took_ms,
        wall_ms,
        hits: top.map((h) => ({
          chunk_id: h.chunk_id,
          start_ms: h.start_ms,
          end_ms: h.end_ms,
          start_label: h.start_label,
          end_label: h.end_label,
          score: h.score,
          modality_badge: h.modality_badge,
        })),
      });
    }
    const top1_ok = rows.filter((r) => r.top1_in_range).length;
    const topk_ok = rows.filter((r) => r.topk_in_range).length;
    perVariant[preset] = {
      variant_id: v.variant_id,
      chunk_count_es: chunkCounts[preset],
      top1_success: `${top1_ok}/${rows.length}`,
      topk_success: `${topk_ok}/${rows.length}`,
      fixtures: rows,
    };
  }

  // Cross-variant isolation: search fine variant_id must not return standard chunks
  let isolation: unknown = null;
  if (state.variants.standard && state.variants.fine) {
    const fineRes = await searchChunks({
      query: fixtures[0]!.query,
      modality: 'visual',
      variantId: state.variants.fine.variant_id,
      videoId: state.video_id,
      size: 10,
    });
    const leaked = fineRes.hits.filter(
      (h) => h.variant_id !== state.variants.fine!.variant_id,
    );
    isolation = {
      ok: leaked.length === 0,
      fine_hit_count: fineRes.hits.length,
      leaked_count: leaked.length,
    };
  }

  const results = {
    phase10: 'eval',
    corpus: state.corpus,
    video_id: state.video_id,
    coexistence,
    chunk_counts: chunkCounts,
    isolation,
    search: perVariant,
    note: 'Same-corpus metrics only; not compared to Elastic published scores',
  };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

async function verifyMediaRange(): Promise<unknown> {
  const state = readState();
  if (!state?.video_id) throw new Error('No video_id in state');

  // Prefer Next route if server up; else call serveFileWithRange directly
  const { getAsset } = await import('../lib/es/index-assets');
  const { serveFileWithRange } = await import('../lib/media/serve-file');
  const asset = await getAsset(state.video_id);
  if (!asset) throw new Error('Asset not found');
  const filePath = asset.playback_path || asset.media_path;
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'media_path_missing', filePath };
  }

  // Simulate seek ~ halfway (click-to-play path at API level)
  const size = fs.statSync(filePath).size;
  const start = Math.floor(size * 0.35);
  const end = Math.min(size - 1, start + 64 * 1024 - 1);
  const req = new Request('http://local/media', {
    headers: { Range: `bytes=${start}-${end}` },
  });
  const res = await serveFileWithRange(filePath, req, {
    cacheControl: 'private, max-age=86400',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const contentRange = res.headers.get('content-range');
  const ok =
    res.status === 206 &&
    buf.length > 0 &&
    Boolean(contentRange?.includes(`${start}-`));

  // Also try HTTP if a local server is listening
  let http: unknown = null;
  for (const port of [3000, 3456, 3457]) {
    try {
      const url = `http://127.0.0.1:${port}/api/media/${encodeURIComponent(state.video_id)}`;
      const hr = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(3000),
      });
      http = {
        port,
        status: hr.status,
        content_range: hr.headers.get('content-range'),
        bytes: (await hr.arrayBuffer()).byteLength,
      };
      if (hr.status === 206) break;
    } catch {
      /* try next */
    }
  }

  return {
    ok,
    status: res.status,
    content_range: contentRange,
    bytes_returned: buf.length,
    seek_byte_start: start,
    http_probe: http,
  };
}

async function verifyImportModes(): Promise<unknown> {
  const state = readState();
  const corpusPath = state?.corpus.path ?? VIDEO_CANDIDATES.find(fs.existsSync);
  if (!corpusPath || !fs.existsSync(corpusPath)) {
    return { upload: { ok: false, reason: 'no_corpus' }, url: { skipped: true } };
  }

  // Upload-mode path: reuse importFromUploadStream without full re-embed
  const { getConfig } = await import('../lib/config');
  const { importFromUploadStream, importFromUrl } = await import(
    '../lib/ingest/sources'
  );
  const cfg = getConfig();

  const uploadOut: Record<string, unknown> = {};
  try {
    const stream = fs.createReadStream(corpusPath);
    // Only copy a short probe-sized file for mode check — use synthetic tiny if tiffany huge
    const tiny = path.join(PHASE10_DIR, 'import-mode-tiny.mp4');
    if (!fs.existsSync(tiny)) {
      spawnSync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=320x240:rate=1',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=16000',
          '-t',
          '3',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-shortest',
          tiny,
        ],
        { encoding: 'utf8' },
      );
    }
    const rs = fs.createReadStream(tiny);
    const result = await importFromUploadStream(rs, 'import-mode-tiny.mp4', cfg);
    uploadOut.ok = true;
    uploadOut.media_under_uploads = result.mediaPath.includes(
      `${path.sep}uploads${path.sep}`,
    );
    uploadOut.duration_ms = result.probe.duration_ms;
  } catch (err) {
    uploadOut.ok = false;
    uploadOut.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }

  // URL mode: try Wikimedia (same PD trailer) with auto path — may be slow; use HEAD+short timeout via import
  // Prefer a tiny public test media if available; else attempt URL import of commons with size limit awareness
  const urlOut: Record<string, unknown> = {};
  try {
    // Use a small public-domain sample from Wikimedia if possible (short clip)
    // Fall back to documenting SSRF-safe URL path with existing tiny hosted via file:// is NOT allowed.
    // We call importFromUrl against commons Special:FilePath — may download 58MB; skip if MAX too small.
    // Instead: verify URL sanitize + that importFromUrl rejects bad hosts, and optionally fetch a small mp4.
    const smallUrl =
      'https://upload.wikimedia.org/wikipedia/commons/transcoded/0/0b/Breakfast-at-tiffany-s-official%C2%AE-trailer-hd.ogv/Breakfast-at-tiffany-s-official%C2%AE-trailer-hd.ogv.240p.vp9.webm';
    // Bounded: only run URL import if PHASE10_URL_IMPORT=1
    if (process.env.PHASE10_URL_IMPORT === '1') {
      const result = await importFromUrl(smallUrl, cfg);
      urlOut.ok = true;
      urlOut.duration_ms = result.probe.duration_ms;
      urlOut.provenance = result.provenance;
    } else {
      // Lightweight: sanitize + SSRF check path only
      const { sanitizeUrlProvenance } = await import('../lib/ingest/url-sanitize');
      const prov = sanitizeUrlProvenance(
        'https://commons.wikimedia.org/wiki/Special:FilePath/Breakfast-at-tiffany-s-official%C2%AE-trailer-hd.ogv',
      );
      urlOut.ok = true;
      urlOut.mode = 'sanitize_only';
      urlOut.provenance = prov;
      urlOut.note =
        'Full URL download skipped (set PHASE10_URL_IMPORT=1); sanitize/provenance verified';
    }
  } catch (err) {
    urlOut.ok = false;
    urlOut.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }

  return { upload: uploadOut, url: urlOut };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ingestOnly = args.includes('--ingest-only')
    ? (args[args.indexOf('--ingest-only') + 1] as PresetName | undefined)
    : undefined;
  const evalOnly = args.includes('--eval-only');
  const importOnly = args.includes('--import-modes');
  const rangeOnly = args.includes('--range-only');

  if (ingestOnly === 'standard' || ingestOnly === 'fine') {
    await ingestPreset(ingestOnly);
    return;
  }

  if (evalOnly) {
    await evaluateSearch();
    const range = await verifyMediaRange();
    console.log(JSON.stringify({ phase10: 'range', ...((range as object) || {}) }));
    return;
  }

  if (importOnly) {
    const modes = await verifyImportModes();
    console.log(JSON.stringify({ phase10: 'import_modes', ...modes }, null, 2));
    return;
  }

  if (rangeOnly) {
    const range = await verifyMediaRange();
    console.log(JSON.stringify({ phase10: 'range', range }, null, 2));
    return;
  }

  // Default orchestration: corpus → standard (subprocess) → fine (subprocess) → eval → range → import
  const corpus = await resolveCorpus();
  writeState({ corpus, variants: readState()?.variants ?? {}, video_id: readState()?.video_id });
  console.log(JSON.stringify({ phase10: 'corpus', corpus }, null, 2));

  for (const preset of ['standard', 'fine'] as PresetName[]) {
    console.log(JSON.stringify({ phase10: 'spawn_ingest', preset }));
    const r = spawnSync(
      process.execPath,
      [
        ...(process.env.npm_execpath?.includes('yarn') ? [] : []),
        require.resolve('tsx/cli'),
        path.join('scripts', 'phase10-e2e.ts'),
        '--ingest-only',
        preset,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, ...PRESETS[preset] },
        cwd: process.cwd(),
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) {
      console.error(JSON.stringify({ phase10: 'ingest_failed', preset, status: r.status }));
      process.exitCode = 1;
      // Continue to fine only if standard somehow partial — still try fine for coexistence
    }
  }

  await evaluateSearch();
  const range = await verifyMediaRange();
  const modes = await verifyImportModes();
  const finalPath = path.join(PHASE10_DIR, 'e2e-final.json');
  const final = {
    state: readState(),
    results: fs.existsSync(RESULTS_PATH)
      ? JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'))
      : null,
    range,
    import_modes: modes,
  };
  fs.writeFileSync(finalPath, JSON.stringify(final, null, 2));
  console.log(JSON.stringify({ phase10: 'complete', final_path: finalPath, range, import_modes: modes }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
