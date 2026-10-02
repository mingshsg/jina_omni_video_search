import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VideoAssetDocument } from '../es/index-assets';
import type { DramaMetaPayload } from './persist-meta';
import { referencedDramaRunIds, sweepTrimmedDramaRuns } from './trimmed-run-gc';

const HOUR = 60 * 60 * 1000;
let mediaRoot: string;

function runDir(videoId: string, runId: string): string {
  return path.join(mediaRoot, 'media', videoId, 'drama', runId);
}

function makeRun(videoId: string, runId: string, ageMs = 2 * HOUR): string {
  const dir = runDir(videoId, runId);
  fs.mkdirSync(path.join(dir, 'subtitles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'subtitles', 'en.srt'), 'abc');
  const at = new Date(Date.now() - ageMs);
  for (const p of [path.join(dir, 'subtitles', 'en.srt'), path.join(dir, 'subtitles'), dir]) {
    fs.utimesSync(p, at, at);
  }
  return dir;
}

function run(runId: string, status = 'succeeded'): Omit<DramaMetaPayload, 'runs'> {
  return {
    run_id: runId,
    enrichment_status: status as DramaMetaPayload['enrichment_status'],
    modules: ['subtitles'],
    languages: ['en'],
  };
}

function asset(
  drama: DramaMetaPayload | undefined,
  jobDrama?: { status: string; run_id?: string },
): VideoAssetDocument {
  return {
    video_id: 'v1',
    meta: { revision: 1, updated_at: '', ...(drama ? { drama } : {}) },
    job: {
      job_id: 'j1',
      stage: 'ready',
      progress_pct: 100,
      windows_total: 0,
      windows_done: 0,
      updated_at: '',
      ...(jobDrama ? { drama: { languages: [], modules: [], ...jobDrama } } : {}),
    },
  } as unknown as VideoAssetDocument;
}

beforeEach(() => {
  mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trimmed-run-gc-'));
});

afterEach(() => {
  fs.rmSync(mediaRoot, { recursive: true, force: true });
});

describe('referencedDramaRunIds', () => {
  it('collects the current run, retained history, and the job record', () => {
    const ids = referencedDramaRunIds(
      asset({ ...run('cur'), runs: [run('h1'), run('h2')] }, { status: 'succeeded', run_id: 'job' }),
    );
    expect([...ids].sort()).toEqual(['cur', 'h1', 'h2', 'job']);
  });
});

describe('sweepTrimmedDramaRuns', () => {
  it('reports an unreferenced run without deleting it by default', async () => {
    makeRun('v1', 'cur');
    makeRun('v1', 'h1');
    const trimmed = makeRun('v1', 'old');
    const result = await sweepTrimmedDramaRuns({
      mediaRoot,
      getAsset: async () => asset({ ...run('cur'), runs: [run('h1')] }),
      minAgeMs: HOUR,
    });
    expect(result.applied).toBe(false);
    expect(result.candidates).toEqual([{ videoId: 'v1', runId: 'old', bytes: 3 }]);
    expect(result.deleted).toBe(0);
    expect(fs.existsSync(trimmed)).toBe(true);
  });

  it('deletes only unreferenced runs when applied', async () => {
    const cur = makeRun('v1', 'cur');
    const kept = makeRun('v1', 'h1');
    const trimmed = makeRun('v1', 'old');
    const result = await sweepTrimmedDramaRuns({
      mediaRoot,
      getAsset: async () => asset({ ...run('cur'), runs: [run('h1')] }),
      minAgeMs: HOUR,
      apply: true,
    });
    expect(result.deleted).toBe(1);
    expect(result.freedBytes).toBe(3);
    expect(fs.existsSync(trimmed)).toBe(false);
    expect(fs.existsSync(cur)).toBe(true);
    expect(fs.existsSync(kept)).toBe(true);
  });

  it('skips videos with a missing asset or an active run', async () => {
    const missing = makeRun('gone', 'old');
    const busy = makeRun('busy', 'old');
    const jobBusy = makeRun('jobbusy', 'old');
    const assets: Record<string, VideoAssetDocument | null> = {
      gone: null,
      busy: asset(run('cur', 'running')),
      jobbusy: asset(run('cur'), { status: 'pending', run_id: 'next' }),
    };
    const result = await sweepTrimmedDramaRuns({
      mediaRoot,
      getAsset: async (videoId) => assets[videoId] ?? null,
      minAgeMs: HOUR,
      apply: true,
    });
    expect(result.skipped).toEqual([
      { videoId: 'busy', reason: 'run_active' },
      { videoId: 'gone', reason: 'asset_missing' },
      { videoId: 'jobbusy', reason: 'run_active' },
    ]);
    expect(result.deleted).toBe(0);
    for (const dir of [missing, busy, jobBusy]) expect(fs.existsSync(dir)).toBe(true);
  });

  it('keeps an unreferenced run that is newer than the age guard', async () => {
    makeRun('v1', 'cur');
    const fresh = makeRun('v1', 'fresh', 0);
    const result = await sweepTrimmedDramaRuns({
      mediaRoot,
      getAsset: async () => asset(run('cur')),
      minAgeMs: HOUR,
      apply: true,
    });
    expect(result.candidates).toEqual([]);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('keeps an old run directory that has a recently written nested file', async () => {
    makeRun('v1', 'cur');
    const active = makeRun('v1', 'active');
    fs.mkdirSync(path.join(active, 'frames'));
    fs.writeFileSync(path.join(active, 'frames', 't_0001s.jpg'), 'x');
    const old = new Date(Date.now() - 2 * HOUR);
    fs.utimesSync(active, old, old);
    const result = await sweepTrimmedDramaRuns({
      mediaRoot,
      getAsset: async () => asset(run('cur')),
      minAgeMs: HOUR,
      apply: true,
    });
    expect(result.candidates).toEqual([]);
    expect(fs.existsSync(active)).toBe(true);
  });

  it('G1 regression: treats a file that vanishes mid-scan as unknown, not as nothing newer', async () => {
    makeRun('v1', 'cur');
    const active = makeRun('v1', 'active'); // 2h old — would otherwise qualify
    const vanished = path.join(active, 'subtitles', 'en.srt');
    const realStatSync = fs.statSync;
    const statSyncSpy = vi
      .spyOn(fs, 'statSync')
      .mockImplementation(((
        p: Parameters<typeof fs.statSync>[0],
        opts?: Parameters<typeof fs.statSync>[1],
      ) => {
        if (String(p) === vanished) {
          const err = new Error('ENOENT: no such file or directory');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          throw err;
        }
        return realStatSync(p, opts as never);
      }) as typeof fs.statSync);
    try {
      const result = await sweepTrimmedDramaRuns({
        mediaRoot,
        getAsset: async () => asset(run('cur')),
        minAgeMs: HOUR,
        apply: true,
      });
      expect(result.candidates).toEqual([]);
      expect(result.skipped).toEqual([
        { videoId: 'v1', runId: 'active', reason: 'scan_error' },
      ]);
      expect(fs.existsSync(active)).toBe(true);
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it('G1 regression: treats an unreadable subdirectory as unknown, not as nothing newer', async () => {
    if (process.getuid?.() === 0) return; // root bypasses permission bits
    makeRun('v1', 'cur');
    const active = makeRun('v1', 'active', 2 * HOUR);
    const workDir = path.join(active, 'work');
    fs.mkdirSync(workDir);
    fs.writeFileSync(path.join(workDir, 'transcript.part'), 'x');
    fs.chmodSync(workDir, 0o000);
    try {
      const result = await sweepTrimmedDramaRuns({
        mediaRoot,
        getAsset: async () => asset(run('cur')),
        minAgeMs: HOUR,
        apply: true,
      });
      expect(result.candidates).toEqual([]);
      expect(result.skipped).toEqual([
        { videoId: 'v1', runId: 'active', reason: 'scan_error' },
      ]);
      expect(fs.existsSync(active)).toBe(true);
    } finally {
      fs.chmodSync(workDir, 0o755);
    }
  });

  it('stops at the candidate cap', async () => {
    makeRun('v1', 'cur');
    makeRun('v1', 'a');
    makeRun('v1', 'b');
    const result = await sweepTrimmedDramaRuns({
      mediaRoot,
      getAsset: async () => asset(run('cur')),
      minAgeMs: HOUR,
      apply: true,
      maxRuns: 1,
    });
    expect(result.deleted).toBe(1);
    expect(result.stoppedEarly).toBe(true);
  });
});
