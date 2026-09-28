import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('./env', () => ({
  getDramaEnv: () => ({
    DRAMA_EIS_CHAT_INFERENCE_ID: 'test-propose',
    DRAMA_EIS_AUDIT_INFERENCE_ID: '',
    DRAMA_DIRECTORS_WINDOW_SEC: 120,
    DRAMA_DIRECTORS_MAX_WINDOWS: 8,
    DRAMA_DIRECTORS_FRAMES_PER_WINDOW: 1,
  }),
}));

vi.mock('./eis-chat', () => ({
  callDramaEisChat: vi.fn(async () => {
    throw new Error('EIS down');
  }),
  imageDataUrlFromJpeg: () => ({ type: 'image_url', image_url: { url: 'x' } }),
  DramaEisChatError: class extends Error {
    kind: string;
    constructor(kind: string, msg: string) {
      super(msg);
      this.kind = kind;
    }
  },
}));

vi.mock('./extract-stills', () => ({
  extractStillAtSec: vi.fn(async () => undefined),
  sampleTimestamps: (t0: number) => [t0 + 1],
}));

import { generateDirectorsScript, planDirectorWindows } from './directors-script';
import { callDramaEisChat } from './eis-chat';

const SCENE_OK = `## SCENE 1 · 00:00:00–00:02:00

**SLUGLINE (ZH):** 内景。宫殿 — 日
**SLUGLINE (EN):** INT. PALACE — DAY
`;

describe('R3 director-script coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('samples only the first ~16 min of a 45-min episode', () => {
    const windows = planDirectorWindows({
      durationMs: 45 * 60_000,
      windowSec: 120,
      maxWindows: 8,
      structure: [
        {
          kind: 'body',
          start_ms: 60_000,
          end_ms: 40 * 60_000,
          confidence: 0.5,
          source: 'heuristic',
        },
      ],
    });
    expect(windows).toHaveLength(8);
    const covered = windows[windows.length - 1].t1 - windows[0].t0;
    expect(covered).toBe(960);
    // Not whole-episode: 960s << 2700s
    expect(covered).toBeLessThan(45 * 60);
    expect(windows[0].t0).toBe(60);
  });

  it('rejects all-error output instead of publishing it', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-r3-'));
    await expect(
      generateDirectorsScript({
        videoPath: '/tmp/video.mp4',
        videoId: 'vid1',
        title: 'test',
        durationMs: 120_000,
        workspace: {
          runId: 'r3',
          rootDir,
          audioDir: path.join(rootDir, 'audio'),
          subtitlesDir: path.join(rootDir, 'subtitles'),
          metaPath: path.join(rootDir, 'meta.json'),
          structurePath: path.join(rootDir, 'structure.json'),
        } as never,
      }),
    ).rejects.toThrow(/all .* failed/i);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('counts only successful windows as coverage and names gaps (F5)', async () => {
    const chat = vi.mocked(callDramaEisChat);
    chat.mockResolvedValueOnce({ text: SCENE_OK, usage: {} });
    chat.mockRejectedValueOnce(new Error('window boom'));
    chat.mockResolvedValueOnce({
      text: 'SYNOPSIS_ZH: 宫廷故事。\nSYNOPSIS_EN: A palace story.',
      usage: {},
    });
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-f5-'));
    try {
      const res = await generateDirectorsScript({
        videoPath: '/tmp/video.mp4',
        videoId: 'vid1',
        title: 'test',
        durationMs: 240_000,
        workspace: {
          runId: 'f5',
          rootDir,
          audioDir: path.join(rootDir, 'audio'),
          subtitlesDir: path.join(rootDir, 'subtitles'),
          metaPath: path.join(rootDir, 'meta.json'),
          structurePath: path.join(rootDir, 'structure.json'),
        } as never,
      });
      expect(res.windowsDone).toBe(1);
      expect(res.windowsPlanned).toBe(2);
      expect(res.coverageRanges).toEqual([{ t0: 0, t1: 120 }]);
      expect(res.coverageGaps).toEqual([{ t0: 120, t1: 240 }]);
      // Successful seconds only — the failed 120s are not coverage.
      expect(res.coverageSec).toBe(120);
      const zh = fs.readFileSync(
        path.join(rootDir, 'scripts', 'directors_script_zh.md'),
        'utf8',
      );
      expect(zh).toContain('gaps');
      expect(zh).not.toContain('ERROR generating');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
