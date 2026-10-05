/**
 * Bulk-index timed subtitle cues into ES_INDEX_DRAMA_SUBTITLES + embed text.
 */
import { createHash } from 'node:crypto';
import { createEmbeddingProvider } from '../embed/provider';
import { getConfig } from '../config';
import { getEsClient } from '../es/client';
import { getDramaEnv } from './env';
import type { DramaLanguage } from '../ingest/drama-options';
import type { SrtCue } from './srt';

export interface DramaSubtitleDoc {
  video_id: string;
  run_id: string;
  lang: DramaLanguage;
  seg_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  text_embedding?: number[];
  text_embedding_variant?: string;
  source: string;
  created_at: string;
}

export async function indexDramaSubtitles(opts: {
  videoId: string;
  runId: string;
  lang: DramaLanguage;
  cues: SrtCue[];
  source: string;
}): Promise<{ indexed: number; embedded: number; ids: string[]; segIds: string[] }> {
  const dramaEnv = getDramaEnv();
  const cfg = getConfig();
  const client = getEsClient();
  const maxEmbed = dramaEnv.DRAMA_SUBTITLE_EMBED_MAX;
  const createdAt = new Date().toISOString();

  const capped = opts.cues;
  const provider = createEmbeddingProvider(cfg);
  const index = dramaEnv.ES_INDEX_DRAMA_SUBTITLES;
  const identity = createHash('sha256').update(JSON.stringify({
    provider: provider.provider, model: provider.model, task: provider.task,
    role: 'passage', dims: provider.dims, normalized_by: provider.normalizedBy,
  })).digest('hex').slice(0, 16);
  let vectorsCompatible = false;
  if (opts.cues.length && maxEmbed > 0) {
    try {
      const mappings = Object.values(await client.indices.getMapping({ index }));
      vectorsCompatible = mappings.length > 0 && mappings.every((entry) => {
        const field = entry.mappings.properties?.text_embedding;
        return field?.type === 'dense_vector' && 'dims' in field && field.dims === provider.dims;
      });
      if (vectorsCompatible && mappings.some((entry) => !entry.mappings.properties?.text_embedding_variant)) {
        await client.indices.putMapping({ index, properties: { text_embedding_variant: { type: 'keyword' } } });
      }
    } catch { vectorsCompatible = false; } // Keep every cue searchable lexically.
  }
  const docs: DramaSubtitleDoc[] = [];
  let embedded = 0;

  for (let i = 0; i < capped.length; i += 1) {
    const cue = capped[i];
    const segId = `${opts.lang}_${cue.index}_${cue.startMs}`;
    let text_embedding: number[] | undefined;
    // DRAMA_SUBTITLE_EMBED_MAX bounds vector inference cost only.
    // Every validated cue is still indexed lexically.
    if (vectorsCompatible && i < maxEmbed) {
      try {
        const emb = await provider.embedText(cue.text, 'passage');
        if (emb.embedding.length !== provider.dims || emb.embedding.some((value) => !Number.isFinite(value))) throw new Error('Invalid subtitle embedding');
        text_embedding = emb.embedding;
        embedded += 1;
      } catch {
        /* lexical-only fallback for this cue */
      }
    }
    docs.push({
      video_id: opts.videoId,
      run_id: opts.runId,
      lang: opts.lang,
      seg_id: segId,
      start_ms: cue.startMs,
      end_ms: cue.endMs,
      text: cue.text,
      text_embedding,
      ...(text_embedding ? { text_embedding_variant: identity } : {}),
      source: opts.source,
      created_at: createdAt,
    });
  }

  if (docs.length === 0) return { indexed: 0, embedded: 0, ids: [], segIds: [] };

  const segIds = docs.map((doc) => doc.seg_id);
  const ids = segIds.map(
    (segId) => `${opts.videoId}_${opts.runId}_${segId}`,
  );
  const operations = docs.flatMap((doc, i) => {
    const body: Record<string, unknown> = { ...doc };
    if (!doc.text_embedding) delete body.text_embedding;
    return [{ index: { _index: index, _id: ids[i] } }, body];
  });

  const response = await client.bulk({
    refresh: 'wait_for',
    operations,
  });

  if (response.errors) {
    const first = response.items?.find((it) => it.index?.error);
    const err = first?.index?.error;
    throw new Error(
      `drama subtitle bulk failed: ${err?.type ?? 'unknown'} ${err?.reason ?? ''}`,
    );
  }

  return { indexed: docs.length, embedded, ids, segIds };
}

/**
 * Delete stale same-run documents for one language (I2): a retry with
 * fewer cues or shifted timings overwrites matching `_id`s but cannot
 * remove dropped ones — delete same-(video, run, lang) docs whose
 * `seg_id` is not in the freshly indexed set. Empty keep-sets are
 * refused (never wipe a language generation on an empty replacement).
 * Best-effort — returns 0 when ES is unreachable.
 */
export async function reconcileSubtitleLang(opts: {
  videoId: string;
  runId: string;
  lang: DramaLanguage;
  keepSegIds: string[];
}): Promise<{ deleted: number }> {
  if (opts.keepSegIds.length === 0) return { deleted: 0 };
  try {
    const dramaEnv = getDramaEnv();
    const client = getEsClient();
    const res = await client.deleteByQuery({
      index: dramaEnv.ES_INDEX_DRAMA_SUBTITLES,
      refresh: true,
      query: {
        bool: {
          must: [
            { term: { video_id: opts.videoId } },
            { term: { run_id: opts.runId } },
            { term: { lang: opts.lang } },
          ],
          must_not: [{ terms: { seg_id: opts.keepSegIds } }],
        },
      },
    });
    return { deleted: Number(res.deleted ?? 0) };
  } catch {
    return { deleted: 0 };
  }
}

/**
 * Switch one language to the current generation (I2): after language
 * `lang` indexed successfully for this run, delete other runs' documents
 * for the same (video, lang). Per-language replacement — a failed language
 * keeps its previous generation instead of losing it, so a partial
 * multilingual run never removes the last complete generation.
 * Best-effort — returns 0 when ES is unreachable.
 */
export async function retireOldSubtitleGenerations(opts: {
  videoId: string;
  keepRunId: string;
  /** Scope to one language (I2). Omit only for whole-video retirement. */
  lang?: DramaLanguage;
}): Promise<{ deleted: number }> {
  try {
    const dramaEnv = getDramaEnv();
    const client = getEsClient();
    const res = await client.deleteByQuery({
      index: dramaEnv.ES_INDEX_DRAMA_SUBTITLES,
      refresh: true,
      query: {
        bool: {
          must: [
            { term: { video_id: opts.videoId } },
            ...(opts.lang ? [{ term: { lang: opts.lang } }] : []),
          ],
          must_not: [{ term: { run_id: opts.keepRunId } }],
        },
      },
    });
    return { deleted: Number(res.deleted ?? 0) };
  } catch {
    return { deleted: 0 };
  }
}
