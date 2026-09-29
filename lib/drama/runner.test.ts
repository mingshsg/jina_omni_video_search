import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IngestJob } from '../ingest/job-store';
import type { DramaJobState } from '../ingest/drama-options';

vi.mock('../ingest/job-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ingest/job-store')>();
  return {
    ...actual,
    updateJob: vi.fn(async (job: IngestJob, patch: Partial<IngestJob>) => {
      Object.assign(job, patch);
    }),
  };
});

vi.mock('./workspace', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./workspace')>();
  const ws = (runId: string) => ({
    runId,
    rootDir: '/tmp/drama-test',
    audioDir: '/tmp/drama-test/audio',
    subtitlesDir: '/tmp/drama-test/subtitles',
    metaPath: '/tmp/drama-test/meta.json',
    structurePath: '/tmp/drama-test/structure.json',
  });
  return {
    ...actual,
    createDramaWorkspace: () => ws('testrun'),
    openDramaWorkspace: (_videoId: string, runId: string) => ws(runId),
    writeDramaJson: vi.fn(),
  };
});

vi.mock('./structure', () => ({
  proposeStructure: vi.fn(async () => [
    {
      kind: 'opening_credits',
      start_ms: 0,
      end_ms: 30_000,
      confidence: 0.35,
      source: 'heuristic',
    },
    {
      kind: 'body',
      start_ms: 30_000,
      end_ms: 90_000,
      confidence: 0.5,
      source: 'heuristic',
    },
    {
      kind: 'ending_credits',
      start_ms: 90_000,
      end_ms: 120_000,
      confidence: 0.35,
      source: 'heuristic',
    },
  ]),
}));

vi.mock('./resolve-subtitles', () => ({
  resolveSubtitlesForLanguage: vi.fn(async () => {
    throw new Error('ASR not configured');
  }),
}));

vi.mock('./index-subtitles', () => ({
  indexDramaSubtitles: vi.fn(),
  reconcileSubtitleLang: vi.fn(async () => ({ deleted: 0 })),
  retireOldSubtitleGenerations: vi.fn(async () => ({ deleted: 0 })),
}));

vi.mock('./persist-meta', () => ({
  persistDramaMeta: vi.fn(async () => undefined),
}));

vi.mock('./directors-script', () => ({
  generateDirectorsScript: vi.fn(async () => ({
    scriptZhPath: 'scripts/directors_script_zh.md',
    scriptEnPath: 'scripts/directors_script_en.md',
    scriptRawPath: 'scripts/directors_script_bilingual_raw.md',
    synopsisZh: '宫廷故事。',
    synopsisEn: 'A palace story.',
    sceneCount: 2,
    windowsDone: 1,
    windowsPlanned: 1,
    coverageStartSec: 0,
    coverageEndSec: 120,
    coverageSec: 120,
    coverageRanges: [{ t0: 0, t1: 120 }],
    coverageGaps: [],
    usageTotal: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      calls: 1,
    },
    audit: { status: 'skipped', detail: 'DRAMA_EIS_AUDIT_INFERENCE_ID unset' },
  })),
}));

vi.mock('./key-actors', () => ({
  generateKeyActors: vi.fn(async () => ({
    actors: [{ role_zh: '甄嬛', verified: false, t_ms: 120_000 }],
    facesDir: '/tmp/drama-test/faces',
    proposalsPath: '/tmp/drama-test/faces/proposals.json',
    verifyPath: '/tmp/drama-test/faces/verify_log.json',
  })),
}));

vi.mock('./key-scenes', () => ({
  extractKeyScenes: vi.fn(async () => ({
    scenes: [{ start_ms: 60_000, end_ms: 90_000, thumb_path: 'scenes/s.jpg' }],
    thumbsDir: '/tmp/drama-test/scenes',
    scenesPath: '/tmp/drama-test/key_scenes.json',
  })),
}));

vi.mock('./frame-gc', () => ({
  cleanupDramaFrames: vi.fn(() => ({
    scanned: 1,
    deleted: 1,
    freedBytes: 1024,
    kept: [],
  })),
}));

import {
  clearDramaRunLeases,
  isDramaRunActive,
  prepareDramaHandoff,
  releaseDramaRun,
  runDramaEnrichment,
  tryAcquireDramaRun,
} from './runner';
import { persistDramaMeta } from './persist-meta';
import { generateDirectorsScript } from './directors-script';
import {
  indexDramaSubtitles,
  reconcileSubtitleLang,
  retireOldSubtitleGenerations,
} from './index-subtitles';
import { resolveSubtitlesForLanguage } from './resolve-subtitles';
import { proposeStructure } from './structure';
import { generateKeyActors } from './key-actors';
import { extractKeyScenes } from './key-scenes';
import { cleanupDramaFrames } from './frame-gc';

function fakeJob(
  drama: Omit<DramaJobState, 'subtitleSource' | 'directorCoverage'> &
    Partial<Pick<DramaJobState, 'subtitleSource' | 'directorCoverage'>>,
): IngestJob {
  return {
    id: 'job1',
    videoId: 'vid1',
    mode: 'upload',
    status: 'ready',
    stage: 'complete',
    mediaPath: '/tmp/video.mp4',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: 'test',
    probe: {
      duration_ms: 120_000,
      width: 1280,
      height: 720,
      fps: 24,
      has_audio: true,
      size_bytes: 1,
      container: 'mp4',
      video_codec: 'h264',
    },
    windowsTotal: 1,
    windowsDone: 1,
    windowsFailed: 0,
    progressPct: 100,
    windowErrors: [],
    variants: [],
    autoStart: true,
    chunking: {
      preset: '2s',
      windowMs: 2000,
      overlapMs: 1000,
      minMs: 1000,
    },
    pipelineRunning: false,
    drama: {
      // P4: older in-memory jobs default to the resolver defaults.
      subtitleSource: 'auto',
      directorCoverage: 'sampled',
      ...drama,
    },
  } as IngestJob;
}

describe('runDramaEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDramaRunLeases();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['existing_only', 'force_asr'] as const)(
    'persists the selected Library policy at handoff and completion (%s)',
    async (subtitleSource) => {
      const job = fakeJob({
        status: 'pending',
        languages: ['zh'],
        modules: ['subtitles'],
        modules_done: [],
        subtitleSource,
      });
      await prepareDramaHandoff(job);
      expect(persistDramaMeta).toHaveBeenLastCalledWith(
        'vid1',
        expect.objectContaining({
          enrichment_status: 'running',
          subtitle_source: subtitleSource,
          director_coverage: 'sampled',
        }),
      );
      await runDramaEnrichment(job);
      expect(persistDramaMeta).toHaveBeenLastCalledWith(
        'vid1',
        expect.objectContaining({
          subtitle_source: subtitleSource,
          director_coverage: 'sampled',
        }),
      );
    },
  );

  it('runs structure and persists meta.drama even if subtitles fail', async () => {
    const job = fakeJob({
      status: 'pending',
      languages: ['zh'],
      modules: ['structure', 'subtitles'],
      modules_done: [],
    });
    await runDramaEnrichment(job);
    expect(proposeStructure).toHaveBeenCalled();
    expect(persistDramaMeta).toHaveBeenCalled();
    const calls = vi.mocked(persistDramaMeta).mock.calls;
    // First call is the best-effort running marker (R7); last is terminal.
    expect(calls[0][1].enrichment_status).toBe('running');
    const payload = calls[calls.length - 1][1];
    expect(payload.modules_done).toContain('structure');
    expect(payload.enrichment_status).toBe('partial');
    expect(job.drama?.status).toBe('partial');
    expect(job.drama?.error?.message).toMatch(/subtitles/);
  });

  it('passes the per-run subtitleSource into subtitle resolution', async () => {
    vi.mocked(resolveSubtitlesForLanguage).mockImplementation(async (opts: {
      lang: string;
    }) => {
      if (opts.lang !== 'zh') throw new Error('ASR not configured');
      return {
        lang: 'zh',
        srtPath: '/tmp/zh.srt',
        cues: [{ index: 1, startMs: 0, endMs: 1000, text: 'x' }],
        origin: 'sidecar',
      } as never;
    });
    vi.mocked(indexDramaSubtitles).mockResolvedValue({
      indexed: 1,
      embedded: 1,
      ids: ['vid1_testrun_zh_1_0'],
      segIds: ['zh_1_0'],
    });
    const job = fakeJob({
      status: 'pending',
      languages: ['zh'],
      modules: ['subtitles'],
      modules_done: [],
      subtitleSource: 'existing_only',
    });
    await runDramaEnrichment(job);
    expect(resolveSubtitlesForLanguage).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: 'zh',
        subtitleSource: 'existing_only',
      }),
    );
  });

  it('no-ops when drama already succeeded', async () => {
    const job = fakeJob({
      status: 'succeeded',
      languages: [],
      modules: ['structure'],
      modules_done: ['structure'],
    });
    await runDramaEnrichment(job);
    expect(proposeStructure).not.toHaveBeenCalled();
  });

  it('retries when drama is partial (failed module remains retryable)', async () => {
    const job = fakeJob({
      status: 'partial',
      languages: [],
      modules: ['structure'],
      modules_done: [],
    });
    await runDramaEnrichment(job);
    expect(proposeStructure).toHaveBeenCalled();
    expect(job.drama?.status).toBe('succeeded');
  });

  it('runs key_actors + key_scenes + GC when selected', async () => {
    const job = fakeJob({
      status: 'pending',
      languages: [],
      modules: ['key_actors', 'key_scenes', 'structure'],
      modules_done: [],
    });
    await runDramaEnrichment(job);
    expect(generateKeyActors).toHaveBeenCalled();
    expect(extractKeyScenes).toHaveBeenCalled();
    expect(cleanupDramaFrames).toHaveBeenCalled();
    const calls = vi.mocked(persistDramaMeta).mock.calls;
    const payload = calls[calls.length - 1][1];
    expect(payload.enrichment_status).toBe('succeeded');
    expect(payload.key_actors).toBeDefined();
    expect(payload.key_actors?.[0].role_zh).toBe('甄嬛');
    expect(payload.key_scenes).toBeDefined();
    expect(payload.key_scenes?.[0].thumb_path).toBe('scenes/s.jpg');
    expect(job.drama?.modules_done).toEqual(
      expect.arrayContaining(['key_actors', 'key_scenes', 'structure']),
    );
  });

  it('reuses the stable run_id across sequential retries (no duplicate docs)', async () => {
    const job = fakeJob({
      status: 'partial',
      languages: [],
      modules: ['structure'],
      modules_done: [],
      run_id: 'runAAA',
    });
    await runDramaEnrichment(job);
    const first = vi.mocked(persistDramaMeta).mock.calls;
    const firstTerminal = first[first.length - 1][1];
    expect(firstTerminal.run_id).toBe('runAAA');
    expect(job.drama?.run_id).toBe('runAAA');

    // Simulate a second retry on the same (partial) job state.
    job.drama!.status = 'partial';
    job.drama!.modules_done = [];
    vi.clearAllMocks();
    await runDramaEnrichment(job);
    const second = vi.mocked(persistDramaMeta).mock.calls;
    const secondTerminal = second[second.length - 1][1];
    expect(secondTerminal.run_id).toBe('runAAA');
  });

  it('does not overlap a concurrent run on the same video', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(proposeStructure).mockImplementationOnce(() => gate.then(() => [
      {
        kind: 'body',
        start_ms: 0,
        end_ms: 120_000,
        confidence: 0.5,
        source: 'heuristic',
      },
    ]) as never);
    const job = fakeJob({
      status: 'pending',
      languages: [],
      modules: ['structure'],
      modules_done: [],
    });
    const first = runDramaEnrichment(job);
    // Second concurrent invocation must return without running modules.
    await runDramaEnrichment(job);
    // Let the first invocation advance past its awaits to the module.
    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(proposeStructure).mock.calls).toHaveLength(1);
    release();
    await first;
    expect(job.drama?.status).toBe('succeeded');
    expect(isDramaRunActive(job.videoId)).toBe(false);
  });
});

describe('drama run lease', () => {  beforeEach(() => {
    clearDramaRunLeases();
  });

  it('is held per video and not reentrant', () => {
    expect(tryAcquireDramaRun('vid1', 'jobA')).toBe(true);
    expect(isDramaRunActive('vid1')).toBe(true);
    expect(tryAcquireDramaRun('vid1', 'jobB')).toBe(false);
    expect(tryAcquireDramaRun('vid1', 'jobA')).toBe(false);
    releaseDramaRun('vid1', 'jobB');
    expect(isDramaRunActive('vid1')).toBe(true);
    releaseDramaRun('vid1', 'jobA');
    expect(isDramaRunActive('vid1')).toBe(false);
  });
});

describe('prepareDramaHandoff (F3)', () => {  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the running marker and assigns the run id', async () => {
    const job = fakeJob({
      status: 'pending',
      languages: ['zh'],
      modules: ['structure'],
      modules_done: [],
    });
    const ws = await prepareDramaHandoff(job);
    expect(ws.runId).toBe('testrun');
    expect(job.drama?.status).toBe('running');
    expect(job.drama?.run_id).toBe('testrun');
    expect(persistDramaMeta).toHaveBeenCalledTimes(1);
    expect(vi.mocked(persistDramaMeta).mock.calls[0][1]).toMatchObject({
      run_id: 'testrun',
      enrichment_status: 'running',
    });
  });

  it('reuses an existing stable run id', async () => {
    const job = fakeJob({
      status: 'pending',
      languages: [],
      modules: ['structure'],
      modules_done: [],
      run_id: 'runAAA',
    });
    const ws = await prepareDramaHandoff(job);
    expect(ws.runId).toBe('runAAA');
  });

  it('throws visibly when the marker write fails', async () => {
    vi.mocked(persistDramaMeta).mockRejectedValueOnce(new Error('ES down'));
    const job = fakeJob({
      status: 'pending',
      languages: [],
      modules: ['structure'],
      modules_done: [],
    });
    await expect(prepareDramaHandoff(job)).rejects.toThrow(/handoff marker failed/i);
  });
});

describe('synopsis_status evidence gate (F2)', () => {  beforeEach(() => {
    vi.clearAllMocks();
    clearDramaRunLeases();
  });

  function directorsJob() {
    return fakeJob({
      status: 'pending',
      languages: [],
      modules: ['directors_script'],
      modules_done: [],
    });
  }

  function terminalPayload() {
    const calls = vi.mocked(persistDramaMeta).mock.calls;
    return calls[calls.length - 1][1];
  }

  it('marks synopsis provisional when the audit is skipped', async () => {
    vi.mocked(generateDirectorsScript).mockResolvedValueOnce({
      scriptZhPath: 'scripts/zh.md',
      scriptEnPath: 'scripts/en.md',
      scriptRawPath: 'scripts/raw.md',
      synopsisZh: '宫廷故事。',
      synopsisEn: 'A palace story.',
      sceneCount: 1,
      windowsDone: 1,
      windowsPlanned: 1,
      coverageStartSec: 0,
      coverageEndSec: 120,
      coverageSec: 120,
      coverageRanges: [{ t0: 0, t1: 120 }],
      coverageGaps: [],
      usageTotal: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 },
      audit: { status: 'skipped', detail: 'unset' },
    });
    await runDramaEnrichment(directorsJob());
    const payload = terminalPayload();
    expect(payload.modules_done).toContain('directors_script');
    expect(payload.enrichment_status).toBe('succeeded');
    expect(payload.synopsis_zh).toBe('宫廷故事。');
    expect(payload.synopsis_status).toBe('provisional');
  });

  it('marks synopsis audited only on a supported verdict', async () => {
    vi.mocked(generateDirectorsScript).mockResolvedValueOnce({
      scriptZhPath: 'scripts/zh.md',
      scriptEnPath: 'scripts/en.md',
      scriptRawPath: 'scripts/raw.md',
      synopsisZh: '宫廷故事。',
      synopsisEn: 'A palace story.',
      sceneCount: 1,
      windowsDone: 1,
      windowsPlanned: 1,
      coverageStartSec: 0,
      coverageEndSec: 120,
      coverageSec: 120,
      coverageRanges: [{ t0: 0, t1: 120 }],
      coverageGaps: [],
      usageTotal: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 },
      audit: { status: 'ok', verdict: 'supported', detail: 'VERDICT: supported' },
    });
    await runDramaEnrichment(directorsJob());
    expect(terminalPayload().synopsis_status).toBe('audited');
  });
});

describe('subtitle generation switching (I2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDramaRunLeases();
  });

  it('reconciles and switches only the succeeded language', async () => {
    vi.mocked(resolveSubtitlesForLanguage).mockImplementation(async (opts: {
      lang: string;
    }) => {
      if (opts.lang !== 'zh') throw new Error('ASR not configured');
      return {
        lang: 'zh',
        srtPath: '/tmp/zh.srt',
        cues: [{ index: 1, startMs: 0, endMs: 1000, text: 'x' }],
        origin: 'sidecar',
      } as never;
    });
    vi.mocked(indexDramaSubtitles).mockResolvedValue({
      indexed: 1,
      embedded: 1,
      ids: ['vid1_testrun_zh_1_0'],
      segIds: ['zh_1_0'],
    });
    const job = fakeJob({
      status: 'pending',
      languages: ['zh', 'en'],
      modules: ['subtitles'],
      modules_done: [],
    });
    await runDramaEnrichment(job);
    // Same-run shrink cleanup + generation switch for zh only.
    expect(vi.mocked(reconcileSubtitleLang).mock.calls).toEqual([
      [
        {
          videoId: 'vid1',
          runId: 'testrun',
          lang: 'zh',
          keepSegIds: ['zh_1_0'],
        },
      ],
    ]);
    expect(vi.mocked(retireOldSubtitleGenerations).mock.calls).toEqual([
      [{ videoId: 'vid1', keepRunId: 'testrun', lang: 'zh' }],
    ]);
    // en failed: its previous generation is never touched.
    expect(
      vi.mocked(retireOldSubtitleGenerations).mock.calls.some(
        (c) => (c[0] as { lang?: string }).lang === 'en',
      ),
    ).toBe(false);
    const termCalls = vi.mocked(persistDramaMeta).mock.calls;
    const payload = termCalls[termCalls.length - 1][1];
    expect(payload.modules_done).toContain('subtitles');
    expect(payload.enrichment_status).toBe('partial');
  });
});
