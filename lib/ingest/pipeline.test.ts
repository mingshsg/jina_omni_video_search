import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config';
import { estimateWorkload } from './pipeline';

function minimalConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ELASTICSEARCH_URL: 'https://example.test',
    ELASTICSEARCH_API_KEY: 'test',
    ES_INDEX_ASSETS: 'video-assets',
    ES_INDEX_CHUNKS: 'video-chunks',
    EMBED_PROVIDER: 'eis',
    EMBED_INFERENCE_ID: '.jina-embeddings-v5-omni-small',
    EMBED_MODEL: 'jina-embeddings-v5-omni-small',
    EMBED_TASK_PASSAGE: 'retrieval.passage',
    EMBED_TASK_QUERY: 'retrieval.query',
    EMBED_DIMS: 1024,
    EIS_MAX_BINARY_BYTES: 1_048_576,
    JINA_MAX_BINARY_BYTES: undefined,
    LOCAL_MAX_BINARY_BYTES: undefined,
    EMBED_BUDGET_BYTE_LAYER: 'decoded_media',
    EMBED_VIDEO_FRAMES: 32,
    EMBED_MAX_LONG_EDGE: 1280,
    EMBED_CONCURRENCY: 3,
    JINA_API_KEY: '',
    LOCAL_EMBED_URL: '',
    CHUNK_PRESET: 'standard',
    CHUNK_WINDOW_MS: 64_000,
    CHUNK_OVERLAP_MS: 4_000,
    CHUNK_MIN_MS: 4_000,
    SEARCH_RANK_WINDOW_SIZE: 50,
    SEARCH_RANK_CONSTANT: 60,
    SEARCH_WEIGHT_VIDEO: 1,
    SEARCH_WEIGHT_AUDIO: 1,
    MEDIA_ROOT: './data',
    LOCAL_IMPORT_ROOT: undefined,
    MAX_SOURCE_BYTES: 2_147_483_648,
    PLAYBACK_MAX_HEIGHT: 720,
    DEFAULT_LOCALE: 'zh',
    SCHEMA_VERSION: '1',
    ...overrides,
  };
}

describe('estimateWorkload', () => {
  it('counts 2 inference calls per window when audio is present', () => {
    // 158 s trailer ≈ 3 windows at 64/4
    const { windows, workload } = estimateWorkload(
      158_000,
      true,
      minimalConfig(),
    );
    expect(windows.length).toBe(3);
    expect(workload.windows).toBe(3);
    expect(workload.inference_calls).toBe(6);
    expect(workload.has_audio).toBe(true);
  });

  it('counts 1 inference call per window without audio', () => {
    const { workload } = estimateWorkload(30_000, false, minimalConfig());
    expect(workload.windows).toBe(1);
    expect(workload.inference_calls).toBe(1);
  });
});
