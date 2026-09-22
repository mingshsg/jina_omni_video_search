import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultRetentionPolicy,
  evaluateDiskFreePressure,
  evaluateSpoolPressure,
  measureSpoolUsage,
  DEFAULT_SPOOL_MIN_FREE_BYTES,
} from './spool-accounting';
import {
  assertPathInsideRoot,
  ensureEpochFragmentDir,
  ensureSessionSpoolLayout,
  epochFragmentDir,
  mintOpaqueMediaRef,
  parseOpaqueMediaRef,
  sessionSpoolDir,
} from './spool-paths';
import { parseHlsMediaPlaylist } from './fragment-capture';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('spool paths and accounting', () => {
  it('mints opaque refs and keeps paths under session dir', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-spool-'));
    tmpDirs.push(root);
    const sessionDir = sessionSpoolDir(root, 'ls_abc');
    ensureSessionSpoolLayout(sessionDir);
    const ref = mintOpaqueMediaRef('ls_abc', 'clip');
    const parsed = parseOpaqueMediaRef(ref);
    expect(parsed.kind).toBe('clip');
    expect(() =>
      assertPathInsideRoot(sessionDir, path.join(sessionDir, '../escape')),
    ).toThrow(/escapes/);
  });

  it('A-07: isolates fragment dirs per stream epoch', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-epoch-'));
    tmpDirs.push(root);
    const sessionDir = sessionSpoolDir(root, 'ls_e');
    ensureSessionSpoolLayout(sessionDir);
    const e1 = ensureEpochFragmentDir(sessionDir, 1);
    const e2 = ensureEpochFragmentDir(sessionDir, 2);
    expect(e1).toBe(epochFragmentDir(sessionDir, 1));
    expect(e1).not.toBe(e2);
    expect(e1.endsWith(`${path.sep}fragments${path.sep}e1`)).toBe(true);
    expect(fs.existsSync(e1)).toBe(true);
    expect(fs.existsSync(e2)).toBe(true);
  });

  it('reports unlimited spool pressure as ok', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-spool-'));
    tmpDirs.push(root);
    const sessionDir = sessionSpoolDir(root, 'ls_x');
    ensureSessionSpoolLayout(sessionDir);
    fs.writeFileSync(path.join(sessionDir, 'media', 'a.bin'), Buffer.alloc(100));
    const usage = measureSpoolUsage(sessionDir);
    expect(usage.retainedMediaBytes).toBe(100);
    expect(evaluateSpoolPressure(usage, defaultRetentionPolicy())).toEqual({
      level: 'ok',
    });
    expect(
      evaluateSpoolPressure(
        usage,
        defaultRetentionPolicy({ retainedMediaMaxBytes: 10 }),
      ),
    ).toMatchObject({ level: 'retained_hard' });
  });

  it('applies soft free-space floor before byte caps', () => {
    expect(DEFAULT_SPOOL_MIN_FREE_BYTES).toBe(50 * 1024 * 1024 * 1024);
    expect(evaluateDiskFreePressure(60 * 1024 ** 3, DEFAULT_SPOOL_MIN_FREE_BYTES)).toEqual({
      level: 'ok',
    });
    expect(
      evaluateDiskFreePressure(10 * 1024 ** 3, DEFAULT_SPOOL_MIN_FREE_BYTES),
    ).toMatchObject({
      level: 'disk_free_low',
      minFreeBytes: DEFAULT_SPOOL_MIN_FREE_BYTES,
    });
    expect(evaluateDiskFreePressure(1, 0)).toEqual({ level: 'ok' });
    expect(evaluateDiskFreePressure(1, undefined)).toEqual({ level: 'ok' });

    const usage = {
      root: '/tmp',
      totalBytes: 0,
      pendingBytes: 0,
      retainedMediaBytes: 0,
      fileCount: 0,
    };
    expect(
      evaluateSpoolPressure(
        usage,
        defaultRetentionPolicy({
          minFreeBytes: DEFAULT_SPOOL_MIN_FREE_BYTES,
          retainedMediaMaxBytes: 10,
        }),
        { freeBytes: 1_000 },
      ),
    ).toMatchObject({ level: 'disk_free_low' });
  });
});

describe('HLS playlist parse', () => {
  it('reads EXTINF and PROGRAM-DATE-TIME', () => {
    const text = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-PROGRAM-DATE-TIME:2026-09-10T00:00:00.000Z
#EXTINF:2.000,
frag_000000.ts
#EXT-X-PROGRAM-DATE-TIME:2026-09-10T00:00:02.000Z
#EXTINF:2.030,
frag_000001.ts
`;
    const segs = parseHlsMediaPlaylist(text);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.durationSec).toBe(2);
    expect(segs[1]!.durationSec).toBeCloseTo(2.03);
    expect(segs[1]!.programDateTime).toContain('2026-09-10');
  });
});
