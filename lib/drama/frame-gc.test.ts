import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-gc-'));

vi.mock('../config', () => ({
  getConfig: () => ({ MEDIA_ROOT: tmpRoot }),
}));

vi.mock('./env', () => ({
  getDramaEnv: () => ({ DRAMA_GC_MIN_AGE_MS: 60 * 60 * 1000 }),
}));

import { cleanupDramaFrames, sweepAgedDramaOrphans } from './frame-gc';
function touch(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
}

describe('cleanupDramaFrames', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('deletes disposable frames dir but keeps scripts + faces thumbs', () => {
    const runDir = path.join(tmpRoot, 'media', 'vid1', 'drama', 'run1');
    touch(path.join(runDir, 'frames', 't_0001s.jpg'));
    touch(path.join(runDir, 'frames', 't_0002s.jpg'));
    touch(path.join(runDir, 'scripts', 'directors_script_zh.md'));
    touch(path.join(runDir, 'faces', 'cand_0123s.jpg'));
    touch(path.join(runDir, 'meta.json'));

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(runDir, old, old);

    const res = cleanupDramaFrames({ videoId: 'vid1', runId: 'run1' });
    expect(res.deleted).toBe(1);
    expect(fs.existsSync(path.join(runDir, 'frames'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'scripts', 'directors_script_zh.md'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(runDir, 'faces', 'cand_0123s.jpg'))).toBe(true);
    expect(res.kept).toEqual([]);
  });

  it('skips fresh runs (age guard)', () => {
    const runDir = path.join(tmpRoot, 'media', 'vid1', 'drama', 'run2');
    touch(path.join(runDir, 'frames', 't_0001s.jpg'));
    const res = cleanupDramaFrames({ videoId: 'vid1', runId: 'run2' });
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(path.join(runDir, 'frames', 't_0001s.jpg'))).toBe(true);
  });

  it('bypasses the age guard for the caller\u2019s own finished run (F7)', () => {
    const runDir = path.join(tmpRoot, 'media', 'vid1', 'drama', 'run3');
    touch(path.join(runDir, 'frames', 't_0001s.jpg'));
    touch(path.join(runDir, 'scripts', 'directors_script_zh.md'));
    const res = cleanupDramaFrames({
      videoId: 'vid1',
      runId: 'run3',
      ignoreAgeGuard: true,
    });
    expect(res.deleted).toBe(1);
    expect(fs.existsSync(path.join(runDir, 'frames'))).toBe(false);
    expect(
      fs.existsSync(path.join(runDir, 'scripts', 'directors_script_zh.md')),
    ).toBe(true);
  });

  it('no-ops when the run root is missing', () => {
    const res = cleanupDramaFrames({ videoId: 'missing', runId: 'runX' });
    expect(res.deleted).toBe(0);
    expect(res.scanned).toBe(0);
  });
});

describe('sweepAgedDramaOrphans (I7)', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('deletes aged disposable dirs, keeps fresh runs and scripts', () => {
    const oldRun = path.join(tmpRoot, 'media', 'vidA', 'drama', 'old1');
    const freshRun = path.join(tmpRoot, 'media', 'vidA', 'drama', 'new1');
    const otherVideo = path.join(tmpRoot, 'media', 'vidB', 'drama', 'old2');
    touch(path.join(oldRun, 'frames', 't.jpg'));
    touch(path.join(oldRun, 'scripts', 's.md'));
    touch(path.join(freshRun, 'frames', 't.jpg'));
    touch(path.join(otherVideo, 'work', 'w.tmp'));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(oldRun, old, old);
    fs.utimesSync(otherVideo, old, old);

    const res = sweepAgedDramaOrphans({ mediaRoot: tmpRoot });
    expect(res.scannedRuns).toBe(3);
    expect(res.deleted).toBe(2);
    expect(res.stoppedEarly).toBe(false);
    expect(fs.existsSync(path.join(oldRun, 'frames'))).toBe(false);
    expect(fs.existsSync(path.join(oldRun, 'scripts', 's.md'))).toBe(true);
    expect(fs.existsSync(path.join(freshRun, 'frames', 't.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(otherVideo, 'work'))).toBe(false);
  });

  it('respects the deletion bound and reports stopping early', () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
      const run = path.join(tmpRoot, 'media', 'vidA', 'drama', `old${i}`);
      touch(path.join(run, 'frames', 't.jpg'));
      fs.utimesSync(run, old, old);
    }
    const res = sweepAgedDramaOrphans({ mediaRoot: tmpRoot, maxDirs: 2 });
    expect(res.deleted).toBe(2);
    expect(res.stoppedEarly).toBe(true);
  });
});
