/**
 * Mapping fragment for `video-assets.meta` (plan §A).
 * Used on create and on idempotent mapping upgrade.
 *
 * `inferenceId` wires the three semantic_text mirror fields (item 4,
 * plan/11) to the app's existing embedding inference endpoint
 * (`cfg.EMBED_INFERENCE_ID`) — no new inference endpoint is created.
 * Omit / pass '' when no inference endpoint is configured (e.g.
 * EMBED_PROVIDER is 'jina'/'local' with no ES-side inference endpoint):
 * the semantic_text properties are left out of the mapping entirely rather
 * than referencing an endpoint that queries would fail against at runtime.
 */
export function videoAssetsMetaMappingProperties(
  inferenceId?: string,
): Record<string, unknown> {
  const reviewField = {
    type: 'object' as const,
    properties: {
      source: { type: 'keyword' },
      confirmed: { type: 'boolean' },
      confidence: { type: 'float' },
      evidence: { type: 'keyword', ignore_above: 512 },
      provider: { type: 'keyword' },
      source_url: { type: 'keyword', ignore_above: 2048 },
      retrieved_at: { type: 'date' },
      request_id: { type: 'keyword' },
    },
  };

  const semanticMirrorFields = inferenceId
    ? {
        // Item 4 (plan/11) — sibling semantic_text fields, additive only.
        // Never replaces the lexical text/`description`/`abstract`/`work_title`
        // fields above; populated with the same text at write time.
        description_semantic: {
          type: 'semantic_text',
          inference_id: inferenceId,
        },
        abstract_semantic: {
          type: 'semantic_text',
          inference_id: inferenceId,
        },
        work_title_semantic: {
          type: 'semantic_text',
          inference_id: inferenceId,
        },
      }
    : {};

  return {
    meta: {
      type: 'object',
      properties: {
        description: { type: 'text' },
        abstract: { type: 'text' },
        year: { type: 'integer' },
        actors: { type: 'keyword' },
        actor_ids: { type: 'keyword' },
        actor_aliases: {
          type: 'keyword',
          // Fully qualified — required under dynamic:strict (plan migration).
          copy_to: 'meta.search_text',
        },
        actor_keys: { type: 'keyword' },
        video_type: { type: 'keyword' },
        primary_language: { type: 'keyword' },
        country: { type: 'keyword' },
        tags: { type: 'keyword' },
        tags_key: { type: 'keyword' },
        /**
         * Organizational index partition (selected at ingest, editable later).
         * Hard filter at search — not a content facet and not copied to
         * search_text.
         */
        group_id: { type: 'keyword' },
        /**
         * Drama enrichment summary on the asset (plan/12). Timed subtitle
         * segments + embeddings live in ES_INDEX_DRAMA_SUBTITLES, not here.
         */
        drama: {
          type: 'object',
          properties: {
            run_id: { type: 'keyword' },
            show_id: { type: 'keyword' },
            episode_id: { type: 'keyword' },
            enrichment_status: { type: 'keyword' },
            modules: { type: 'keyword' },
            languages: { type: 'keyword' },
            subtitle_source: { type: 'keyword', index: false },
            source_language: { type: 'keyword', index: false },
            director_coverage: { type: 'keyword', index: false },
            structure: {
              type: 'nested',
              properties: {
                kind: { type: 'keyword' },
                start_ms: { type: 'integer' },
                end_ms: { type: 'integer' },
                confidence: { type: 'float' },
                source: { type: 'keyword' },
              },
            },
            synopsis_zh: { type: 'text' },
            synopsis_en: { type: 'text' },
            /** F2 evidence gate: `audited` vs `provisional` synopsis. */
            synopsis_status: { type: 'keyword' },
            directors_script_zh: { type: 'text', index: false },
            directors_script_en: { type: 'text', index: false },
            directors_script_zh_path: { type: 'keyword', index: false },
            directors_script_en_path: { type: 'keyword', index: false },
            directors_script_raw_path: { type: 'keyword', index: false },
            subtitle_paths: { type: 'keyword', index: false },
            /**
             * I1: every field persistDramaMeta writes must be mapped —
             * strict dynamic rejects unknown fields on terminal update.
             */
            modules_done: { type: 'keyword' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'keyword' },
                message: { type: 'text', index: false },
              },
            },
            key_actors: {
              type: 'nested',
              properties: {
                role_zh: { type: 'keyword' },
                /** I1: was missing while the payload may send it. */
                role_en: { type: 'keyword' },
                person_id: { type: 'keyword' },
                thumb_path: { type: 'keyword', index: false },
                verified: { type: 'boolean' },
                t_ms: { type: 'integer' },
              },
            },
            key_scenes: {
              type: 'nested',
              properties: {
                start_ms: { type: 'integer' },
                end_ms: { type: 'integer' },
                summary_zh: { type: 'text' },
                summary_en: { type: 'text' },
                thumb_path: { type: 'keyword', index: false },
              },
            },
          },
        },
        /**
         * Reference/source page links (Wikipedia, IMDb, …). Stored but not
         * used for filtering/aggregation — `index: false` avoids wasted
         * keyword doc_values on freeform URLs while still allowing
         * `_source` retrieval and display in the editor.
         */
        reference_urls: { type: 'keyword', index: false },
        work_title: {
          type: 'object',
          properties: {
            en: { type: 'text' },
            zh: { type: 'text' },
            native: {
              type: 'object',
              properties: {
                lang: { type: 'keyword' },
                name: { type: 'text' },
              },
            },
          },
        },
        review: {
          type: 'object',
          properties: {
            description: reviewField,
            abstract: reviewField,
            year: reviewField,
            actors: reviewField,
            video_type: reviewField,
            primary_language: reviewField,
            country: reviewField,
            tags: reviewField,
            work_title: reviewField,
            reference_urls: reviewField,
            group_id: reviewField,
          },
        },
        revision: { type: 'long' },
        updated_at: { type: 'date' },
        search_text: {
          type: 'text',
          fields: {
            // Built-in CJK bigrams; probe 2026-09-22 also found nori/smartcn/
            // icu/phonetic available — frozen MVP uses cjk only (reindex to change).
            cjk: { type: 'text', analyzer: 'cjk' },
          },
        },
        // Phase 3.5 — asset-level semantic channel (never on chunks).
        // Superseded by the semantic_text mirror fields below (item 4,
        // plan/11); kept in the mapping for now — removal is a deliberate
        // separate follow-up (todo/28), not bundled with this addition.
        description_embedding: {
          type: 'dense_vector',
          dims: 1024,
          index: true,
          similarity: 'cosine',
        },
        description_embedding_meta: {
          type: 'object',
          properties: {
            source_revision: { type: 'long' },
            source_digest: { type: 'keyword' },
            state: { type: 'keyword' },
            provider: { type: 'keyword' },
            model: { type: 'keyword' },
            task: { type: 'keyword' },
            dims: { type: 'integer' },
          },
        },
        ...semanticMirrorFields,
      },
    },
  };
}

/**
 * Probe record (2026-09-22, Elastic Cloud Serverless reported 9.6.0):
 * analyze API accepted cjk, nori, smartcn, icu_analyzer, and phonetic
 * (double_metaphone). nodes.info/plugins is unavailable on Serverless.
 * Mapping freezes on standard + search_text.cjk; prefer nori/smartcn/phonetic
 * only after a deliberate reindex decision.
 */
export const ANALYSIS_PROBE_SUMMARY = {
  date: '2026-09-22',
  build_flavor: 'serverless',
  available: {
    cjk: true,
    nori: true,
    smartcn: true,
    icu_analyzer: true,
    phonetic_double_metaphone: true,
    icu_folding: true,
  },
  frozen_choice: 'standard + meta.search_text.cjk (analyzer: cjk)',
} as const;
