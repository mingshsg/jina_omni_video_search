import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { embedTextQueryVector, searchChunks } from '@/lib/es/search';
import {
  parseSearchFilters,
  searchFiltersSchema,
  SearchFilterError,
} from '@/lib/metadata/search-filters';
import { boostsMinusHardFilters } from '@/lib/metadata/query-parse';
import type { ParsedQueryExtraction } from '@/lib/metadata/query-parse';
import { resolveQueryParse } from '@/lib/metadata/resolve-query-parse';

export const runtime = 'nodejs';

const bodySchema = z.object({
  query: z.string().trim().min(1).max(2000),
  modality: z.enum(['visual', 'audio', 'both']).default('visual'),
  variant_id: z.string().trim().min(1).max(64),
  video_id: z
    .union([z.string().trim().min(1).max(128), z.null()])
    .optional()
    .default(null),
  size: z.number().int().min(1).max(100).optional().default(20),
  // No .default() — omitted vs explicit visual must be distinguishable for hybrid.
  sort_by: z.enum(['rrf', 'visual', 'audio', 'hybrid']).optional(),
  filters: searchFiltersSchema,
  hybrid: z
    .object({
      use_text: z.boolean().optional().default(false),
      text_mode: z.enum(['bm25']).optional().default('bm25'),
      parse_query: z.boolean().optional().default(false),
      /** Field names to drop from extracted boosts (dismissed chips). */
      suppress_extracted: z.array(z.string().min(1).max(32)).max(20).optional(),
    })
    .optional(),
});

type SearchErrorCode =
  | 'SEARCH_INVALID_REQUEST'
  | 'FILTER_SCOPE_TOO_LARGE'
  | 'SEARCH_FAILED';

function errorResponse(
  code: SearchErrorCode,
  message: string,
  status: number,
) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return errorResponse(
        'SEARCH_INVALID_REQUEST',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        400,
      );
    }
    body = parsed.data;
  } catch {
    return errorResponse(
      'SEARCH_INVALID_REQUEST',
      'Request body must be JSON',
      400,
    );
  }

  let filters;
  try {
    filters = parseSearchFilters(body.filters ?? null);
  } catch (err) {
    if (err instanceof SearchFilterError) {
      return errorResponse(
        err.code as SearchErrorCode,
        err.message,
        err.status,
      );
    }
    throw err;
  }

  const useText = Boolean(body.hybrid?.use_text);
  const wantParse = Boolean(body.hybrid?.parse_query);

  // Default sort_by after hybrid.use_text is known.
  let sortBy = body.sort_by;
  if (useText) {
    if (sortBy === undefined) {
      sortBy = 'hybrid';
    } else if (sortBy !== 'hybrid') {
      return errorResponse(
        'SEARCH_INVALID_REQUEST',
        'sort_by must be hybrid (or omitted) when hybrid.use_text=true',
        400,
      );
    }
  } else if (sortBy === 'hybrid') {
    return errorResponse(
      'SEARCH_INVALID_REQUEST',
      'sort_by=hybrid requires hybrid.use_text=true',
      400,
    );
  } else if (sortBy === undefined) {
    sortBy = 'visual';
  }

  let parseMeta: Record<string, unknown> | null = null;
  let vectorQuery: string | undefined;
  let bm25Query: string | undefined;
  let searchQuery = body.query;
  let sceneTermsPresent: boolean | undefined;
  let extractedBoosts: ParsedQueryExtraction | null = null;
  let parseOnlyQueryDsl: Record<string, unknown> | null = null;
  let speculativeEmbed:
    | Promise<{ vector: number[]; took_ms: number } | null>
    | undefined;
  let priorEmbedCalls = 0;

  if (wantParse) {
    const cfg = getConfig();
    if (cfg.QUERY_PARSER_PROVIDER === 'none') {
      parseMeta = { parser: 'unavailable', elapsed_ms: 0, cache: 'miss' };
    } else {
      // Speculative embed of the full query in parallel with parse (Phase 3.6).
      // Hybrid awaits it only after eligibility is known and residual matches.
      if (useText) {
        priorEmbedCalls = 1;
        const t0 = performance.now();
        speculativeEmbed = embedTextQueryVector(cfg, body.query)
          .then((vector) => ({
            vector,
            took_ms: Math.round(performance.now() - t0),
          }))
          .catch(() => null);
      }

      const parsed = await resolveQueryParse({ query: body.query, cfg });
      const boosts = boostsMinusHardFilters(parsed.extracted, filters);
      const suppressed = new Set(body.hybrid?.suppress_extracted ?? []);
      if (suppressed.has('actor_ids')) delete boosts.actor_ids;
      if (
        suppressed.has('year') ||
        suppressed.has('year_from') ||
        suppressed.has('year_to')
      ) {
        delete boosts.year_from;
        delete boosts.year_to;
      }
      if (suppressed.has('country')) delete boosts.country;
      if (suppressed.has('video_type')) delete boosts.video_type;

      // Evaluation mode: treat extracted facets as hard filters (plan §C Rule 1).
      if (cfg.QUERY_PARSER_FACET_MODE === 'filter' && useText) {
        const merged = { ...(filters ?? {}) };
        if (boosts.actor_ids?.length) {
          merged.actor_ids = [
            ...new Set([...(merged.actor_ids ?? []), ...boosts.actor_ids]),
          ];
        }
        if (boosts.country?.length) {
          merged.country = [
            ...new Set([...(merged.country ?? []), ...boosts.country]),
          ];
        }
        if (boosts.video_type?.length) {
          merged.video_type = [
            ...new Set([...(merged.video_type ?? []), ...boosts.video_type]),
          ];
        }
        if (boosts.year_from != null) {
          merged.year_from =
            merged.year_from == null
              ? boosts.year_from
              : Math.max(merged.year_from, boosts.year_from);
        }
        if (boosts.year_to != null) {
          merged.year_to =
            merged.year_to == null
              ? boosts.year_to
              : Math.min(merged.year_to, boosts.year_to);
        }
        filters = Object.keys(merged).length ? merged : null;
        extractedBoosts = null;
      } else if (useText) {
        extractedBoosts = boosts;
      } else {
        // Parser-only (no hybrid text): report extracted but do not claim scoring.
        extractedBoosts = null;
        parseOnlyQueryDsl = {
          status: 'not_applied',
          reason: 'hybrid_text_required',
          bm25_query: parsed.free_text,
          vector_query: parsed.vector_query,
          extracted_boosts: boosts,
          note: 'parse_query=true without use_text=true: facets are not scored; turn on hybrid.use_text to apply BM25 + boosts',
        };
      }

      parseMeta = {
        parser: parsed.parser,
        vector_query: parsed.vector_query,
        free_text: parsed.free_text,
        scene_terms_present: parsed.scene_terms_present,
        extracted: parsed.extracted,
        // Provisional; overwritten from boost_effects after search when hybrid.
        applied: useText && cfg.QUERY_PARSER_FACET_MODE !== 'filter' ? boosts : {},
        rejected: [
          ...parsed.rejected,
          ...(!useText
            ? Object.entries(boosts).flatMap(([field, value]) => {
                if (value == null) return [];
                if (Array.isArray(value)) {
                  return value.map((v) => ({
                    field,
                    value: String(v),
                    reason: 'hybrid_text_required',
                  }));
                }
                return [
                  {
                    field,
                    value: String(value),
                    reason: 'hybrid_text_required',
                  },
                ];
              })
            : []),
        ],
        confidence: parsed.confidence,
        elapsed_ms: parsed.elapsed_ms,
        cache: parsed.cache,
        eis_skipped: parsed.eis_skipped ?? false,
        eis_skip_reason: parsed.eis_skip_reason ?? null,
        repair_attempted: parsed.repair_attempted ?? false,
        // Never echo secrets — inference_id is an endpoint name, not a key.
        inference_id: parsed.inference_id ?? null,
        facet_mode: cfg.QUERY_PARSER_FACET_MODE,
      };

      vectorQuery = parsed.vector_query;
      bm25Query = parsed.free_text;
      sceneTermsPresent = parsed.scene_terms_present;

      if (!useText && parsed.scene_terms_present) {
        searchQuery = parsed.vector_query;
      } else if (!useText && !parsed.scene_terms_present) {
        searchQuery = body.query;
      }
    }
  } else {
    parseMeta = { parser: 'disabled' };
  }

  try {
    getConfig();
    const effectiveSort =
      body.modality !== 'both' && sortBy === 'rrf' ? body.modality : sortBy;
    const result = await searchChunks({
      query: searchQuery,
      modality: body.modality,
      variantId: body.variant_id,
      videoId: body.video_id,
      size: body.size,
      sortBy: effectiveSort,
      filters,
      hybrid: useText ? { use_text: true } : undefined,
      vectorQuery: useText ? vectorQuery : undefined,
      bm25Query: useText ? bm25Query : undefined,
      sceneTermsPresent: useText ? sceneTermsPresent : undefined,
      extractedBoosts: useText ? extractedBoosts : undefined,
      speculativeEmbed: useText ? speculativeEmbed : undefined,
      priorEmbedCalls: useText ? priorEmbedCalls : undefined,
    });

    if (parseMeta && result.boost_effects) {
      parseMeta = {
        ...parseMeta,
        applied: result.boost_effects.applied,
        rejected: [
          ...((parseMeta.rejected as unknown[]) ?? []),
          ...result.boost_effects.rejected,
        ],
      };
    }

    return NextResponse.json({
      hits: result.hits.map((h) => ({
        chunk_id: h.chunk_id,
        video_id: h.video_id,
        variant_id: h.variant_id,
        title: h.title,
        start_ms: h.start_ms,
        end_ms: h.end_ms,
        start_label: h.start_label,
        end_label: h.end_label,
        score: h.score,
        score_visual: h.score_visual,
        score_audio: h.score_audio,
        rank_visual: h.rank_visual,
        rank_audio: h.rank_audio,
        modality_badge: h.modality_badge,
        thumb_url: h.thumb_url,
        score_kind: h.score_kind,
        rank_text: h.rank_text,
        asset_text_score: h.asset_text_score,
        metadata_match: h.metadata_match,
      })),
      meta: {
        size: result.size,
        rank_window_size: result.rank_window_size,
        modality: result.modality,
        sort_by: result.sort_by,
        variant_id: result.variant_id,
        video_id: result.video_id,
        badge_strategy: result.badge_strategy,
        took_ms: result.took_ms,
        filters: filters ?? null,
        filter: result.filter_meta ?? null,
        text_channel_status: result.text_channel_status ?? 'disabled',
        ranking_strategy: result.ranking_strategy ?? null,
        branch: result.branch ?? null,
        hybrid: useText
          ? { use_text: true, parse_query: wantParse }
          : wantParse
            ? { use_text: false, parse_query: true }
            : null,
        parse: parseMeta,
        query_dsl: useText
          ? (result.query_dsl ?? null)
          : parseOnlyQueryDsl,
      },
    });
  } catch (err) {
    if (err instanceof SearchFilterError) {
      return errorResponse(
        err.code as SearchErrorCode,
        err.message,
        err.status,
      );
    }
    const message =
      err instanceof Error ? err.message : 'Search failed unexpectedly';
    if (message.includes('sort_by must be hybrid') || message.includes('sort_by=hybrid')) {
      return errorResponse('SEARCH_INVALID_REQUEST', message, 400);
    }
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return errorResponse('SEARCH_FAILED', safe, 500);
  }
}
