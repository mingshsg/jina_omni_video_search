import { createHash } from 'node:crypto';
import type { AppConfig } from '../config';
import { getConfig } from '../config';
import { createEmbeddingProvider } from '../embed/provider';
import type { EmbedRole, ProviderIdentity } from '../embed/types';
import { getLiveConfig, type LiveConfig } from './config';

/**
 * Process-local TTL + LRU query-vector cache (Phase 7).
 * Anchored on globalThis so Next.js route bundles / HMR share one store.
 */

export type QueryCacheHitKind = 'hit' | 'miss';

export type QueryVectorCacheEntry = {
  key: string;
  vector: number[];
  provider: ProviderIdentity;
  role: EmbedRole;
  createdAtMs: number;
  expiresAtMs: number;
  lastAccessMs: number;
};

type CacheState = {
  entries: Map<string, QueryVectorCacheEntry>;
  /** Counts embeddings performed through this cache (tests / follow gate). */
  inferenceCount: number;
};

const GLOBAL_KEY = '__jina_live_query_vector_cache__';
const DEFAULT_MAX_ENTRIES = 64;

function cacheState(): CacheState {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: CacheState;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { entries: new Map(), inferenceCount: 0 };
  }
  return g[GLOBAL_KEY]!;
}

export function resetLiveQueryCacheForTests(): void {
  const state = cacheState();
  state.entries.clear();
  state.inferenceCount = 0;
}

export function liveQueryCacheInferenceCount(): number {
  return cacheState().inferenceCount;
}

function providerKey(identity: ProviderIdentity): string {
  return [
    identity.provider,
    identity.model,
    identity.task,
    String(identity.dims),
    identity.normalizedBy,
  ].join('|');
}

export function normalizeLiveTextQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function textQueryCacheKey(
  identity: ProviderIdentity,
  role: EmbedRole,
  query: string,
): string {
  return `text:${providerKey(identity)}:${role}:${normalizeLiveTextQuery(query)}`;
}

export function imageQueryCacheKey(
  identity: ProviderIdentity,
  role: EmbedRole,
  image: Buffer,
  width: number,
  height: number,
): string {
  const checksum = createHash('sha256').update(image).digest('hex');
  return `image:${providerKey(identity)}:${role}:${checksum}:w${width}:h${height}`;
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

export function getCachedQueryVector(
  key: string,
  nowMs: number = Date.now(),
): QueryVectorCacheEntry | null {
  pruneExpired(nowMs);
  const entry = cacheState().entries.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs) {
    cacheState().entries.delete(key);
    return null;
  }
  entry.lastAccessMs = nowMs;
  return entry;
}

export function putCachedQueryVector(
  entry: Omit<QueryVectorCacheEntry, 'lastAccessMs'> & {
    lastAccessMs?: number;
  },
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): QueryVectorCacheEntry {
  const stored: QueryVectorCacheEntry = {
    ...entry,
    lastAccessMs: entry.lastAccessMs ?? entry.createdAtMs,
  };
  cacheState().entries.set(stored.key, stored);
  evictLruIfNeeded(maxEntries);
  return stored;
}

export async function resolveLiveTextQueryVector(args: {
  query: string;
  appCfg?: AppConfig;
  liveCfg?: LiveConfig;
  nowMs?: number;
}): Promise<{ vector: number[]; cache: QueryCacheHitKind; key: string }> {
  const appCfg = args.appCfg ?? getConfig();
  const liveCfg = args.liveCfg ?? getLiveConfig();
  const nowMs = args.nowMs ?? Date.now();
  const provider = createEmbeddingProvider(appCfg);
  const identity = provider;
  const key = textQueryCacheKey(identity, 'query', args.query);
  const cached = getCachedQueryVector(key, nowMs);
  if (cached) {
    return { vector: cached.vector, cache: 'hit', key };
  }
  const embedded = await provider.embedText(args.query, 'query');
  cacheState().inferenceCount += 1;
  putCachedQueryVector({
    key,
    vector: embedded.embedding,
    provider: identity,
    role: 'query',
    createdAtMs: nowMs,
    expiresAtMs: nowMs + liveCfg.LIVE_QUERY_CACHE_TTL_MS,
  });
  return { vector: embedded.embedding, cache: 'miss', key };
}

export async function resolveLiveImageQueryVector(args: {
  image: Buffer;
  width: number;
  height: number;
  appCfg?: AppConfig;
  liveCfg?: LiveConfig;
  nowMs?: number;
}): Promise<{ vector: number[]; cache: QueryCacheHitKind; key: string }> {
  const appCfg = args.appCfg ?? getConfig();
  const liveCfg = args.liveCfg ?? getLiveConfig();
  const nowMs = args.nowMs ?? Date.now();
  const provider = createEmbeddingProvider(appCfg);
  const identity = provider;
  const key = imageQueryCacheKey(
    identity,
    'query',
    args.image,
    args.width,
    args.height,
  );
  const cached = getCachedQueryVector(key, nowMs);
  if (cached) {
    return { vector: cached.vector, cache: 'hit', key };
  }
  const embedded = await provider.embedImage(args.image, 'query');
  cacheState().inferenceCount += 1;
  putCachedQueryVector({
    key,
    vector: embedded.embedding,
    provider: identity,
    role: 'query',
    createdAtMs: nowMs,
    expiresAtMs: nowMs + liveCfg.LIVE_QUERY_CACHE_TTL_MS,
  });
  return { vector: embedded.embedding, cache: 'miss', key };
}
