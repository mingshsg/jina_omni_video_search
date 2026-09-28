/**
 * P4 per-run subtitle source policy for resolveSubtitlesForLanguage:
 * - existing_only: sidecar → embedded only; ASR never called.
 * - force_asr: sidecar/embedded skipped; ASR required.
 * - auto (default): sidecar → embedded → ASR.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const envMock = vi.fn();
const findSidecarSrtMock = vi.fn();
const extractEmbeddedSrtForLanguageMock = vi.fn();
const transcribeOpenAiMock = vi.fn();
const writeCuesToSrtMock = vi.fn();
const extractDramaAudioMock = vi.fn();

vi.mock('./env', () => ({
  getDramaEnv: (...args: unknown[]) => envMock(...args),
}));

vi.mock('./extract-subs', () => ({
  findSidecarSrt: (...args: unknown[]) => findSidecarSrtMock(...args),
  extractEmbeddedSrtForLanguage: (...args: unknown[]) =>
    extractEmbeddedSrtForLanguageMock(...args),
}));

vi.mock('./asr', () => ({
  transcribeWithOpenAiCompatible: (...args: unknown[]) =>
    transcribeOpenAiMock(...args),
  transcribeWithWhisperCli: vi.fn(),
  writeCuesToSrt: (...args: unknown[]) => writeCuesToSrtMock(...args),
}));

vi.mock('./extract-audio', () => ({
  extractDramaAudio: (...args: unknown[]) => extractDramaAudioMock(...args),
}));

import { resolveSubtitlesForLanguage } from './resolve-subtitles';

const SRT_BODY =
  '1\n00:00:01,000 --> 00:00:02,000\nline\n';

function env(provider: string): unknown {
  return {
    DRAMA_ASR_PROVIDER: provider,
    DRAMA_ASR_API_KEY: 'test-key',
    DRAMA_ASR_API_URL: '',
    DRAMA_ASR_MODEL: 'whisper-1',
    DRAMA_WHISPER_BIN: '',
  };
}

describe('resolveSubtitlesForLanguage P4 policies', () => {
  let dir = '';

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.mockReturnValue(env('openai'));
    extractDramaAudioMock.mockResolvedValue(undefined);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-subsrc-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = (over: Record<string, unknown> = {}) => ({
    videoPath: path.join(dir, 'episode.mp4'),
    lang: 'zh',
    subtitlesDir: dir,
    audioDir: path.join(dir, 'audio'),
    ...over,
  });

  // --- auto (default) ---

  it('auto prefers sidecar and never touches ASR', async () => {
    const sidecar = path.join(dir, 'episode.zh.srt');
    fs.writeFileSync(sidecar, SRT_BODY);
    findSidecarSrtMock.mockReturnValue(sidecar);
    const res = await resolveSubtitlesForLanguage(base());
    expect(res.origin).toBe('sidecar');
    expect(transcribeOpenAiMock).not.toHaveBeenCalled();
    expect(extractEmbeddedSrtForLanguageMock).not.toHaveBeenCalled();
  });

  it('auto falls back to embedded then ASR', async () => {
    findSidecarSrtMock.mockReturnValue(undefined);
    extractEmbeddedSrtForLanguageMock.mockImplementation(async () => {
      fs.writeFileSync(path.join(dir, 'zh.srt'), SRT_BODY);
      return { stream: { subIndex: 1, langTag: 'chi' } };
    });
    const res = await resolveSubtitlesForLanguage(base());
    expect(res.origin).toBe('embedded');
    expect(transcribeOpenAiMock).not.toHaveBeenCalled();
  });

  it('auto falls through to ASR when no sidecar/embedded', async () => {
    findSidecarSrtMock.mockReturnValue(undefined);
    extractEmbeddedSrtForLanguageMock.mockResolvedValue(null);
    transcribeOpenAiMock.mockResolvedValue({
      cues: [{ index: 1, startMs: 0, endMs: 1000, text: '你好' }],
      source: 'openai',
    });
    const res = await resolveSubtitlesForLanguage(base());
    expect(res.origin).toBe('openai');
    expect(transcribeOpenAiMock).toHaveBeenCalledTimes(1);
  });

  // --- existing_only ---

  it('existing_only uses sidecar and skips ASR', async () => {
    const sidecar = path.join(dir, 'episode.zh.srt');
    fs.writeFileSync(sidecar, SRT_BODY);
    findSidecarSrtMock.mockReturnValue(sidecar);
    const res = await resolveSubtitlesForLanguage(
      base({ subtitleSource: 'existing_only' }),
    );
    expect(res.origin).toBe('sidecar');
    expect(transcribeOpenAiMock).not.toHaveBeenCalled();
  });

  it('existing_only uses embedded and skips ASR', async () => {
    findSidecarSrtMock.mockReturnValue(undefined);
    extractEmbeddedSrtForLanguageMock.mockImplementation(async () => {
      fs.writeFileSync(path.join(dir, 'zh.srt'), SRT_BODY);
      return { stream: { subIndex: 0, langTag: 'eng' } };
    });
    const res = await resolveSubtitlesForLanguage(
      base({ subtitleSource: 'existing_only' }),
    );
    expect(res.origin).toBe('embedded');
    expect(transcribeOpenAiMock).not.toHaveBeenCalled();
  });

  it('existing_only errors visibly and never calls ASR when no source', async () => {
    findSidecarSrtMock.mockReturnValue(undefined);
    extractEmbeddedSrtForLanguageMock.mockResolvedValue(null);
    await expect(
      resolveSubtitlesForLanguage(base({ subtitleSource: 'existing_only' })),
    ).rejects.toThrow(/existing_only/);
    expect(transcribeOpenAiMock).not.toHaveBeenCalled();
  });

  // --- force_asr ---

  it('force_asr skips sidecar and embedded even when present', async () => {
    const sidecar = path.join(dir, 'episode.zh.srt');
    fs.writeFileSync(sidecar, SRT_BODY);
    findSidecarSrtMock.mockReturnValue(sidecar);
    transcribeOpenAiMock.mockResolvedValue({
      cues: [{ index: 1, startMs: 0, endMs: 1000, text: '你好' }],
      source: 'openai',
    });
    const res = await resolveSubtitlesForLanguage(
      base({ subtitleSource: 'force_asr' }),
    );
    expect(res.origin).toBe('openai');
    expect(findSidecarSrtMock).not.toHaveBeenCalled();
    expect(extractEmbeddedSrtForLanguageMock).not.toHaveBeenCalled();
    expect(transcribeOpenAiMock).toHaveBeenCalledTimes(1);
  });

  it('force_asr errors when ASR is not configured', async () => {
    envMock.mockReturnValue(env('off'));
    findSidecarSrtMock.mockReturnValue(path.join(dir, 'episode.zh.srt'));
    await expect(
      resolveSubtitlesForLanguage(base({ subtitleSource: 'force_asr' })),
    ).rejects.toThrow(/force_asr/);
    expect(transcribeOpenAiMock).not.toHaveBeenCalled();
  });

  it('force_asr errors when ASR fails', async () => {
    findSidecarSrtMock.mockReturnValue(undefined);
    transcribeOpenAiMock.mockRejectedValue(new Error('asr boom'));
    await expect(
      resolveSubtitlesForLanguage(base({ subtitleSource: 'force_asr' })),
    ).rejects.toThrow(/asr boom|force_asr/);
  });
});
