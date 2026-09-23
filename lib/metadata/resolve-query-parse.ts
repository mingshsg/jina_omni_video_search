/**
 * Query-parse orchestration (Phase 3.5 dictionary + Phase 3.6 EIS).
 * Three-tier degradation: eis → dictionary → raw. Never fails the search.
 */
import type { AppConfig } from '../config';
import { getConfig } from '../config';
import {
  COUNTRY_OPTIONS,
  VIDEO_TYPES,
} from './catalogs';
import { callEisCompletion, EisCompletionError } from './eis-completion';
import {
  getCachedParseResult,
  parseCacheKey,
  putCachedParseResult,
} from './parse-cache';
import {
  findContainedAliases,
  searchPeople,
} from './people';
import {
  parseQueryDictionary,
  type DictionaryParseResult,
  type ParsedQueryExtraction,
  type QueryParseResult,
} from './query-parse';
import {
  extractJsonObject,
  validateEisParsePayload,
  type EisClearableField,
} from './validate-eis-parse';

export type { QueryParseResult } from './query-parse';

/** CJK / Hangul / Kana — plan §C2 generalization (e.g. 南朝鲜的片子). */
const GENERALIZATION_SCRIPT_RE =
  /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

function candidateActorsForQuery(query: string): Array<{ id: string; alias: string }> {
  const candidateActors = [
    ...findContainedAliases(query).map((a) => ({
      id: a.person_id,
      alias: a.alias,
    })),
    ...searchPeople(query, 'en', 8).map((p) => ({
      id: p.id,
      alias: p.display,
    })),
  ];
  const seen = new Set<string>();
  return candidateActors
    .filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    })
    .slice(0, 12);
}

/**
 * Skip EIS when there is nothing to disambiguate (plan §C2).
 * Exact full-string alias → skip. No catalog hit → skip unless the query
 * contains CJK/Hangul (generalization cases the dictionary cannot cover).
 */
export function shouldSkipEis(
  query: string,
  dict: DictionaryParseResult,
): { skip: boolean; reason?: string } {
  const qNorm = query.normalize('NFKC').toLowerCase().trim();
  const aliases = findContainedAliases(query);
  if (
    aliases.length === 1 &&
    aliases[0]!.alias.normalize('NFKC').toLowerCase() === qNorm
  ) {
    return { skip: true, reason: 'exact_alias' };
  }

  const hasEntity = Boolean(
    dict.extracted.actor_ids?.length ||
      dict.extracted.country?.length ||
      dict.extracted.video_type?.length ||
      dict.extracted.year_from != null ||
      dict.extracted.year_to != null,
  );
  if (!hasEntity) {
    if (GENERALIZATION_SCRIPT_RE.test(query)) {
      return { skip: false };
    }
    return { skip: true, reason: 'no_catalog_hit' };
  }
  return { skip: false };
}

function buildEisPrompt(
  query: string,
  dict: DictionaryParseResult,
  actors: Array<{ id: string; alias: string }>,
): string {
  const countries = COUNTRY_OPTIONS.map((c) => c.code).join(',');
  const types = VIDEO_TYPES.join(',');

  return [
    'Extract structured video-search fields from the user query.',
    'Return ONLY a single JSON object. Prefer null over guesses. No prose.',
    'Schema keys: vector_query (string|null), free_text (string|null),',
    'actor_ids (string[]|null), year_from (int|null), year_to (int|null),',
    'country (ISO alpha-2 string[]|null), video_type (string[]|null).',
    'vector_query = residual scene words for embedding; free_text = name/title terms for BM25.',
    'actor_ids must be chosen ONLY from candidate_actors ids below (or null).',
    'Use null to clear a dictionary_hint field that should not apply.',
    'country codes ONLY from: ' + countries,
    'video_type ONLY from: ' + types,
    'candidate_actors: ' + JSON.stringify(actors),
    'dictionary_hint: ' +
      JSON.stringify({
        extracted: dict.extracted,
        vector_query: dict.vector_query,
        free_text: dict.free_text,
      }),
    'user_query: ' + JSON.stringify(query),
  ].join('\n');
}

function applyClearedFields(
  base: ParsedQueryExtraction,
  cleared: Set<EisClearableField>,
): ParsedQueryExtraction {
  const out: ParsedQueryExtraction = { ...base };
  if (cleared.has('actor_ids')) delete out.actor_ids;
  if (cleared.has('country')) delete out.country;
  if (cleared.has('video_type')) delete out.video_type;
  if (cleared.has('year_from')) delete out.year_from;
  if (cleared.has('year_to')) delete out.year_to;
  return out;
}

function fromDictionary(
  dict: DictionaryParseResult,
  overrides?: Partial<QueryParseResult>,
): QueryParseResult {
  return {
    parser: 'dictionary',
    vector_query: dict.vector_query,
    free_text: dict.free_text,
    scene_terms_present: dict.scene_terms_present,
    extracted: dict.extracted,
    applied: { ...dict.extracted },
    rejected: dict.rejected,
    confidence: dict.confidence,
    elapsed_ms: dict.elapsed_ms,
    cache: 'miss',
    ...overrides,
  };
}

function rawPassthrough(query: string, elapsed_ms: number): QueryParseResult {
  const q = query.trim();
  return {
    parser: 'raw',
    vector_query: q,
    free_text: q,
    scene_terms_present: true,
    extracted: {},
    applied: {},
    rejected: [],
    confidence: {},
    elapsed_ms,
    cache: 'miss',
  };
}

async function runEisParse(
  query: string,
  dict: DictionaryParseResult,
  cfg: AppConfig,
): Promise<QueryParseResult> {
  const t0 = performance.now();
  let repairAttempted = false;
  const actors = candidateActorsForQuery(query);
  const allowedActorIds = new Set(actors.map((a) => a.id));
  const prompt = buildEisPrompt(query, dict, actors);

  const tryOnce = async (input: string): Promise<QueryParseResult> => {
    const raw = await callEisCompletion({ prompt: input, cfg });
    let parsedJson: unknown;
    try {
      parsedJson = extractJsonObject(raw);
    } catch {
      throw new EisCompletionError('malformed', 'EIS completion was not JSON');
    }
    const validated = validateEisParsePayload(parsedJson, {
      allowedActorIds,
    });

    let vector_query = dict.vector_query;
    if (validated.cleared.has('vector_query')) {
      vector_query = validated.vector_query ?? '';
    } else if (
      validated.vector_query != null &&
      validated.vector_query.length > 0
    ) {
      vector_query = validated.vector_query;
    }

    let free_text = dict.free_text;
    if (validated.cleared.has('free_text')) {
      free_text = validated.free_text ?? '';
    } else if (validated.free_text != null && validated.free_text.length > 0) {
      free_text = validated.free_text;
    }

    const extracted = {
      ...applyClearedFields(dict.extracted, validated.cleared),
      ...validated.extracted,
    };

    return {
      parser: 'eis',
      vector_query,
      free_text,
      scene_terms_present: vector_query.trim().length > 0,
      extracted,
      applied: { ...extracted },
      rejected: [...dict.rejected, ...validated.rejected],
      confidence: { ...dict.confidence, ...validated.confidence },
      elapsed_ms: Math.round(performance.now() - t0),
      cache: 'miss',
      repair_attempted: repairAttempted,
      inference_id: cfg.QUERY_PARSER_INFERENCE_ID.trim() || undefined,
    };
  };

  try {
    return await tryOnce(prompt);
  } catch (err) {
    if (
      err instanceof EisCompletionError &&
      (err.code === 'malformed' || err.code === 'empty')
    ) {
      repairAttempted = true;
      try {
        const repairPrompt =
          prompt +
          '\nPrevious output was invalid. Reply with ONLY valid JSON matching the schema.';
        return await tryOnce(repairPrompt);
      } catch {
        // fall through to dictionary
      }
    }
    // timeout / transport / second failure → dictionary
    return fromDictionary(dict, {
      elapsed_ms: Math.round(performance.now() - t0),
      eis_skipped: true,
      eis_skip_reason:
        err instanceof EisCompletionError ? err.code : 'transport',
      inference_id: cfg.QUERY_PARSER_INFERENCE_ID.trim() || undefined,
    });
  }
}

/**
 * Resolve parse for a search request.
 * provider=none is handled by the caller (unavailable).
 */
export async function resolveQueryParse(params: {
  query: string;
  cfg?: AppConfig;
}): Promise<QueryParseResult> {
  const cfg = params.cfg ?? getConfig();
  const query = params.query;
  const tAll = performance.now();

  const cacheKey = parseCacheKey(
    cfg.QUERY_PARSER_PROVIDER,
    cfg.QUERY_PARSER_INFERENCE_ID,
    query,
  );
  const cached = getCachedParseResult(cacheKey);
  if (cached) return cached;

  let dict: DictionaryParseResult;
  try {
    dict = parseQueryDictionary(query);
  } catch {
    const raw = rawPassthrough(query, Math.round(performance.now() - tAll));
    putCachedParseResult(cacheKey, raw, cfg);
    return raw;
  }

  if (cfg.QUERY_PARSER_PROVIDER === 'dictionary') {
    const result = fromDictionary(dict);
    putCachedParseResult(cacheKey, result, cfg);
    return result;
  }

  if (cfg.QUERY_PARSER_PROVIDER !== 'eis') {
    const result = fromDictionary(dict);
    putCachedParseResult(cacheKey, result, cfg);
    return result;
  }

  const skip = shouldSkipEis(query, dict);
  if (skip.skip) {
    const result = fromDictionary(dict, {
      eis_skipped: true,
      eis_skip_reason: skip.reason,
      inference_id: cfg.QUERY_PARSER_INFERENCE_ID.trim() || undefined,
    });
    putCachedParseResult(cacheKey, result, cfg);
    return result;
  }

  const result = await runEisParse(query, dict, cfg);
  putCachedParseResult(cacheKey, result, cfg);
  return result;
}
