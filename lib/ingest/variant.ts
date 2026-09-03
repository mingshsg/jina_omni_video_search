import { createHash } from 'node:crypto';
import type { AppConfig } from '../config';
import {
  type ChunkingConfig,
  type ChunkPreset,
} from './chunk-presets';

export type {
  ChunkingConfig,
  ChunkPreset,
  ImportChunkPreset,
} from './chunk-presets';
export {
  CHUNK_PRESET_DEFS,
  CHUNK_PRESET_NAMES,
  IMPORT_CHUNK_PRESET_NAMES,
  chunkingForPreset,
  formatChunkPresetLabel,
  isImportChunkPreset,
  resolveChunkingFromRequest,
} from './chunk-presets';

/** Resolution long-edge rungs (outer loop in proxy encoder). */
export const DEFAULT_RESOLUTION_LADDER = [1280, 960, 854, 720, 640] as const;

/** CRF rungs (inner loop in proxy encoder). */
export const DEFAULT_CRF_LADDER = [23, 26, 28, 30, 32] as const;

export type EmbedProvider = 'eis' | 'jina' | 'local';
export type NormalizedBy = 'provider' | 'application';

export interface ProxySettings {
  videoFrames: number;
  maxLongEdge: number;
  resolutionLadder: readonly number[];
  crfLadder: readonly number[];
}

export interface VariantConfig {
  chunking: ChunkingConfig;
  provider: EmbedProvider;
  model: string;
  task: string;
  dims: number;
  normalizedBy: NormalizedBy;
  proxySettings: ProxySettings;
  schemaVersion: string;
}

/** Canonical payload hashed into `variant_id`. Keys are sorted for stability. */
function canonicalVariantPayload(config: VariantConfig): string {
  const payload = {
    chunk_overlap_ms: config.chunking.overlapMs,
    chunk_min_ms: config.chunking.minMs,
    chunk_preset: config.chunking.preset,
    chunk_window_ms: config.chunking.windowMs,
    crf_ladder: [...config.proxySettings.crfLadder],
    dims: config.dims,
    max_long_edge: config.proxySettings.maxLongEdge,
    model: config.model,
    normalized_by: config.normalizedBy,
    provider: config.provider,
    resolution_ladder: [...config.proxySettings.resolutionLadder],
    schema_version: config.schemaVersion,
    task: config.task,
    video_frames: config.proxySettings.videoFrames,
  };
  return JSON.stringify(payload);
}

/**
 * Derive a stable variant identity from chunking, provider stack, proxy
 * settings, and schema version (FR-19).
 */
export function deriveVariantId(config: VariantConfig): string {
  return createHash('sha256')
    .update(canonicalVariantPayload(config))
    .digest('hex')
    .slice(0, 16);
}

/** Chunk document `_id` — upserts on re-ingest of the same variant (FR-12). */
export function chunkDocumentId(
  videoId: string,
  variantId: string,
  chunkIndex: number,
): string {
  return `${videoId}_${variantId}_${chunkIndex}`;
}

export function defaultProxySettings(cfg: AppConfig): ProxySettings {
  return {
    videoFrames: cfg.EMBED_VIDEO_FRAMES,
    maxLongEdge: cfg.EMBED_MAX_LONG_EDGE,
    resolutionLadder: DEFAULT_RESOLUTION_LADDER,
    crfLadder: DEFAULT_CRF_LADDER,
  };
}

export function chunkingFromConfig(cfg: AppConfig): ChunkingConfig {
  return {
    preset: cfg.CHUNK_PRESET as ChunkPreset,
    windowMs: cfg.CHUNK_WINDOW_MS,
    overlapMs: cfg.CHUNK_OVERLAP_MS,
    minMs: cfg.CHUNK_MIN_MS,
  };
}

/** Normalization owner per provider stack (FR-9 / C3). */
export function normalizedByForProvider(provider: EmbedProvider): NormalizedBy {
  switch (provider) {
    case 'eis':
    case 'jina':
      return 'provider';
    case 'local':
      return 'application';
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** Build variant config from validated application config + provider overrides. */
export function variantConfigFromApp(
  cfg: AppConfig,
  overrides?: Partial<
    Pick<VariantConfig, 'provider' | 'task' | 'normalizedBy' | 'chunking'>
  >,
): VariantConfig {
  const provider = overrides?.provider ?? cfg.EMBED_PROVIDER;
  const normalizedBy: NormalizedBy =
    overrides?.normalizedBy ?? normalizedByForProvider(provider);

  return {
    chunking: overrides?.chunking ?? chunkingFromConfig(cfg),
    provider,
    model: cfg.EMBED_MODEL,
    task: overrides?.task ?? cfg.EMBED_TASK_PASSAGE,
    dims: cfg.EMBED_DIMS,
    normalizedBy,
    proxySettings: defaultProxySettings(cfg),
    schemaVersion: cfg.SCHEMA_VERSION,
  };
}

/** Proxy settings object shape stored on asset variant nested docs. */
export function proxySettingsForEs(settings: ProxySettings): {
  video_frames: number;
  max_long_edge: number;
  resolution_ladder: number[];
  crf_ladder: number[];
} {
  return {
    video_frames: settings.videoFrames,
    max_long_edge: settings.maxLongEdge,
    resolution_ladder: [...settings.resolutionLadder],
    crf_ladder: [...settings.crfLadder],
  };
}
