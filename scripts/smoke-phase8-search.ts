/**
 * Phase 8 smoke: dual-modality RRF search against existing Phase 7 chunks.
 * Usage: yarn tsx scripts/smoke-phase8-search.ts
 *
 * Prerequisites: `.env` with ES + EMBED_PROVIDER; at least one ready variant
 * in `video-chunks` (e.g. from `yarn tsx scripts/smoke-phase7.ts`).
 *
 * Manual alternative (with `yarn dev` running):
 *   curl -s http://localhost:3000/api/search -H 'content-type: application/json' \
 *     -d '{"query":"test pattern tone","modality":"both","variant_id":"<id>","size":5}'
 */
import { loadDotenv } from './load-dotenv';

loadDotenv();

async function main(): Promise<void> {
  const { getConfig } = await import('../lib/config');
  const { getEsClient } = await import('../lib/es/client');
  const { searchChunks } = await import('../lib/es/search');

  const cfg = getConfig();
  const client = getEsClient();

  const sample = await client.search({
    index: cfg.ES_INDEX_CHUNKS,
    size: 1,
    _source: ['video_id', 'variant_id', 'has_audio', 'video_title'],
    query: { match_all: {} },
  });

  const first = sample.hits?.hits?.[0];
  if (!first?._source) {
    console.log(
      JSON.stringify({
        smoke: 'skipped',
        reason:
          'No documents in video-chunks. Run scripts/smoke-phase7.ts first.',
      }),
    );
    process.exit(0);
  }

  const src = first._source as {
    video_id: string;
    variant_id: string;
    has_audio?: boolean;
    video_title?: string;
  };

  console.log(
    JSON.stringify({
      smoke: 'sample_chunk',
      video_id: src.video_id,
      variant_id: src.variant_id,
      title: src.video_title ?? null,
      has_audio: src.has_audio ?? null,
    }),
  );

  const t0 = Date.now();
  const result = await searchChunks({
    query: 'colorful test pattern with sine tone',
    modality: 'both',
    variantId: src.variant_id,
    videoId: src.video_id,
    size: 5,
  });
  const elapsed = Date.now() - t0;

  const badges = result.hits.map((h) => h.modality_badge);
  const bothCount = badges.filter((b) => b === 'both').length;

  console.log(
    JSON.stringify({
      smoke: 'search_ok',
      hit_count: result.hits.length,
      took_ms: result.took_ms,
      wall_ms: elapsed,
      rank_window_size: result.rank_window_size,
      sort_by: result.sort_by,
      badge_strategy: result.badge_strategy,
      badges,
      both_badge_count: bothCount,
      top: result.hits.slice(0, 3).map((h) => ({
        chunk_id: h.chunk_id,
        score: h.score,
        score_visual: h.score_visual,
        score_audio: h.score_audio,
        modality_badge: h.modality_badge,
        start_label: h.start_label,
        end_label: h.end_label,
        rank_visual: h.rank_visual,
        rank_audio: h.rank_audio,
      })),
    }),
  );

  if (result.hits.length === 0) {
    console.error('Expected at least one hit from phase7 smoke corpus');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
