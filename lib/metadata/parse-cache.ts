/**
 * Process-local TTL + LRU cache for query-parse results (Phase 3.6).
 * Anchored on globalThis so Next.js route bundles share one store.
 */
import type { AppConfig } from '../config';
import { getConfig } from '../config';
import type { QueryParseResult } from './query-parse';

type CacheEntry = {
  key: string;
  result: QueryParseResult;
  createdAtMs: number;
  expiresAtMs: number;
  lastAccessMs: number;
};

type CacheState = {
  entries: Map<string, CacheEntry>;
};

const GLOBAL_KEY = '__jina_query_parse_cache__';

function cacheState(): CacheState {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: CacheState };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { entries: new Map() };
  return g[GLOBAL_KEY]!;
}

export function resetQueryParseCacheForTests(): void {
  cacheState().entries.clear();
}

export function normalizeParseQueryKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseCacheKey(provider: string, inferenceId: string, query: string): string {
  return `parse:${provider}:${inferenceId || '-'}:${normalizeParseQueryKey(query)}`;
}

function pruneExpired(nowMs: number): void {
  const state = cacheState();
  for (const [key, entry] of state.entries) {
    if (entry.expiresAtMs <= nowMs) state.entries.delete(key);
  }
}

function evictLruIfNeeded(maxEntries: number): void {
  const state = cacheState();
  while (state.entries.size > maxEntries) {
    let oldestKey: string | null = null;
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [key, entry] of state.entries) {
      if (entry.lastAccessMs < oldestAccess) {
        oldestAccess = entry.lastAccessMs;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    state.entries.delete(oldestKey);
  }
}

export function getCachedParseResult(
  key: string,
  nowMs: number = Date.now(),
): QueryParseResult | null {
  pruneExpired(nowMs);
  const entry = cacheState().entries.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs) {
    cacheState().entries.delete(key);
    return null;
  }
  entry.lastAccessMs = nowMs;
  return { ...entry.result, cache: 'hit' };
}

export function putCachedParseResult(
  key: string,
  result: QueryParseResult,
  cfg?: AppConfig,
  nowMs: number = Date.now(),
): void {
  const config = cfg ?? getConfig();
  const stored: CacheEntry = {
    key,
    result: { ...result, cache: 'miss' },
    createdAtMs: nowMs,
    expiresAtMs: nowMs + config.QUERY_PARSER_CACHE_TTL_MS,
    lastAccessMs: nowMs,
  };
  cacheState().entries.set(key, stored);
  evictLruIfNeeded(config.QUERY_PARSER_CACHE_MAX);
}
