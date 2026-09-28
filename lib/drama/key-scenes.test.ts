import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractKeyScenes, parseSceneCandidates } from './key-scenes';
import type { StructureInterval } from './structure';

const body: StructureInterval = {
  kind: 'body',
  start_ms: 60_000,
  end_ms: 25 * 60_000,
  confidence: 0.5,
  source: 'heuristic',
};

const SCRIPT = `# Director's Script

## SCENE 1 · 00:01:00–00:02:30

**SLUGLINE (ZH):** 内景。宫殿 — 日
**SLUGLINE (EN):** INT. PALACE — DAY

## SCENE 2 · 00:03:00–00:04:00

**SLUGLINE (ZH):** 外景。御花园 — 夜
**SLUGLINE (EN):** EXT. GARDEN — NIGHT
`;

describe('parseSceneCandidates', () => {
  it('parses scene headers with summaries from the directors script', () => {
    const { candidates: out, source } = parseSceneCandidates({
      rawScript: SCRIPT,
      structure: [body],
      durationMs: 30 * 60_000,
      maxScenes: 6,
    });
    expect(out).toHaveLength(2);
    expect(source).toBe('script');
    expect(out[0].startSec).toBe(60);
    expect(out[0].endSec).toBe(150);
    expect(out[0].summaryZh).toContain('宫殿');
    expect(out[0].summaryEn).toContain('PALACE');
    expect(out[1].startSec).toBe(180);
    expect(out[1].summaryEn).toContain('GARDEN');
  });

  it('skips unparseable / too-short headers and falls back to windows', () => {
    const messy = `## SCENE 1 · some words

**SLUGLINE (ZH):** x

## SCENE 2 · 00:01:00–00:01:01

**SLUGLINE (ZH):** y
`;
    const { candidates: out, source } = parseSceneCandidates({
      rawScript: messy,
      structure: [body],
      durationMs: 30 * 60_000,
      maxScenes: 4,
    });
    // No parseable scene → uniform windows over body range, still capped.
    expect(source).toBe('uniform-fallback');
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.every((s) => s.summaryZh === undefined)).toBe(true);
  });

  it('falls back to uniform windows over body range when no scenes parse', () => {
    const { candidates: out, source } = parseSceneCandidates({
      rawScript: 'no scenes here',
      structure: [body],
      durationMs: 30 * 60_000,
      maxScenes: 4,
    });
    expect(source).toBe('uniform-fallback');
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out[0].startSec).toBeGreaterThanOrEqual(60);
    expect(out[0].endSec).toBeLessThanOrEqual(1500);
  });

  it('caps at maxScenes', () => {
    const { candidates: out, source } = parseSceneCandidates({
      rawScript: SCRIPT,
      structure: [body],
      durationMs: 30 * 60_000,
      maxScenes: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(1);
    expect(source).toBe('script');
  });
});

describe('extractKeyScenes (F6)', () => {
  it('fails loudly when no stills survive instead of an empty success', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-r6scenes-'));
    try {
      await expect(
        extractKeyScenes({
          // Nonexistent media: every still extraction fails deterministically.
          videoPath: path.join(rootDir, 'missing.mp4'),
          workspace: {
            runId: 'r6s',
            rootDir,
            audioDir: path.join(rootDir, 'audio'),
            subtitlesDir: path.join(rootDir, 'subtitles'),
            metaPath: path.join(rootDir, 'meta.json'),
            structurePath: path.join(rootDir, 'structure.json'),
          } as never,
          structure: [body],
          durationMs: 30 * 60_000,
        }),
      ).rejects.toThrow(/all still extractions failed/i);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
