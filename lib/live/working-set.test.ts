import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FinalizedFragment } from './window-assembler';
import {
  hlsPlaylistListSize,
  pruneCaptureWorkingSet,
  unlinkPrunedFragmentFiles,
} from './working-set';

function frag(
  seq: number,
  fragPath: string,
  overrides: Partial<FinalizedFragment> = {},
): FinalizedFragment {
  const start = seq * 2000;
  return {
    stream_epoch: 1,
    sequence_no: seq,
    start_pts_ms: start,
    end_pts_ms: start + 2000,
    media_signature: 'sigA',
    finalized_at: new Date(Date.UTC(2026, 8, 10, 0, 0, seq * 2)).toISOString(),
    path: fragPath,
    media_sha256: `sha256:${seq}`,
    ...overrides,
  };
}

describe('working-set (A-10)', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('bounds HLS playlist list size above one window', () => {
    expect(hlsPlaylistListSize(4, 3)).toBeGreaterThanOrEqual(8);
    expect(hlsPlaylistListSize(4, 3)).toBe(8);
  });

  it('prunes fragments before the last window end while retaining overlap', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ws-'));
    dirs.push(root);
    const fragments = Array.from({ length: 10 }, (_, i) => {
      const p = path.join(root, `frag_${String(i).padStart(6, '0')}.ts`);
      fs.writeFileSync(p, `ts-${i}`);
      return frag(i, p);
    });
    const sessionId = 'ls_ws';
    const emitted = new Set(
      [3, 6, 9].map((seq) => `${sessionId}_1_${seq}`),
    );

    const pruned = pruneCaptureWorkingSet({
      fragments,
      emittedWindows: emitted,
      sessionId,
    });

    expect(pruned.retainFromSequence).toBe(9);
    expect(pruned.fragments.map((f) => f.sequence_no)).toEqual([9]);
    expect(pruned.prunedPaths).toHaveLength(9);
    expect(pruned.emittedWindows.has(`${sessionId}_1_9`)).toBe(true);
    expect(pruned.emittedWindows.has(`${sessionId}_1_3`)).toBe(false);

    const removed = unlinkPrunedFragmentFiles(pruned.prunedPaths);
    expect(removed).toBe(9);
    expect(fs.existsSync(fragments[9]!.path)).toBe(true);
    expect(fs.existsSync(fragments[0]!.path)).toBe(false);
  });

  it('keeps all fragments when no window has been assembled yet', () => {
    const fragments = [0, 1, 2].map((i) =>
      frag(i, `/tmp/frag_${i}.ts`),
    );
    const pruned = pruneCaptureWorkingSet({
      fragments,
      emittedWindows: new Set(),
      sessionId: 'ls_x',
    });
    expect(pruned.fragments).toHaveLength(3);
    expect(pruned.prunedPaths).toHaveLength(0);
  });
});
