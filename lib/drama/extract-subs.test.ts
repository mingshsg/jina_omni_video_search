import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runFfmpegMock = vi.fn();

vi.mock('../video/run-ffmpeg', () => ({
  runFfmpeg: (...args: unknown[]) => runFfmpegMock(...args),
}));

import {
  extractEmbeddedSrtForLanguage,
  findSidecarSrt,
  listSubtitleStreams,
} from './extract-subs';

const PROBE = {
  streams: [
    { codec_name: 'subrip', tags: { language: 'eng', title: 'English' } },
    { codec_name: 'subrip', tags: { language: 'chi', title: 'Chinese' } },
  ],
};

describe('R8 embedded subtitle language matching', () => {
  let dir = '';

  beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-r8subs-'));
    runFfmpegMock.mockImplementation(async (bin: string, args: string[]) => {
      if (bin === 'ffprobe') return { stdout: JSON.stringify(PROBE), stderr: '' };
      // ffmpeg: pretend extraction wrote the caller's output path (last arg).
      const out = args[args.length - 1];
      fs.writeFileSync(out, '1\n00:00:01,000 --> 00:00:02,000\nline\n');
      return { stdout: '', stderr: '' };
    });
  });

  it('lists streams with language tags', async () => {
    const streams = await listSubtitleStreams('/tmp/v.mp4');
    expect(streams).toHaveLength(2);
    expect(streams[1]).toMatchObject({ subIndex: 1, langTag: 'chi' });
  });

  it('selects the zh-tagged stream for zh (not the first stream)', async () => {
    const out = path.join(dir, 'zh.srt');
    const res = await extractEmbeddedSrtForLanguage({
      videoPath: '/tmp/v.mp4',
      lang: 'zh',
      outSrtPath: out,
    });
    expect(res?.stream.subIndex).toBe(1);
    const mapIdx = runFfmpegMock.mock.calls.find((c) => c[0] === 'ffmpeg')?.[1].indexOf('0:s:1');
    expect(mapIdx).toBeGreaterThan(-1);
  });

  it('selects the en-tagged stream for en', async () => {
    const out = path.join(dir, 'en.srt');
    const res = await extractEmbeddedSrtForLanguage({
      videoPath: '/tmp/v.mp4',
      lang: 'en',
      outSrtPath: out,
    });
    expect(res?.stream.subIndex).toBe(0);
  });

  it.each([
    ['ko', 'kor', '0:s:1'],
    ['th', 'tha', '0:s:1'],
  ] as const)('selects the %s embedded stream by %s tag', async (lang, tag, map) => {
    runFfmpegMock.mockImplementationOnce(async () => ({
      stdout: JSON.stringify({ streams: [
        { codec_name: 'subrip', tags: { language: 'eng' } },
        { codec_name: 'subrip', tags: { language: tag } },
      ] }),
      stderr: '',
    }));
    const out = path.join(dir, `${lang}.srt`);
    const result = await extractEmbeddedSrtForLanguage({
      videoPath: '/tmp/v.mp4', lang, outSrtPath: out,
    });
    expect(result?.stream.subIndex).toBe(1);
    expect(runFfmpegMock.mock.calls.find((c) => c[0] === 'ffmpeg')?.[1]).toContain(map);
  });

  it.each(['ko', 'th'] as const)('finds a %s sidecar without changing its language', (lang) => {
    const video = path.join(dir, 'episode.mp4');
    const sidecar = path.join(dir, `episode.${lang}.srt`);
    fs.writeFileSync(sidecar, '1\n00:00:01,000 --> 00:00:02,000\nline\n');
    expect(findSidecarSrt(video, lang)).toBe(sidecar);
  });

  it('returns null when no stream matches instead of mislabeling', async () => {
    runFfmpegMock.mockImplementationOnce(async (bin: string) => {
      if (bin === 'ffprobe') {
        return {
          stdout: JSON.stringify({
            streams: [{ codec_name: 'subrip', tags: { language: 'eng' } }],
          }),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const out = path.join(dir, 'zh.srt');
    const res = await extractEmbeddedSrtForLanguage({
      videoPath: '/tmp/v.mp4',
      lang: 'zh',
      outSrtPath: out,
    });
    expect(res).toBeNull();
    // No ffmpeg extraction attempted for a mismatched language.
    expect(runFfmpegMock.mock.calls.some((c) => c[0] === 'ffmpeg')).toBe(false);
  });

  it('returns null for untagged streams rather than assigning them', async () => {
    runFfmpegMock.mockImplementationOnce(async (bin: string) => {
      if (bin === 'ffprobe') {
        return {
          stdout: JSON.stringify({ streams: [{ codec_name: 'subrip' }] }),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const out = path.join(dir, 'zh.srt');
    const res = await extractEmbeddedSrtForLanguage({
      videoPath: '/tmp/v.mp4',
      lang: 'zh',
      outSrtPath: out,
    });
    expect(res).toBeNull();
  });
});
