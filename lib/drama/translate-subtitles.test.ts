import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SrtCue } from './srt';

const chatMock = vi.fn();
vi.mock('./eis-chat', () => ({ callDramaEisChat: (...args: unknown[]) => chatMock(...args) }));

import { translateSubtitleCues } from './translate-subtitles';

const cues: SrtCue[] = Array.from({ length: 13 }, (_, i) => ({
  index: i + 1,
  startMs: i * 2000,
  endMs: i * 2000 + 1500,
  text: `Line ${i + 1}`,
}));

describe('timed subtitle translation', () => {
  beforeEach(() => chatMock.mockReset());

  it('translates in bounded batches and preserves every cue boundary and index', async () => {
    chatMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ translations: Array.from({ length: 12 }, (_, id) => ({ id, text: `译文 ${id}` })) }),
        usage: {},
      })
      .mockResolvedValueOnce({ text: '{"translations":[{"id":12,"text":"译文 12"}]}', usage: {} });
    const result = await translateSubtitleCues({ cues, from: 'en', to: 'zh' });
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(chatMock.mock.calls[1][0].messages[1].content).lines).toEqual([{ id: 12, text: 'Line 13' }]);
    expect(result).toHaveLength(13);
    expect(result[12]).toEqual({ ...cues[12], text: '译文 12' });
  });

  it('refuses missing translations instead of publishing partial subtitles', async () => {
    chatMock.mockResolvedValue({ text: '{"translations":[]}', usage: {} });
    await expect(translateSubtitleCues({ cues: cues.slice(0, 2), from: 'en', to: 'zh' }))
      .rejects.toThrow(/incomplete batch/);
  });

  it('refuses repeated or unexpected cue IDs', async () => {
    chatMock.mockResolvedValue({ text: '{"translations":[{"id":0,"text":"甲"},{"id":0,"text":"乙"}]}', usage: {} });
    await expect(translateSubtitleCues({ cues: cues.slice(0, 2), from: 'en', to: 'zh' }))
      .rejects.toThrow(/incomplete batch/);
  });

  it('splits an incomplete model batch and still preserves all cue times', async () => {
    chatMock
      .mockResolvedValueOnce({ text: '{"translations":[]}', usage: {} })
      .mockResolvedValueOnce({ text: JSON.stringify({ translations: Array.from({ length: 6 }, (_, id) => ({ id, text: `译文 ${id}` })) }), usage: {} })
      .mockResolvedValueOnce({ text: JSON.stringify({ translations: Array.from({ length: 6 }, (_, i) => ({ id: i + 6, text: `译文 ${i + 6}` })) }), usage: {} });
    const result = await translateSubtitleCues({ cues: cues.slice(0, 12), from: 'en', to: 'zh' });
    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(12);
    expect(result[11]).toEqual({ ...cues[11], text: '译文 11' });
  });
});
