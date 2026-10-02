import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: vi.fn(), count: vi.fn(), embed: vi.fn(), execute: vi.fn() }));
vi.mock('../es/client', () => ({ getEsClient: () => ({ search: mocks.search, count: mocks.count }) }));
vi.mock('./embed-audio', () => ({ embedQueryAudio: mocks.embed }));
vi.mock('../es/search', () => ({ executeChunkSearch: mocks.execute }));
import { assertVoiceVariant, searchAudioMoments } from './search-audio';
import { testVariant, testWav, voiceTestConfig } from './test-fixtures';
const cfg = voiceTestConfig(), variant = testVariant(cfg);
const input = { audio: testWav(), mode: 'sound_sample' as const, variantId: variant.variant_id, target: 'audio' as const, size: 20, videoId: null, filters: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.search.mockResolvedValue({ hits: { total: { value: 1, relation: 'eq' }, hits: [{ _source: { video_id: 'ready-video', variants: [variant] } }] } });
  mocks.count.mockResolvedValue({ count: 1 }); mocks.embed.mockResolvedValue({ vector: [1, 0] });
  mocks.execute.mockResolvedValue({ hits: [], rank_window_size: 50 });
});
describe('voice sound-search scope and identity', () => {
  it('checks recorded hash including proxy/chunk identity', () => {
    expect(() => assertVoiceVariant(variant, variant.variant_id, cfg)).not.toThrow();
    expect(() => assertVoiceVariant({ ...variant, proxy_settings: { ...variant.proxy_settings, video_frames: 99 } }, variant.variant_id, cfg)).toThrow();
    expect(() => assertVoiceVariant(variant, variant.variant_id, { ...cfg, EMBED_MODEL: 'other' })).toThrow();
  });
  it('accepts the baseline custom preset while still verifying its recorded hash', () => {
    const custom = testVariant({ ...cfg, CHUNK_PRESET: 'custom' });
    expect(() => assertVoiceVariant(custom, custom.variant_id, cfg)).not.toThrow();
    expect(() => assertVoiceVariant({ ...custom, chunk_window_ms: custom.chunk_window_ms + 1 }, custom.variant_id, cfg)).toThrow();
  });
  it('uses one audio query embedding and an explicit ready-ID filter', async () => {
    const signal = new AbortController().signal;
    const result = await searchAudioMoments(input, testWav(), 1200, cfg, signal);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0]).toMatchObject({ modality: 'audio', sortBy: 'audio', signal, requireCompleteResults: true,
      filters: [{ term: { variant_id: variant.variant_id } }, { terms: { video_id: ['ready-video'] } }], queryVectorMode: { kind: 'vector' } });
    expect(result.meta.audio_channel_status).toBe('ok');
  });
  it('empty scope spends no inference and does not broaden filters', async () => {
    mocks.search.mockResolvedValue({ hits: { total: { value: 0, relation: 'eq' }, hits: [] } });
    expect((await searchAudioMoments(input, testWav(), 1200, cfg, new AbortController().signal)).hits).toEqual([]);
    expect(mocks.embed).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('no indexed audio is distinct from ordinary empty hits and spends no embedding', async () => {
    mocks.count.mockResolvedValue({ count: 0 });
    expect((await searchAudioMoments(input, testWav(), 1200, cfg, new AbortController().signal)).meta.audio_channel_status).toBe('no_indexed_audio');
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it.each(['gte', 'oversize', 'missing', 'partial'])('fails closed on incomplete scope %s', async (reason) => {
    mocks.search.mockResolvedValue({ _shards: { failed: reason === 'partial' ? 1 : 0 }, hits: { total: reason === 'missing' ? undefined : { value: reason === 'oversize' ? 10001 : 1, relation: reason === 'gte' ? 'gte' : 'eq' }, hits: [] } });
    await expect(searchAudioMoments(input, testWav(), 1200, cfg, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it('keeps visual-only target explicit even with no indexed audio', async () => {
    mocks.count.mockResolvedValue({ count: 0 });
    await searchAudioMoments({ ...input, target: 'visual' }, testWav(), 1200, cfg, new AbortController().signal);
    expect(mocks.execute.mock.calls[0][0]).toMatchObject({ modality: 'visual', sortBy: 'visual' });
  });
});
