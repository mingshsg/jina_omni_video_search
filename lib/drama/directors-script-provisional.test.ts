import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EisChatContentPart } from './eis-chat';
import type { DramaWorkspace } from './workspace';

let auditId = '';
let auditorMessages: unknown[] = [];
let directorMessages: unknown[] = [];

vi.mock('./env', () => ({
  getDramaEnv: () => ({
    DRAMA_EIS_CHAT_INFERENCE_ID: 'test-propose',
    DRAMA_EIS_AUDIT_INFERENCE_ID: auditId,
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
      auditorMessages.push(opts.messages[0].content);
      return {
        text: 'VERDICT: supported\nREASON: dialogue and stills match',
        usage: {},
      };
    }
    if (content.includes('SYNOPSIS_ZH')) {
      return {
        text: 'SYNOPSIS_ZH: 宫廷故事。\nSYNOPSIS_EN: A palace story.',
        usage: {},
      };
    }
    directorMessages.push(opts.messages[0].content);
    return { text: SCENE, usage: {} };
  }),
  imageDataUrlFromJpeg: (bytes: Buffer) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` },
  }),
  DramaEisChatError: class extends Error {
    kind: string;
    constructor(kind: string, msg: string) {
      super(msg);
      this.kind = kind;
    }
  },
}));

vi.mock('./extract-stills', () => ({
  extractStillAtSec: vi.fn(async (opts: { outPath: string }) => {
    fs.writeFileSync(opts.outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }),
  sampleTimestamps: (t0: number) => [t0 + 1],
}));

import { generateDirectorsScript } from './directors-script';

function workspace() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-f2-'));
  return {
    ws: {
      runId: 'f2',
      rootDir,
      audioDir: path.join(rootDir, 'audio'),
      subtitlesDir: path.join(rootDir, 'subtitles'),
      metaPath: path.join(rootDir, 'meta.json'),
      structurePath: path.join(rootDir, 'structure.json'),
    } satisfies DramaWorkspace,
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
  };
}

async function run(subtitle?: { lang: 'ko' | 'th'; text: string }) {
  const { ws, cleanup } = workspace();
  try {
    let subtitlePaths: string[] | undefined;
    if (subtitle) {
      fs.mkdirSync(ws.subtitlesDir, { recursive: true });
      const srtPath = path.join(ws.subtitlesDir, `${subtitle.lang}.srt`);
      fs.writeFileSync(srtPath, `1\n00:00:01,000 --> 00:00:02,000\n${subtitle.text}\n`, 'utf8');
      subtitlePaths = [srtPath];
    }
    const res = await generateDirectorsScript({
      videoPath: '/tmp/video.mp4',
      videoId: 'vid1',
      title: 'test',
      durationMs: 120_000,
      workspace: ws,
      subtitlePaths,
    });
    return res;
  } finally {
    cleanup();
  }
}

describe('F2 provisional synopsis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditorMessages = [];
    directorMessages = [];
    auditId = '';
  });

  it('produces synopsis with a skipped audit when no audit id is configured', async () => {
    const res = await run();
    expect(res.synopsisZh).toContain('宫廷故事');
    expect(res.audit?.status).toBe('skipped');
    expect(res.audit?.verdict).toBeUndefined();
    // Synopsis exists but is NOT audited — the runner must mark it
    // provisional (covered at the runner level).
    expect(res.windowsDone).toBe(1);
  });

  it('attaches sampled stills as visual evidence when the auditor runs', async () => {
    auditId = 'test-audit';
    const res = await run();
    expect(res.audit?.status).toBe('ok');
    expect(res.audit?.verdict).toBe('supported');
    expect(auditorMessages).toHaveLength(1);
    const parts = auditorMessages[0] as EisChatContentPart[];
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);
  });

  it('sends the full synopsis and records the reviewed span (I5)', async () => {
    auditId = 'test-audit';
    const res = await run();
    const parts = auditorMessages[0] as EisChatContentPart[];
    const prompt = (
      parts.find((p) => p.type === 'text') as { text: string }
    ).text;
    // The verdict covers the actual synopsis, not just the script sample.
    expect(prompt).toContain('宫廷故事');
    expect(prompt).toContain('A palace story');
    const scope = res.audit?.scope;
    expect(scope).toBeDefined();
    expect(scope!.synopsisChars).toBeGreaterThan(0);
    expect(scope!.scriptSampleChars).toBeGreaterThan(0);
    expect(scope!.scriptSampleChars).toBeLessThanOrEqual(4000);
    expect(scope!.stills).toBeGreaterThan(0);
  });

  it.each([
    { lang: 'ko', text: '안녕하세요', label: 'Korean' },
    { lang: 'th', text: 'สวัสดี', label: 'Thai' },
  ] as const)('uses $lang cues in the director and auditor evidence', async (subtitle) => {
    auditId = 'test-audit';
    await run(subtitle);
    const proposal = JSON.stringify(directorMessages);
    const audit = JSON.stringify(auditorMessages);
    expect(proposal).toContain(`${subtitle.label} subtitle cues`);
    expect(proposal).toContain(subtitle.text);
    expect(audit).toContain(`${subtitle.label} subtitle cues`);
    expect(audit).toContain(subtitle.text);
  });
});
