import { describe, expect, it } from 'vitest';
import {
  CHUNK_PRESET_DEFS,
  CHUNK_PRESET_NAMES,
  IMPORT_CHUNK_PRESET_NAMES,
  chunkingForPreset,
  deriveVariantId,
  formatChunkPresetLabel,
  resolveChunkingFromRequest,
  resolveCustomChunkingDraft,
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
    ASSET_SEMANTIC_ENABLED: false,
    QUERY_PARSER_PROVIDER: 'dictionary',
    QUERY_PARSER_INFERENCE_ID: '',
    QUERY_PARSER_TIMEOUT_MS: 800,
    QUERY_PARSER_MAX_TOKENS: 256,
    QUERY_PARSER_FACET_MODE: 'boost',
    QUERY_PARSER_CACHE_TTL_MS: 300_000,
    QUERY_PARSER_CACHE_MAX: 128,
    QUERY_PARSER_CONCURRENCY: 2,
    SUGGEST_WEB_PROVIDER: 'none',
    SUGGEST_WEB_TIMEOUT_MS: 6_000,
    SUGGEST_WEB_MAX_READS: 2,
    KIBANA_URL: '',
    KIBANA_API_KEY: '',
    SUGGEST_AGENT_ID: '',
    SUGGEST_AGENT_CONNECTOR_ID: '',
    ...overrides,
  } as AppConfig;
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
    // todo/42 Q1: the legacy `20s` is unchanged; the 3 s-overlap variant is a
    // separate id so existing 20s variants are not orphaned.
    expect(CHUNK_PRESET_DEFS['20s'].overlapMs).toBe(2_000);
    expect(CHUNK_PRESET_DEFS['20s_3s']).toEqual({
      windowMs: 20_000,
      overlapMs: 3_000,
      minMs: 2_000,
    });
    expect(CHUNK_PRESET_DEFS.fine.windowMs).toBe(10_000);
    expect(CHUNK_PRESET_DEFS['5s']).toEqual({
      windowMs: 5_000,
      overlapMs: 2_000,
      minMs: 1_000,
    });
    expect(CHUNK_PRESET_DEFS['2s']).toEqual({
      windowMs: 2_000,
      overlapMs: 1_000,
      minMs: 1_000,
    });
  });

  it('exposes the custom id only on the internal list', () => {
    expect(CHUNK_PRESET_NAMES).toContain('5s');
    expect(CHUNK_PRESET_NAMES).toContain('20s_3s');
    expect(CHUNK_PRESET_NAMES).toContain('custom');
    expect(IMPORT_CHUNK_PRESET_NAMES).toEqual([
      'standard',
      '60s',
      '30s',
      '20s',
      '20s_3s',
      'fine',
      '5s',
      '2s',
    ]);
    expect(IMPORT_CHUNK_PRESET_NAMES).not.toContain('custom');
  });

  it('resolves named preset from request', () => {
    expect(resolveChunkingFromRequest({ chunk_preset: '30s' })).toEqual(
      chunkingForPreset('30s'),
    );
    expect(resolveChunkingFromRequest({ chunk_preset: '2s' })).toEqual(
      chunkingForPreset('2s'),
    );
    expect(resolveChunkingFromRequest({ chunk_preset: '5s' })).toEqual(
      chunkingForPreset('5s'),
    );
    expect(resolveChunkingFromRequest({ chunk_preset: '20s_3s' })).toEqual(
      chunkingForPreset('20s_3s'),
    );
  });

  it('rejects an unknown named preset', () => {
    expect(() => resolveChunkingFromRequest({ chunk_preset: 'nope' })).toThrow(
      'INVALID_CHUNK_PRESET',
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
    // min_ms default: min(4s, max(1s, floor(window / 5))) = 4s for a 45s window.
    expect(c?.minMs).toBe(4_000);
  });

  it('defaults custom min_ms from the window', () => {
    expect(
      resolveChunkingFromRequest({ window_ms: 20_000, overlap_ms: 3_000 })
        ?.minMs,
    ).toBe(4_000);
    expect(
      resolveChunkingFromRequest({ window_ms: 3_000, overlap_ms: 1_000 })
        ?.minMs,
    ).toBe(1_000);
    // Explicit min_ms wins over the default.
    expect(
      resolveChunkingFromRequest({
        window_ms: 20_000,
        overlap_ms: 3_000,
        min_ms: 2_500,
      })?.minMs,
    ).toBe(2_500);
  });

  it('rejects invalid custom pairs', () => {
    // window == overlap
    expect(() =>
      resolveChunkingFromRequest({ window_ms: 5_000, overlap_ms: 5_000 }),
    ).toThrow('INVALID_CHUNKING');
    // overlap > window
    expect(() =>
      resolveChunkingFromRequest({ window_ms: 5_000, overlap_ms: 6_000 }),
    ).toThrow('INVALID_CHUNKING');
    // non-positive window
    expect(() =>
      resolveChunkingFromRequest({ window_ms: 0, overlap_ms: 0 }),
    ).toThrow('INVALID_CHUNKING');
    // negative overlap
    expect(() =>
      resolveChunkingFromRequest({ window_ms: 5_000, overlap_ms: -1 }),
    ).toThrow('INVALID_CHUNKING');
  });

  it('returns null when no chunking fields are given', () => {
    expect(resolveChunkingFromRequest({})).toBeNull();
  });

  it('produces distinct variant_ids per preset', () => {
    const cfg = minimalConfig();
    const names = [
      'standard',
      '60s',
      '30s',
      '20s',
      '20s_3s',
      'fine',
      '5s',
      '2s',
    ] as const;
    const ids = names.map((p) =>
      deriveVariantId(
        variantConfigFromApp(cfg, { chunking: chunkingForPreset(p) }),
      ),
    );
    expect(new Set(ids).size).toBe(names.length);
    // The 20s / 20s_3s pair must not collide despite the shared window.
    expect(ids[3]).not.toBe(ids[4]);
  });

  it('formats labels with window/overlap', () => {
    expect(formatChunkPresetLabel('60s')).toBe('60s · 60s/4s');
    expect(formatChunkPresetLabel('fine', 10_000, 2_000)).toBe('fine · 10s/2s');
    expect(formatChunkPresetLabel('2s')).toBe('2s · 2s/1s');
    expect(formatChunkPresetLabel('5s')).toBe('5s · 5s/2s');
    expect(formatChunkPresetLabel('20s_3s')).toBe('20s_3s · 20s/3s');
  });
});

describe('resolveCustomChunkingDraft — import UI', () => {
  it('accepts a valid second-valued pair', () => {
    expect(resolveCustomChunkingDraft('20', '3')).toEqual({
      windowMs: 20_000,
      overlapMs: 3_000,
    });
    expect(resolveCustomChunkingDraft(5, 0)).toEqual({
      windowMs: 5_000,
      overlapMs: 0,
    });
  });

  it('rejects overlap >= window', () => {
    expect(resolveCustomChunkingDraft('10', '10')).toBeNull();
    expect(resolveCustomChunkingDraft('10', '11')).toBeNull();
  });

  it('rejects zero/negative window and negative overlap', () => {
    expect(resolveCustomChunkingDraft('0', '0')).toBeNull();
    expect(resolveCustomChunkingDraft('-5', '1')).toBeNull();
  });

  it('rejects non-integer or empty input', () => {
    expect(resolveCustomChunkingDraft('', '1')).toBeNull();
    expect(resolveCustomChunkingDraft('20', '')).toBeNull();
    expect(resolveCustomChunkingDraft('1.5', '1')).toBeNull();
    expect(resolveCustomChunkingDraft('20s', '1')).toBeNull();
  });
});
