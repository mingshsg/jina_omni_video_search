import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../es/client', () => ({ getEsClient: () => ({ search: mocks.search }) }));
import { executeChunkSearch } from '../es/search';
import { voiceTestConfig } from './test-fixtures';

beforeEach(() => {
  mocks.search.mockReset().mockResolvedValue({ hits: { hits: [{ _id: 'moment', _score: 0.8,
    _source: { video_id: 'video', variant_id: 'variant', chunk_index: 1, start_ms: 1000, end_ms: 2000, video_title: 'Title' } }] } });
});
describe('shared search preserves legacy file/image/live calls', () => {
  it.each(['visual', 'audio', 'both'] as const)('keeps response and request body identical with optional cancellation: %s', async (modality) => {
    const cfg = voiceTestConfig();
    const params = { index: 'chunks', modality, size: 2, filters: [{ term: { variant_id: 'variant' } }],
      sourceFields: ['video_id', 'variant_id', 'chunk_index', 'start_ms', 'end_ms', 'video_title'],
      queryVectorMode: { kind: 'vector' as const, vector: [1, 0] } };
    const legacy = await executeChunkSearch(params, cfg);
    const calls = [...mocks.search.mock.calls];
    expect(calls.length).toBe(modality === 'both' ? 3 : 1);
    for (const call of calls) expect(call).toHaveLength(1);
    mocks.search.mockClear();
    const signal = new AbortController().signal;
    const cancellable = await executeChunkSearch({ ...params, signal }, cfg);
    expect({ ...cancellable, took_ms: 0 }).toEqual({ ...legacy, took_ms: 0 });
    expect(cancellable.hits[0]).toMatchObject({ chunk_id: 'moment', video_id: 'video', variant_id: 'variant', start_ms: 1000 });
    expect(mocks.search.mock.calls.map(call => call[0])).toEqual(calls.map(call => call[0]));
    for (const call of mocks.search.mock.calls) expect(call[1]).toEqual({ signal });
  });
  it('retains text query-vector-builder and its one-argument transport', async () => {
    await executeChunkSearch({ index: 'chunks', modality: 'visual', filters: [], sourceFields: [],
      queryVectorMode: { kind: 'builder', inferenceId: 'endpoint', input: 'a car chase' } }, voiceTestConfig());
    expect(mocks.search.mock.calls[0]).toHaveLength(1);
    expect(mocks.search.mock.calls[0][0].retriever.knn.query_vector_builder).toEqual({ embedding: { inference_id: 'endpoint', input: 'a car chase' } });
  });
});
