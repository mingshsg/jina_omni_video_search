import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractCastRoles, proposeFace, generateKeyActors } from './key-actors';

vi.mock('./env', () => ({
  getDramaEnv: () => ({
    DRAMA_EIS_CHAT_INFERENCE_ID: 'test-propose',
    DRAMA_EIS_AUDIT_INFERENCE_ID: 'test-audit',
    DRAMA_KEY_ACTORS_MAX: 6,
    DRAMA_KEY_ACTORS_STILLS: 2,
    DRAMA_KEY_ACTORS_MIN_FRONTAL: 0.7,
  }),
}));

const proposeReply = (roleZh: string | null) =>
  JSON.stringify({
    role_zh: roleZh,
    role_en: 'Zhen Huan',
    frontal: 0.9,
    eyes_open: true,
    face_present: roleZh !== null,
    reason: 'test',
  });

const eisChatMock = vi.fn(
  async (opts: { messages: Array<{ content: unknown }> }) => {
    const content = JSON.stringify(opts.messages.map((m) => m.content));
    if (content.includes('independent auditor')) {
      return { text: JSON.stringify({ ok: true, reason: 'test' }), usage: {} };
    }
    return { text: proposeReply('甄嬛'), usage: {} };
  },
);

vi.mock('./eis-chat', () => ({
  callDramaEisChat: (...args: unknown[]) => eisChatMock(...(args as [])),
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
  extractStillAtSec: vi.fn(async (opts: { outPath: string }) => {
    fs.writeFileSync(opts.outPath, 'fakejpg');
  }),
  sampleTimestamps: (a: number) => [a + 1, a + 2],
}));

describe('extractCastRoles', () => {
  it('pulls unique CJK role mentions from SLUGLINE (ZH) blocks', () => {
    const raw = `## SCENE 1 · 00:01:00–00:02:30

**SLUGLINE (ZH):** 内景。宫殿 — 日
**SLUGLINE (EN):** INT. PALACE — DAY

**DIALOGUE (ZH):**
- [00:01:10] 甄嬛，你来。

## SCENE 2 · 00:03:00–00:04:00

**SLUGLINE (ZH):** 外景。御花园 — 夜（甄嬛、雍正）
**SLUGLINE (EN):** EXT. GARDEN — NIGHT

**DIALOGUE (EN):**
- [00:03:10] The Emperor arrives.
`;
    const roles = extractCastRoles(raw, 8);
    // Scene 1 slugline has no character; scene 2 slugline has 甄嬛/雍正.
    expect(roles).toContain('甄嬛');
    expect(roles).toContain('雍正');
    expect(roles).toHaveLength(2);
  });

  it('skips pure location slugs and caps', () => {
    const raw = `## SCENE 1 · 00:00:00–00:01:00

**SLUGLINE (ZH):** 内景。宫殿 — 日
**SLUGLINE (EN):** INT. PALACE — DAY

## SCENE 2 · 00:02:00–00:03:00

**SLUGLINE (ZH):** 外景。花园 — 夜
**SLUGLINE (EN):** EXT. GARDEN — NIGHT
`;
    expect(extractCastRoles(raw, 8)).toHaveLength(0);
  });

  it('returns empty for no script', () => {
    expect(extractCastRoles(undefined, 8)).toHaveLength(0);
  });
});

describe('R6 proposeFace whitelist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discards a proposed role outside the script candidates', async () => {
    eisChatMock.mockResolvedValueOnce({
      text: proposeReply('路人甲'),
      usage: {},
    });
    const res = await proposeFace({
      roleCandidates: ['甄嬛', '雍正'],
      sec: 61,
      imageBytes: Buffer.from('fake'),
      title: 'test',
    });
    expect(res).toBeNull();
  });

  it('keeps a proposed role inside the script candidates', async () => {
    eisChatMock.mockResolvedValueOnce({
      text: proposeReply('甄嬛'),
      usage: {},
    });
    const res = await proposeFace({
      roleCandidates: ['甄嬛', '雍正'],
      sec: 61,
      imageBytes: Buffer.from('fake'),
      title: 'test',
    });
    expect(res?.roleZh).toBe('甄嬛');
  });
});

describe('R6 review state', () => {
  it('commits candidates with verified:false and no person_id', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-r6-'));
    try {
      const rawScript = `## SCENE 1 · 00:00:00–00:02:00\n\n**SLUGLINE (ZH):** 内景。宫殿 — 日（甄嬛）\n`;
      const res = await generateKeyActors({
        videoPath: '/tmp/video.mp4',
        title: 'test',
        workspace: {
          runId: 'r6',
          rootDir,
          audioDir: path.join(rootDir, 'audio'),
          subtitlesDir: path.join(rootDir, 'subtitles'),
          metaPath: path.join(rootDir, 'meta.json'),
          structurePath: path.join(rootDir, 'structure.json'),
        } as never,
        rawScript,
        durationMs: 120_000,
      });
      expect(res.actors).toHaveLength(1);
      expect(res.actors[0].role_zh).toBe('甄嬛');
      // Weaker review state: never upstream-verified, never a performer id.
      expect(res.actors[0].verified).toBe(false);
      expect(res.actors[0].person_id).toBeUndefined();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('fails loudly when no candidates survive the gates (F6)', async () => {
    const noFace = {
      text: JSON.stringify({
        role_zh: null,
        frontal: 0,
        eyes_open: false,
        face_present: false,
        reason: 'test',
      }),
      usage: {},
    };
    // Two stills are sampled; fail both proposals.
    eisChatMock.mockResolvedValueOnce(noFace).mockResolvedValueOnce(noFace);
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-r6empty-'));
    try {
      const rawScript = `## SCENE 1 · 00:00:00–00:02:00\n\n**SLUGLINE (ZH):** 内景。宫殿 — 日（甄嬛）\n`;
      await expect(
        generateKeyActors({
          videoPath: '/tmp/video.mp4',
          title: 'test',
          workspace: {
            runId: 'r6empty',
            rootDir,
            audioDir: path.join(rootDir, 'audio'),
            subtitlesDir: path.join(rootDir, 'subtitles'),
            metaPath: path.join(rootDir, 'meta.json'),
            structurePath: path.join(rootDir, 'structure.json'),
          } as never,
          rawScript,
          durationMs: 120_000,
        }),
      ).rejects.toThrow(/no reviewable face candidates/i);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
