import { LiveApiError } from './errors';
import { durationTokenToMs } from './duration';
import { getLiveConfig, type LiveConfig } from './config';
import type { SearchModality, SearchSortBy } from '../es/search-core';

export interface LiveSearchFilterInput {
  variantId: string;
  sourceIds?: string[];
  sessionIds?: string[];
  from?: string | null;
  to?: string | null;
  follow?: boolean;
}

/**
 * Build ES filter clauses applied inside every knn / RRF child (Phase 7).
 * Requires variant_id. follow=true requires nonempty session_ids.
 */
export function buildLiveSearchFilters(
  input: LiveSearchFilterInput,
  liveCfg: LiveConfig = getLiveConfig(),
): Record<string, unknown>[] {
  const variantId = input.variantId.trim();
  if (!variantId) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'variant_id is required',
    });
  }

  const sourceIds = (input.sourceIds ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const sessionIds = (input.sessionIds ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  if (input.follow && sessionIds.length === 0) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'follow=true requires nonempty session_ids',
    });
  }

  const filters: Record<string, unknown>[] = [
    { term: { variant_id: variantId } },
  ];

  if (sourceIds.length === 1) {
    filters.push({ term: { source_id: sourceIds[0]! } });
  } else if (sourceIds.length > 1) {
    filters.push({ terms: { source_id: sourceIds } });
  }

  if (sessionIds.length === 1) {
    filters.push({ term: { session_id: sessionIds[0]! } });
  } else if (sessionIds.length > 1) {
    filters.push({ terms: { session_id: sessionIds } });
  }

  const from = input.from?.trim() || null;
  const to = input.to?.trim() || null;
  if (from || to) {
    if (!from || !to) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: 'from and to must both be provided when filtering by time',
      });
    }
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: 'from/to must be ISO-8601 timestamps',
      });
    }
    if (fromMs >= toMs) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: 'from must precede to',
      });
    }
    const maxRangeMs = durationTokenToMs(liveCfg.LIVE_SEARCH_MAX_RANGE);
    if (toMs - fromMs > maxRangeMs) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: `time range exceeds LIVE_SEARCH_MAX_RANGE (${liveCfg.LIVE_SEARCH_MAX_RANGE})`,
      });
    }
    // Window overlaps [from, to] when window_end >= from AND window_start <= to.
    filters.push({ range: { window_end_at: { gte: from } } });
    filters.push({ range: { window_start_at: { lte: to } } });
  }

  return filters;
}

export function parseLiveSearchModality(
  raw: string | undefined,
): SearchModality {
  const v = (raw ?? 'both').trim().toLowerCase();
  if (v === 'visual' || v === 'audio' || v === 'both') return v;
  throw new LiveApiError('LIVE_INVALID_REQUEST', {
    message: 'modality must be visual|audio|both',
  });
}

export function parseLiveSearchSortBy(
  raw: string | undefined,
  modality: SearchModality,
): SearchSortBy {
  const v = (raw ?? (modality === 'both' ? 'rrf' : modality)).trim().toLowerCase();
  if (v === 'rrf' || v === 'visual' || v === 'audio') return v;
  throw new LiveApiError('LIVE_INVALID_REQUEST', {
    message: 'sort_by must be rrf|visual|audio',
  });
}
