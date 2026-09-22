import { describe, expect, it } from 'vitest';
import {
  CHUNK_PRESET_DEFS,
  chunkingForPreset,
  deriveVariantId,
  formatChunkPresetLabel,
  resolveChunkingFromRequest,
  variantConfigFromApp,
} from './variant';
import type { AppConfig } from '../config';

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

describe('chunk presets', () => {
  it('defines expected windows for import presets', () => {
    expect(CHUNK_PRESET_DEFS.standard.windowMs).toBe(64_000);
    expect(CHUNK_PRESET_DEFS['60s'].windowMs).toBe(60_000);
    expect(CHUNK_PRESET_DEFS['30s']).toEqual({
      windowMs: 30_000,
      overlapMs: 4_000,
      minMs: 4_000,
    });
    expect(CHUNK_PRESET_DEFS['20s'].overlapMs).toBe(2_000);
    expect(CHUNK_PRESET_DEFS.fine.windowMs).toBe(10_000);
    expect(CHUNK_PRESET_DEFS['2s']).toEqual({
      windowMs: 2_000,
      overlapMs: 1_000,
      minMs: 1_000,
    });
  });

  it('resolves named preset from request', () => {
    expect(resolveChunkingFromRequest({ chunk_preset: '30s' })).toEqual(
      chunkingForPreset('30s'),
    );
    expect(resolveChunkingFromRequest({ chunk_preset: '2s' })).toEqual(
      chunkingForPreset('2s'),
    );
  });

  it('resolves custom window/overlap', () => {
    const c = resolveChunkingFromRequest({
      window_ms: 45_000,
      overlap_ms: 3_000,
    });
    expect(c?.preset).toBe('custom');
    expect(c?.windowMs).toBe(45_000);
    expect(c?.overlapMs).toBe(3_000);
  });

  it('produces distinct variant_ids per preset', () => {
    const cfg = minimalConfig();
    const ids = (
      ['standard', '60s', '30s', '20s', 'fine', '2s'] as const
    ).map((p) =>
      deriveVariantId(
        variantConfigFromApp(cfg, { chunking: chunkingForPreset(p) }),
      ),
    );
    expect(new Set(ids).size).toBe(6);
  });

  it('formats labels with window/overlap', () => {
    expect(formatChunkPresetLabel('60s')).toBe('60s · 60s/4s');
    expect(formatChunkPresetLabel('fine', 10_000, 2_000)).toBe('fine · 10s/2s');
    expect(formatChunkPresetLabel('2s')).toBe('2s · 2s/1s');
  });
});
