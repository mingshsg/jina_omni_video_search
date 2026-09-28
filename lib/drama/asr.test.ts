import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('./env', () => ({
  getDramaEnv: () => ({
    DRAMA_ASR_API_KEY: 'test-key',
    DRAMA_ASR_API_URL: '',
    DRAMA_ASR_MODEL: 'whisper-1',
    DRAMA_WHISPER_BIN: '/fake/whisper',
  }),
}));

import { transcribeWithOpenAiCompatible, transcribeWithWhisperCli } from './asr';

describe('R8 transcribeWithOpenAiCompatible', () => {
  const fetchMock = vi.fn();
  let audioPath = '';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    audioPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'drama-r8-')), 'a.mp3');
    fs.writeFileSync(audioPath, 'fakeaudio');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(path.dirname(audioPath), { recursive: true, force: true });
  });

  it('builds timed cues from segments', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [
          { start: 1.0, end: 2.5, text: '你好' },
          { start: 3.0, end: 4.0, text: '再见' },
        ],
      }),
    });
    const { cues } = await transcribeWithOpenAiCompatible({ audioPath, lang: 'zh' });
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 2500, text: '你好' });
  });

  it.each([
    ['ko', '안녕하세요'],
    ['th', 'สวัสดี'],
  ] as const)('requests %s ASR and keeps native-language cues', async (lang, text) => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ segments: [{ start: 2, end: 3, text }] }),
    });
    const result = await transcribeWithOpenAiCompatible({ audioPath, lang });
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get('language')).toBe(lang);
    expect(body.get('prompt')).toBeNull();
    expect(result.cues[0]).toMatchObject({ startMs: 2000, endMs: 3000, text });
  });

  it.each([
    ['ko', '안녕하세요'],
    ['th', 'สวัสดี'],
  ] as const)('passes %s and transcribe to local Whisper', async (lang, text) => {
    spawnMock.mockImplementationOnce((_bin: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        const outDir = args[args.indexOf('--output_dir') + 1];
        fs.writeFileSync(
          path.join(outDir, 'a.srt'),
          `1\n00:00:01,000 --> 00:00:02,000\n${text}\n`,
        );
        child.emit('close', 0);
      });
      return child;
    });
    const result = await transcribeWithWhisperCli({
      audioPath,
      lang,
      outDir: path.dirname(audioPath),
    });
    expect(spawnMock.mock.calls[0][0]).toBe('/fake/whisper');
    expect(spawnMock.mock.calls[0][1]).toContain(lang);
    expect(spawnMock.mock.calls[0][1]).toContain('transcribe');
    expect(result.cues[0].text).toBe(text);
  });

  it('refuses untimed text instead of fabricating a 0–1000ms cue', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'a whole episode of dialogue with no timing' }),
    });
    await expect(
      transcribeWithOpenAiCompatible({ audioPath, lang: 'zh' }),
    ).rejects.toThrow(/without timed segments/i);
  });
});
