import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMock = vi.fn();
const translateMock = vi.fn();
const writeMock = vi.fn();
vi.mock('./resolve-subtitles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./resolve-subtitles')>()),
  resolveSubtitlesForLanguage: (...args: unknown[]) => resolveMock(...args),
}));
vi.mock('./translate-subtitles', () => ({
  translateSubtitleCues: (...args: unknown[]) => translateMock(...args),
}));
vi.mock('./asr', () => ({ writeCuesToSrt: (...args: unknown[]) => writeMock(...args) }));

import { NoSubtitlesError } from './resolve-subtitles';
import { resolveEnglishChineseSubtitles } from './resolve-bilingual-subtitles';

const en = {
  lang: 'en' as const,
  srtPath: '/tmp/en.srt',
  cues: [{ index: 1, startMs: 1000, endMs: 2000, text: 'Hello' }],
  origin: 'mlx_host' as const,
};

describe('EN/ZH subtitle source then translation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const opts = () => ({ videoPath: '/tmp/video.mp4', subtitlesDir: '/tmp/subtitles', audioDir: '/tmp/audio' });

  it('uses a timed English source and translates only missing Chinese cues', async () => {
    resolveMock.mockImplementation(async ({ lang }: { lang: string }) => {
      if (lang === 'en') return en;
      throw new NoSubtitlesError('missing');
    });
    translateMock.mockResolvedValue([{ ...en.cues[0], text: '你好' }]);
    const result = await resolveEnglishChineseSubtitles(opts());
    expect(result.errors).toEqual({});
    expect(result.resolved.en).toBe(en);
    expect(result.resolved.zh?.origin).toBe('translated_en');
    expect(writeMock).toHaveBeenCalledWith([{ ...en.cues[0], text: '你好' }], '/tmp/subtitles/zh.srt');
    expect(resolveMock.mock.calls.every(([arg]) => arg.allowConfiguredAsr === false)).toBe(true);
  });

  it('keeps two genuine language sources without translating', async () => {
    resolveMock.mockImplementation(async ({ lang }: { lang: string }) => ({ ...en, lang }));
    const result = await resolveEnglishChineseSubtitles(opts());
    expect(result.resolved.en).toBeDefined();
    expect(result.resolved.zh).toBeDefined();
    expect(translateMock).not.toHaveBeenCalled();
  });

  it('keeps the source available when translation fails', async () => {
    resolveMock.mockImplementation(async ({ lang }: { lang: string }) => {
      if (lang === 'en') return en;
      throw new NoSubtitlesError('missing');
    });
    translateMock.mockRejectedValue(new Error('translator unavailable'));
    const result = await resolveEnglishChineseSubtitles(opts());
    expect(result.resolved.en).toBe(en);
    expect(result.errors.zh?.message).toBe('translator unavailable');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('does not guess the ASR language when neither language has a source', async () => {
    resolveMock.mockRejectedValue(new NoSubtitlesError('missing'));
    const result = await resolveEnglishChineseSubtitles(opts());
    expect(result.errors.en?.message).toMatch(/explicit spoken language/);
    expect(result.errors.zh?.message).toMatch(/explicit spoken language/);
    expect(translateMock).not.toHaveBeenCalled();
  });

  it('explains why an existing-only retry cannot use host ASR', async () => {
    resolveMock.mockRejectedValue(new NoSubtitlesError('missing'));
    const result = await resolveEnglishChineseSubtitles({ ...opts(), subtitleSource: 'existing_only' });
    expect(result.errors.en?.message).toMatch(/Existing-only skips host transcripts and ASR/);
    expect(result.errors.zh?.message).toMatch(/retry with Auto/);
    expect(resolveMock.mock.calls).toHaveLength(2);
  });

  it('runs configured ASR once in the selected spoken language, then translates', async () => {
    resolveMock.mockImplementation(async ({ lang, allowConfiguredAsr }: { lang: string; allowConfiguredAsr?: boolean }) => {
      if (lang === 'zh' && allowConfiguredAsr !== false) return { ...en, lang: 'zh', origin: 'asr' };
      throw new NoSubtitlesError('missing');
    });
    translateMock.mockResolvedValue([{ ...en.cues[0], text: 'Hello' }]);
    const result = await resolveEnglishChineseSubtitles({ ...opts(), sourceLanguage: 'zh' });
    expect(result.resolved.zh?.origin).toBe('asr');
    expect(result.resolved.en?.origin).toBe('translated_zh');
    expect(resolveMock.mock.calls).toHaveLength(3);
    expect(resolveMock.mock.calls[2][0]).toMatchObject({ lang: 'zh' });
    expect(translateMock).toHaveBeenCalledOnce();
  });
});
