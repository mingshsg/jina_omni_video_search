/**
 * Mapping for the dedicated drama subtitles index (plan/12 OQ-3).
 * Timed multilingual segments + embedding channel — not on video-assets.meta.
 */
export function dramaSubtitlesMapping(opts?: {
  inferenceId?: string;
  dims?: number;
}): {
  mappings: Record<string, unknown>;
} {
  const dims = opts?.dims ?? 1024;
  const inferenceId = opts?.inferenceId?.trim() || '';

  const textSemantic = inferenceId
    ? {
        text_semantic: {
          type: 'semantic_text',
          inference_id: inferenceId,
        },
      }
    : {};

  return {
    mappings: {
      dynamic: 'strict',
      properties: {
        video_id: { type: 'keyword' },
        run_id: { type: 'keyword' },
        lang: { type: 'keyword' },
        seg_id: { type: 'keyword' },
        start_ms: { type: 'integer' },
        end_ms: { type: 'integer' },
        text: { type: 'text' },
        /**
         * App-side embedding when semantic_text is unavailable (jina/local).
         * Same dims as chunk vectors; do not mix variant_id with visual chunks.
         */
        text_embedding: {
          type: 'dense_vector',
          dims,
          index: true,
          similarity: 'cosine',
        },
        text_embedding_variant: { type: 'keyword' },
        source: { type: 'keyword' },
        created_at: { type: 'date' },
        ...textSemantic,
      },
    },
  };
}
