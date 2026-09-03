import type { TokenUsage } from './types';

/** Pull the first embedding vector from EIS / OpenAI-style responses. */
export function extractEmbeddingVector(resp: unknown): number[] | null {
  const r = resp as {
    embeddings?: Array<{ embedding?: number[] }>;
    embedding?: Array<{ embedding?: number[] }>;
    text_embedding?: Array<{ embedding?: number[] }>;
    data?: Array<{ embedding?: number[] }>;
  };
  const candidates = [
    r.embeddings?.[0]?.embedding,
    r.embedding?.[0]?.embedding,
    r.text_embedding?.[0]?.embedding,
    r.data?.[0]?.embedding,
  ];
  for (const vec of candidates) {
    if (vec?.length) return vec;
  }
  return null;
}

/** Collect per-modality token counts when the provider returns them. */
export function extractTokenUsage(resp: unknown): TokenUsage {
  const out: TokenUsage = {};
  const r = resp as Record<string, unknown>;

  for (const key of [
    'image_tokens',
    'video_tokens',
    'audio_tokens',
    'total_tokens',
  ] as const) {
    const v = r[key];
    if (typeof v === 'number') out[key] = v;
  }

  const usage = r.usage as Record<string, number> | undefined;
  if (usage) {
    for (const [k, v] of Object.entries(usage)) {
      if (typeof v !== 'number') continue;
      if (k === 'prompt_tokens' || k === 'total_tokens') {
        out.total_tokens = out.total_tokens ?? v;
      }
      if (k === 'video_tokens' || k === 'audio_tokens' || k === 'image_tokens') {
        out[k] = v;
      }
    }
  }

  const first = (r.embeddings as Array<Record<string, number>> | undefined)?.[0];
  if (first) {
    for (const key of ['image_tokens', 'video_tokens', 'audio_tokens'] as const) {
      if (typeof first[key] === 'number') out[key] = first[key];
    }
  }

  return out;
}
