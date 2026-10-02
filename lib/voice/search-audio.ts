import { z } from 'zod';
import type { AppConfig } from '../config';
import { getEsClient } from '../es/client';
import { executeChunkSearch } from '../es/search';
import { FILE_SOURCE_FIELDS, effectiveRankWindowSize } from '../es/search-core';
import { buildAssetEligibilityFilters, buildChunkFilters, FILTER_SCOPE_CAP } from '../metadata/search-filters';
import { deriveVariantId } from '../ingest/variant';
import { CHUNK_PRESET_NAMES } from '../ingest/chunk-presets';
import type { VoiceRequest } from './request';
import type { VoiceMoments } from './types';
import { VoiceError } from './errors';
import { embedQueryAudio } from './embed-audio';

const variantSchema = z.object({
  variant_id: z.string(), status: z.literal('ready'),
  provider: z.enum(['eis', 'jina', 'local']), model: z.string().min(1), task: z.string().min(1), dims: z.number().int().positive(),
  normalized_by: z.enum(['provider', 'application']), schema_version: z.string().min(1),
  chunk_preset: z.enum(CHUNK_PRESET_NAMES),
  chunk_window_ms: z.number().int().positive(), chunk_overlap_ms: z.number().int().nonnegative(), chunk_min_ms: z.number().int().positive(),
  proxy_settings: z.object({ video_frames: z.number().int().positive(), max_long_edge: z.number().int().positive(), resolution_ladder: z.array(z.number()).min(1), crf_ladder: z.array(z.number()).min(1) }),
});

export function assertVoiceVariant(raw: unknown, id: string, cfg: AppConfig): void {
  const parsed = variantSchema.safeParse(raw);
  if (!parsed.success) throw new VoiceError('VOICE_VARIANT_MISMATCH', 'Variant identity is missing or invalid.', 409);
  const v = parsed.data;
  const expectedNormalization = cfg.EMBED_PROVIDER === 'local' ? 'application' : 'provider';
  const reconstructed = deriveVariantId({ provider: v.provider, model: v.model, task: v.task, dims: v.dims, normalizedBy: v.normalized_by,
    schemaVersion: v.schema_version, chunking: { preset: v.chunk_preset, windowMs: v.chunk_window_ms, overlapMs: v.chunk_overlap_ms, minMs: v.chunk_min_ms },
    proxySettings: { videoFrames: v.proxy_settings.video_frames, maxLongEdge: v.proxy_settings.max_long_edge, resolutionLadder: v.proxy_settings.resolution_ladder, crfLadder: v.proxy_settings.crf_ladder } });
  if (v.variant_id !== id || reconstructed !== id || v.provider !== cfg.EMBED_PROVIDER || v.model !== cfg.EMBED_MODEL ||
      v.task !== cfg.EMBED_TASK_PASSAGE || v.dims !== cfg.EMBED_DIMS || v.normalized_by !== expectedNormalization)
    throw new VoiceError('VOICE_VARIANT_MISMATCH', 'Select a variant compatible with the active embedding provider.', 409);
}

type ScopeAsset = { video_id: string; variants: unknown[] };
export async function searchAudioMoments(request: Extract<VoiceRequest, { mode: 'sound_sample' }>, wav: Buffer, durationMs: number, cfg: AppConfig, signal: AbortSignal): Promise<VoiceMoments> {
  const start = performance.now();
  const client = getEsClient();
  const scope = await client.search<ScopeAsset>({ index: cfg.ES_INDEX_ASSETS, size: FILTER_SCOPE_CAP, track_total_hits: true,
    _source: ['video_id', 'variants'], query: { bool: { filter: buildAssetEligibilityFilters(request.variantId, request.filters, request.videoId) } } }, { signal });
  const total = scope.hits.total;
  if (scope.timed_out || (scope._shards?.failed ?? 0) > 0 || !total || typeof total === 'number' || total.relation !== 'eq' || total.value > FILTER_SCOPE_CAP || scope.hits.hits.length !== total.value)
    throw new VoiceError('VOICE_INVALID_REQUEST', 'Search scope is incomplete or too broad. Narrow your filters.');
  const ids: string[] = [];
  for (const hit of scope.hits.hits) {
    const asset = hit._source;
    if (!asset?.video_id || !Array.isArray(asset.variants)) throw new VoiceError('VOICE_VARIANT_MISMATCH', 'Variant evidence is missing.', 409);
    const variants = asset.variants.filter((v) => v && typeof v === 'object' && 'variant_id' in v && v.variant_id === request.variantId);
    if (variants.length !== 1) throw new VoiceError('VOICE_VARIANT_MISMATCH', 'Variant evidence is ambiguous.', 409);
    assertVoiceVariant(variants[0], request.variantId, cfg);
    ids.push(asset.video_id);
  }
  const sort = request.target === 'both' ? 'rrf' : request.target;
  const meta: VoiceMoments['meta'] = { mode: 'sound_sample', query_modality: 'audio', modality: request.target, sort_by: sort,
    variant_id: request.variantId, query_duration_ms: durationMs, query_mime: 'audio/wav', took_ms: 0,
    size: request.size, rank_window_size: effectiveRankWindowSize(cfg, request.size), badge_strategy: request.target === 'both' ? 'rrf_plus_parallel_knn' : 'single_knn',
    filter: { eligible_assets: ids.length, filters_applied: true }, audio_channel_status: 'no_indexed_audio' };
  if (!ids.length) return { kind: 'moments', hits: [], meta: { ...meta, took_ms: Math.round(performance.now() - start) } };
  const filters = buildChunkFilters({ variantId: request.variantId, videoId: request.videoId, eligibleVideoIds: ids });
  const coverage = await client.count({ index: cfg.ES_INDEX_CHUNKS, query: { bool: { filter: [...filters, { exists: { field: 'embedding_audio' } }] } } }, { signal });
  if ((coverage._shards?.failed ?? 0) > 0) throw new VoiceError('VOICE_PROVIDER_FAILED', 'Could not verify audio coverage.', 502);
  if (coverage.count > 0) meta.audio_channel_status = 'ok';
  if (!coverage.count && request.target === 'audio') return { kind: 'moments', hits: [], meta: { ...meta, took_ms: Math.round(performance.now() - start) } };
  const embedded = await embedQueryAudio(wav, cfg, signal);
  const result = await executeChunkSearch({ index: cfg.ES_INDEX_CHUNKS, modality: request.target, sortBy: sort, size: request.size,
    filters, sourceFields: FILE_SOURCE_FIELDS, queryVectorMode: { kind: 'vector', vector: embedded.vector }, signal, requireCompleteResults: true }, cfg);
  return { kind: 'moments', hits: result.hits, meta: { ...meta, took_ms: Math.round(performance.now() - start), rank_window_size: result.rank_window_size } };
}
