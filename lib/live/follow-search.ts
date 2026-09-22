import { randomUUID } from 'node:crypto';
import type { SearchModality, SearchSortBy } from '../es/search-core';
import { LiveApiError } from './errors';

/**
 * Process-local follow-search handles. Co-expire with query-vector TTL.
 * Anchored on globalThis for Next.js HMR / multi-bundle safety.
 */

export interface FollowSearchHandle {
  queryId: string;
  cacheKey: string;
  vector: number[];
  filters: Record<string, unknown>[];
  modality: SearchModality;
  sortBy: SearchSortBy;
  size: number;
  variantId: string;
  sourceIds: string[];
  sessionIds: string[];
  /** One cursor per selected session (published_revision baseline). */
  sessionCursors: Record<string, number>;
  /** Chunk IDs already returned in the initial response. */
  seenChunkIds: Set<string>;
  createdAtMs: number;
  expiresAtMs: number;
  isImage: boolean;
  imageBytes?: number;
}

type HandleState = {
  handles: Map<string, FollowSearchHandle>;
};

const GLOBAL_KEY = '__jina_live_follow_search_handles__';

function handleState(): HandleState {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: HandleState;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { handles: new Map() };
  }
  return g[GLOBAL_KEY]!;
}

export function resetFollowSearchHandlesForTests(): void {
  handleState().handles.clear();
}

export function createFollowSearchHandle(args: {
  cacheKey: string;
  vector: number[];
  filters: Record<string, unknown>[];
  modality: SearchModality;
  sortBy: SearchSortBy;
  size: number;
  variantId: string;
  sourceIds: string[];
  sessionIds: string[];
  sessionCursors: Record<string, number>;
  initialChunkIds: string[];
  expiresAtMs: number;
  isImage: boolean;
  imageBytes?: number;
  nowMs?: number;
  queryId?: string;
}): FollowSearchHandle {
  const nowMs = args.nowMs ?? Date.now();
  const handle: FollowSearchHandle = {
    queryId: args.queryId ?? randomUUID(),
    cacheKey: args.cacheKey,
    vector: args.vector,
    filters: args.filters,
    modality: args.modality,
    sortBy: args.sortBy,
    size: args.size,
    variantId: args.variantId,
    sourceIds: args.sourceIds,
    sessionIds: args.sessionIds,
    sessionCursors: { ...args.sessionCursors },
    seenChunkIds: new Set(args.initialChunkIds),
    createdAtMs: nowMs,
    expiresAtMs: args.expiresAtMs,
    isImage: args.isImage,
    imageBytes: args.imageBytes,
  };
  handleState().handles.set(handle.queryId, handle);
  return handle;
}

export function getFollowSearchHandle(
  queryId: string,
  nowMs: number = Date.now(),
): FollowSearchHandle {
  const handle = handleState().handles.get(queryId);
  if (!handle || handle.expiresAtMs <= nowMs) {
    if (handle) handleState().handles.delete(queryId);
    throw new LiveApiError('LIVE_QUERY_EXPIRED');
  }
  return handle;
}

export function deleteFollowSearchHandle(queryId: string): boolean {
  return handleState().handles.delete(queryId);
}

