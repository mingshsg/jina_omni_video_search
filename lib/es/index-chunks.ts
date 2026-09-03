import { getConfig } from '../config';
import { chunkDocumentId } from '../ingest/variant';
import { getEsClient } from './client';

export interface VideoProxyMeta {
  bytes: number;
  width: number;
  height: number;
  frames: number;
  crf: number;
  strategy: string;
  ladder_exhausted?: boolean;
}

export interface AudioProxyMeta {
  bytes: number;
  bitrate: string;
  codec: string;
}

/** Chunk document shape for bulk upsert into `video-chunks`. */
export interface ChunkDocument {
  video_id: string;
  variant_id: string;
  chunk_index: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  start_label: string;
  end_label: string;
  embedding_video: number[];
  embedding_audio?: number[];
  provider: string;
  model: string;
  task: string;
  normalized_by: string;
  video_proxy: VideoProxyMeta;
  audio_proxy?: AudioProxyMeta;
  thumb_path?: string;
  has_audio: boolean;
  video_title: string;
  source_mode: string;
  created_at: string;
}

export interface BulkUpsertResult {
  indexed: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Bulk upsert chunk documents by composite `_id` (FR-12).
 * Uses `index` action — same `_id` replaces on re-ingest.
 */
export async function bulkUpsertChunks(
  chunks: ChunkDocument[],
): Promise<BulkUpsertResult> {
  if (chunks.length === 0) {
    return { indexed: 0, errors: [] };
  }

  const client = getEsClient();
  const cfg = getConfig();
  const index = cfg.ES_INDEX_CHUNKS;

  const operations = chunks.flatMap((doc) => {
    const id = chunkDocumentId(doc.video_id, doc.variant_id, doc.chunk_index);
    return [
      { index: { _index: index, _id: id } },
      doc as unknown as Record<string, unknown>,
    ];
  });

  const response = await client.bulk({
    refresh: 'wait_for',
    operations,
  });

  const errors: BulkUpsertResult['errors'] = [];
  if (response.errors && response.items) {
    for (const item of response.items) {
      const op = item.index ?? item.create ?? item.update;
      if (op?.error) {
        errors.push({
          id: op._id ?? 'unknown',
          error:
            typeof op.error === 'object' && op.error !== null && 'reason' in op.error
              ? String((op.error as { reason?: string }).reason)
              : JSON.stringify(op.error),
        });
      }
    }
  }

  const indexed = chunks.length - errors.length;
  return { indexed, errors };
}
