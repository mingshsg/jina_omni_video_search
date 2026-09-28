import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let verdictText = 'VERDICT: supported\nREASON: lines match cues';

vi.mock('./env', () => ({
  getDramaEnv: () => ({
    DRAMA_EIS_CHAT_INFERENCE_ID: 'test-propose',
    DRAMA_EIS_AUDIT_INFERENCE_ID: 'test-audit',
    DRAMA_DIRECTORS_WINDOW_SEC: 120,
    DRAMA_DIRECTORS_MAX_WINDOWS: 8,
    DRAMA_DIRECTORS_FRAMES_PER_WINDOW: 1,
  }),
}));

const SCENE = `## SCENE 1 · 00:00:00–00:02:00

**SLUGLINE (ZH):** 内景。宫殿 — 日
**SLUGLINE (EN):** INT. PALACE — DAY
`;

vi.mock('./eis-chat', () => ({
  callDramaEisChat: vi.fn(async (opts: { messages: Array<{ content: unknown }> }) => {
    const content = JSON.stringify(opts.messages.map((m) => m.content));
    if (content.includes('You are an auditor')) {
      return { text: verdictText, usage: {} };
    }
    if (content.includes('SYNOPSIS_ZH')) {
      return {
        text: 'SYNOPSIS_ZH: 宫廷故事。\nSYNOPSIS_EN: A palace story.',
        usage: {},
      };
    }
    return { text: SCENE, usage: {} };
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

import {
  generateDirectorsScript,
  parseAuditVerdict,
} from './directors-script';

function workspace() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-r4-'));
  return {
    ws: {
      runId: 'r4',
      rootDir,
      audioDir: path.join(rootDir, 'audio'),
      subtitlesDir: path.join(rootDir, 'subtitles'),
      metaPath: path.join(rootDir, 'meta.json'),
      structurePath: path.join(rootDir, 'structure.json'),
    } as never,
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
  };
}

describe('parseAuditVerdict', () => {
  it('parses all three verdicts and rejects garbage', () => {
    expect(parseAuditVerdict('VERDICT: supported')).toBe('supported');
    expect(parseAuditVerdict('verdict: insufficient\nreason: x')).toBe('insufficient');
    expect(parseAuditVerdict('VERDICT: contradicted')).toBe('contradicted');
    expect(parseAuditVerdict('looks good to me')).toBeUndefined();
    // A bare "contradicted" without the VERDICT: label must not veto.
    expect(parseAuditVerdict('contradicted')).toBeUndefined();
  });
});

describe('R4 auditor veto', () => {
  beforeEach(() => {
    verdictText = 'VERDICT: supported\nREASON: lines match cues';
  });

  it('vetoes publication on a contradicted verdict', async () => {
    verdictText = 'VERDICT: contradicted\nREASON: dialogue invents a murder';
    const { ws, cleanup } = workspace();
    try {
      await expect(
        generateDirectorsScript({
          videoPath: '/tmp/video.mp4',
          videoId: 'vid1',
          title: 'test',
          durationMs: 120_000,
          workspace: ws,
        }),
      ).rejects.toThrow(/auditor veto.*contradicted/i);
      // The failed script stays on disk for review, not as accepted metadata.
      expect(
        fs.existsSync(path.join(ws.rootDir as string, 'scripts', 'directors_audit.json')),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('vetoes publication on an insufficient verdict', async () => {
    verdictText = 'VERDICT: insufficient\nREASON: no timed evidence provided';
    const { ws, cleanup } = workspace();
    try {
      await expect(
        generateDirectorsScript({
          videoPath: '/tmp/video.mp4',
          videoId: 'vid1',
          title: 'test',
          durationMs: 120_000,
          workspace: ws,
        }),
      ).rejects.toThrow(/auditor veto.*insufficient/i);
    } finally {
      cleanup();
    }
  });

  it('publishes with audit ok/supported when the auditor agrees', async () => {
    const { ws, cleanup } = workspace();
    try {
      const res = await generateDirectorsScript({
        videoPath: '/tmp/video.mp4',
        videoId: 'vid1',
        title: 'test',
        durationMs: 120_000,
        workspace: ws,
      });
      expect(res.audit?.status).toBe('ok');
      expect(res.audit?.verdict).toBe('supported');
      expect(res.windowsDone).toBe(1);
    } finally {
      cleanup();
    }
  });
});
