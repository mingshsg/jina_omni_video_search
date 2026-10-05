import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SrtCue } from './srt';

const getMappingMock = vi.fn();
const putMappingMock = vi.fn();
const providerIdentity = { provider: 'jina', model: 'omni', task: 'retrieval', dims: 2, normalizedBy: 'application' };
const bulkMock = vi.fn(async (_request: { operations: unknown[] }) => ({ errors: false, items: [] }));
const deleteByQueryMock = vi.fn(async (_request: { query: unknown }) => ({ deleted: 3 }));
const embedTextMock = vi.fn(async (text: string) => ({
  embedding: [0.1, 0.2],
  text,
}));

vi.mock('../config', () => ({
  getConfig: () => ({}),
}));

vi.mock('./env', () => ({
  getDramaEnv: () => ({
    DRAMA_SUBTITLE_EMBED_MAX: 400,
    ES_INDEX_DRAMA_SUBTITLES: 'video-drama-subtitles',
  }),
}));

vi.mock('../embed/provider', () => ({
  createEmbeddingProvider: () => ({ ...providerIdentity, embedText: embedTextMock }),
}));

vi.mock('../es/client', () => ({
  getEsClient: () => ({ bulk: bulkMock, deleteByQuery: deleteByQueryMock, indices: { getMapping: getMappingMock, putMapping: putMappingMock } }),
}));

import {
  indexDramaSubtitles,
  reconcileSubtitleLang,
  retireOldSubtitleGenerations,
} from './index-subtitles';

function cue(i: number): SrtCue {
  return { index: i, startMs: i * 1000, endMs: i * 1000 + 800, text: `line ${i}` };
}

describe('indexDramaSubtitles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMappingMock.mockResolvedValue({ subtitles: { mappings: { properties: { text_embedding: { type: 'dense_vector', dims: 2 }, text_embedding_variant: { type: 'keyword' } } } } });
    putMappingMock.mockResolvedValue({ acknowledged: true });
    providerIdentity.model = 'omni';
    bulkMock.mockResolvedValue({ errors: false, items: [] });
  });

  it('indexes every cue and caps only vector inference at 400', async () => {
    const cues = Array.from({ length: 401 }, (_, i) => cue(i + 1));
    const res = await indexDramaSubtitles({
      videoId: 'vid1',
      runId: 'run1',
      lang: 'zh',
      cues,
      source: 'asr',
    });
    expect(res.indexed).toBe(401);
    expect(res.embedded).toBe(400);
    expect(embedTextMock).toHaveBeenCalledTimes(400);
    expect(bulkMock).toHaveBeenCalledTimes(1);
    const ops = bulkMock.mock.calls[0][0].operations as unknown[];
    // 2 bulk operations per doc (action + body)
    expect(ops).toHaveLength(802);
    const lastBody = ops[ops.length - 1] as Record<string, unknown>;
    expect(lastBody.text).toBe('line 401');
    expect(lastBody).not.toHaveProperty('text_embedding');
    const firstBody = ops[1] as Record<string, unknown>;
    expect(firstBody).toHaveProperty('text_embedding');
  });

  it('embeds all cues when under the cap', async () => {
    const cues = [cue(1), cue(2)];
    const res = await indexDramaSubtitles({
      videoId: 'vid1',
      runId: 'run1',
      lang: 'en',
      cues,
      source: 'asr',
    });
    expect(res.indexed).toBe(2);
    expect(res.embedded).toBe(2);
    expect(res.ids).toHaveLength(2);
    expect(embedTextMock).toHaveBeenCalledTimes(2);
  });

  it.each(['ko', 'th'] as const)('retains %s on timed subtitle documents', async (lang) => {
    await indexDramaSubtitles({
      videoId: 'vid1',
      runId: 'run1',
      lang,
      cues: [cue(1)],
      source: 'openai',
    });
    const ops = bulkMock.mock.calls[0][0].operations as unknown[];
    const action = ops[0] as { index: { _id: string } };
    const body = ops[1] as Record<string, unknown>;
    expect(action.index._id).toContain(`_${lang}_`);
    expect(body).toMatchObject({ lang, start_ms: 1000, end_ms: 1800 });
  });

  it('embeds the generation ID in every document ID', async () => {
    const cues = [cue(1)];
    await indexDramaSubtitles({
      videoId: 'vid1',
      runId: 'runAAA',
      lang: 'zh',
      cues,
      source: 'asr',
    });
    const ops = bulkMock.mock.calls[0][0].operations as unknown[];
    // Action entries carry the _id; all belong to this run generation.
    const ids = ops
      .filter((_, i) => i % 2 === 0)
      .map((a) => (a as { index: { _id: string } }).index._id);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain('runAAA');
  });

  it('retires other generations while keeping the current run (F1)', async () => {
    const res = await retireOldSubtitleGenerations({
      videoId: 'vid1',
      keepRunId: 'runB',
    });
    expect(res).toEqual({ deleted: 3 });
    const query = deleteByQueryMock.mock.calls[0][0].query as {
      bool: { must: unknown[]; must_not: unknown[] };
    };
    expect(query.bool.must).toEqual([{ term: { video_id: 'vid1' } }]);
    expect(query.bool.must_not).toEqual([{ term: { run_id: 'runB' } }]);
  });

  it('treats retirement failure as zero deletions, never a throw', async () => {
    deleteByQueryMock.mockRejectedValueOnce(new Error('ES down'));
    const res = await retireOldSubtitleGenerations({
      videoId: 'vid1',
      keepRunId: 'runB',
    });
    expect(res).toEqual({ deleted: 0 });
  });

  it('retires only the switched language generation (I2)', async () => {
    const res = await retireOldSubtitleGenerations({
      videoId: 'vid1',
      keepRunId: 'runB',
      lang: 'zh',
    });
    expect(res).toEqual({ deleted: 3 });
    const query = deleteByQueryMock.mock.calls[0][0].query as {
      bool: { must: unknown[]; must_not: unknown[] };
    };
    expect(query.bool.must).toEqual([
      { term: { video_id: 'vid1' } },
      { term: { lang: 'zh' } },
    ]);
    expect(query.bool.must_not).toEqual([{ term: { run_id: 'runB' } }]);
  });

  it('reconciles same-run stale cues by seg_id (I2)', async () => {
    const res = await reconcileSubtitleLang({
      videoId: 'vid1',
      runId: 'runB',
      lang: 'zh',
      keepSegIds: ['zh_1_0', 'zh_2_2000'],
    });
    expect(res).toEqual({ deleted: 3 });
    const query = deleteByQueryMock.mock.calls[0][0].query as {
      bool: { must: unknown[]; must_not: unknown[] };
    };
    expect(query.bool.must).toEqual([
      { term: { video_id: 'vid1' } },
      { term: { run_id: 'runB' } },
      { term: { lang: 'zh' } },
    ]);
    expect(query.bool.must_not).toEqual([
      { terms: { seg_id: ['zh_1_0', 'zh_2_2000'] } },
    ]);
  });

  it('refuses to reconcile with an empty keep-set', async () => {
    vi.clearAllMocks();
    const res = await reconcileSubtitleLang({
      videoId: 'vid1',
      runId: 'runB',
      lang: 'zh',
      keepSegIds: [],
    });
    expect(res).toEqual({ deleted: 0 });
    expect(deleteByQueryMock).not.toHaveBeenCalled();
  });
});

describe('subtitle vector identity and mapping compatibility', () => {
  const indexOne = () => indexDramaSubtitles({ videoId: 'vid1', runId: 'run1', lang: 'en', cues: [cue(1)], source: 'asr' });
  beforeEach(() => {
    vi.clearAllMocks(); providerIdentity.model = 'omni';
    getMappingMock.mockResolvedValue({ subtitles: { mappings: { properties: { text_embedding: { type: 'dense_vector', dims: 2 }, text_embedding_variant: { type: 'keyword' } } } } });
    bulkMock.mockResolvedValue({ errors: false, items: [] });
  });
  it('tags vectors with provider identity and changes the tag with the model', async () => {
    await indexOne();
    const first = bulkMock.mock.calls[0][0].operations[1] as Record<string, unknown>;
    providerIdentity.model = 'other-model'; await indexOne();
    const second = bulkMock.mock.calls[1][0].operations[1] as Record<string, unknown>;
    expect(first.text_embedding_variant).toMatch(/^[a-f0-9]{16}$/);
    expect(first.text_embedding_variant).not.toBe(second.text_embedding_variant);
  });
  it('keeps all cues lexical when index dimensions differ, without charging inference', async () => {
    getMappingMock.mockResolvedValueOnce({ subtitles: { mappings: { properties: { text_embedding: { type: 'dense_vector', dims: 1024 } } } } });
    expect(await indexOne()).toMatchObject({ indexed: 1, embedded: 0 });
    expect(embedTextMock).not.toHaveBeenCalled();
    expect(bulkMock.mock.calls[0][0].operations[1]).not.toHaveProperty('text_embedding_variant');
  });
  it('adds the identity mapping to an existing compatible strict index', async () => {
    getMappingMock.mockResolvedValueOnce({ subtitles: { mappings: { properties: { text_embedding: { type: 'dense_vector', dims: 2 } } } } });
    await indexOne();
    expect(putMappingMock).toHaveBeenCalledWith({ index: 'video-drama-subtitles', properties: { text_embedding_variant: { type: 'keyword' } } });
  });
  it('falls back to lexical indexing when mapping inspection is unavailable', async () => {
    getMappingMock.mockRejectedValueOnce(new Error('permission denied'));
    expect(await indexOne()).toMatchObject({ indexed: 1, embedded: 0 });
    expect(embedTextMock).not.toHaveBeenCalled();
  });
});
