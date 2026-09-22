import fs from 'node:fs';
import path from 'node:path';
import { getLiveConfig, type LiveConfig } from './config';
import { durationTokenToMs } from './duration';
import {
  defaultLiveEsClient,
  type LiveEsClient,
} from './es-doc';
import { isTimestampProtected } from './protect-ranges';
import { LiveProtectRangeRepository } from './protect-range-repository';
import { sessionSpoolDir } from './spool-paths';
import type { LiveProtectRangeDocument } from './types';

/**
 * A-20 ops-triggered age-delete.
 * Forever retention remains the default; this runs only when operators call it.
 * Protect ranges exclude matching `window_end_at` / event `@timestamp` values.
 */

export type AgeDeleteCandidate = {
  id: string;
  /** Backing index for data-stream deletes; plain index for control docs. */
  index: string;
  session_id: string;
  /** Timestamp used for age + protect matching. */
  key_at: string;
};

export type AgeDeleteAudit = {
  dry_run: boolean;
  cutoff_at: string;
  older_than: string;
  session_id: string | null;
  chunks_matched: number;
  chunks_protected: number;
  /** Eligible after protect exclusion (planned deletes). */
  chunks_planned: number;
  /** Actually deleted from ES (0 on dry_run). */
  chunks_deleted: number;
  events_matched: number;
  events_protected: number;
  events_planned: number;
  events_deleted: number;
  /** Media files that would be unlinked (dry_run) or were unlinked. */
  media_files_planned: number;
  media_bytes_planned: number;
  media_files_deleted: number;
  media_bytes_freed: number;
  /** True when a safety page budget aborted before exhausting matches. */
  truncated: boolean;
  errors: string[];
};

export type AgeDeleteOptions = {
  /** Duration token (`24h`, `7d`, …) or positive millisecond count. */
  olderThan: string | number;
  now?: Date;
  sessionId?: string;
  dryRun?: boolean;
  client?: LiveEsClient;
  cfg?: LiveConfig;
  protectRanges?: LiveProtectRangeDocument[];
  protectRepo?: LiveProtectRangeRepository;
  /** Page size for ES search_after traversal (default 500). */
  pageSize?: number;
  /** Safety cap on candidates scanned per stream (default 100_000). */
  maxCandidates?: number;
};

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_CANDIDATES = 100_000;

function resolveOlderThanMs(olderThan: string | number): {
  ms: number;
  token: string;
} {
  if (typeof olderThan === 'number') {
    if (!Number.isFinite(olderThan) || olderThan <= 0) {
      throw new Error('olderThan must be a positive duration');
    }
    return { ms: Math.floor(olderThan), token: `${Math.floor(olderThan)}ms` };
  }
  const ms = durationTokenToMs(olderThan);
  if (ms <= 0) throw new Error('olderThan must be a positive duration');
  return { ms, token: olderThan.trim().toLowerCase() };
}

function compareUtc(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

/** Pure selection: age-eligible minus protect exclusion. */
export function selectAgeDeleteTargets(
  candidates: AgeDeleteCandidate[],
  cutoffIso: string,
  ranges: readonly LiveProtectRangeDocument[],
): {
  toDelete: AgeDeleteCandidate[];
  protectedCount: number;
  matchedCount: number;
} {
  const matched = candidates.filter(
    (c) => compareUtc(c.key_at, cutoffIso) < 0,
  );
  const toDelete: AgeDeleteCandidate[] = [];
  let protectedCount = 0;
  for (const c of matched) {
    if (isTimestampProtected(c.key_at, ranges, c.session_id)) {
      protectedCount += 1;
      continue;
    }
    toDelete.push(c);
  }
  return {
    toDelete,
    protectedCount,
    matchedCount: matched.length,
  };
}

type SearchHit = {
  candidate: AgeDeleteCandidate;
  sort: unknown[];
};

async function searchAgeCandidatesPage(
  client: LiveEsClient,
  index: string,
  timestampField: string,
  cutoffIso: string,
  sessionId: string | undefined,
  size: number,
  searchAfter?: unknown[],
): Promise<SearchHit[]> {
  const filters: Array<Record<string, unknown>> = [
    { range: { [timestampField]: { lt: cutoffIso } } },
  ];
  if (sessionId) {
    filters.push({ term: { session_id: sessionId } });
  }
  const res = await client.search({
    index,
    size,
    query: { bool: { filter: filters } },
    sort: [{ [timestampField]: 'asc' }, { _id: 'asc' }],
    ...(searchAfter ? { search_after: searchAfter } : {}),
  });
  const hits =
    (
      res as {
        hits?: {
          hits?: Array<{
            _id: string;
            _index?: string;
            _source?: Record<string, unknown>;
            sort?: unknown[];
          }>;
        };
      }
    ).hits?.hits ?? [];
  const out: SearchHit[] = [];
  for (const h of hits) {
    const src = h._source ?? {};
    const keyAt = String(src[timestampField] ?? '');
    const sid = String(src.session_id ?? '');
    if (!keyAt || !h._id) continue;
    out.push({
      candidate: {
        id: h._id,
        index: h._index ?? index,
        session_id: sid,
        key_at: keyAt,
      },
      sort: h.sort ?? [keyAt, h._id],
    });
  }
  return out;
}

/**
 * Exhaust age-eligible docs via search_after pages (completion review A-09).
 */
export async function collectAgeCandidates(
  client: LiveEsClient,
  index: string,
  timestampField: string,
  cutoffIso: string,
  sessionId: string | undefined,
  options?: { pageSize?: number; maxCandidates?: number },
): Promise<{ candidates: AgeDeleteCandidate[]; truncated: boolean }> {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE);
  const maxCandidates = Math.max(
    pageSize,
    options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
  );
  const candidates: AgeDeleteCandidate[] = [];
  let searchAfter: unknown[] | undefined;
  let truncated = false;

  for (;;) {
    const remaining = maxCandidates - candidates.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const page = await searchAgeCandidatesPage(
      client,
      index,
      timestampField,
      cutoffIso,
      sessionId,
      Math.min(pageSize, remaining),
      searchAfter,
    );
    if (page.length === 0) break;
    for (const hit of page) {
      candidates.push(hit.candidate);
    }
    if (page.length < Math.min(pageSize, remaining)) break;
    const last = page[page.length - 1];
    if (!last?.sort?.length) {
      truncated = true;
      break;
    }
    searchAfter = last.sort;
    if (candidates.length >= maxCandidates) {
      // Probe one more to see if more remain.
      const probe = await searchAgeCandidatesPage(
        client,
        index,
        timestampField,
        cutoffIso,
        sessionId,
        1,
        searchAfter,
      );
      if (probe.length > 0) truncated = true;
      break;
    }
  }

  return { candidates, truncated };
}

async function deleteDocs(
  client: LiveEsClient,
  docs: AgeDeleteCandidate[],
  dryRun: boolean,
): Promise<{ deleted: number; deletedIds: Set<string>; errors: string[] }> {
  if (docs.length === 0) {
    return { deleted: 0, deletedIds: new Set(), errors: [] };
  }
  if (dryRun) {
    return {
      deleted: 0,
      deletedIds: new Set(),
      errors: [],
    };
  }
  const errors: string[] = [];
  const deletedIds = new Set<string>();
  let deleted = 0;
  // Batch via delete_by_query when available; fall back to per-doc delete.
  if (typeof client.deleteByQuery === 'function') {
    const byIndex = new Map<string, string[]>();
    for (const d of docs) {
      const list = byIndex.get(d.index) ?? [];
      list.push(d.id);
      byIndex.set(d.index, list);
    }
    for (const [idx, ids] of byIndex) {
      try {
        const res = await client.deleteByQuery!({
          index: idx,
          refresh: true,
          query: { ids: { values: ids } },
        });
        const n = Number((res as { deleted?: number }).deleted ?? 0);
        deleted += n;
        if (n >= ids.length) {
          // Full success (or over-count): reclaim media for every requested id.
          for (const id of ids) deletedIds.add(id);
        } else {
          // Partial DBQ: only reclaim media for docs that are actually gone.
          const survivors = await findSurvivingIds(client, idx, ids);
          for (const id of ids) {
            if (!survivors.has(id)) deletedIds.add(id);
          }
          if (survivors.size > 0) {
            errors.push(
              `deleteByQuery ${idx}: partial delete (${n}/${ids.length}); ${survivors.size} docs still present`,
            );
          }
        }
      } catch (err) {
        errors.push(
          `deleteByQuery ${idx}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { deleted, deletedIds, errors };
  }

  for (const d of docs) {
    try {
      await client.delete({
        index: d.index,
        id: d.id,
        refresh: 'wait_for',
      });
      deleted += 1;
      deletedIds.add(d.id);
    } catch (err) {
      errors.push(
        `delete ${d.index}/${d.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { deleted, deletedIds, errors };
}

/**
 * After a partial delete_by_query, discover which requested ids still exist
 * so media is not unlinked for surviving search docs.
 */
async function findSurvivingIds(
  client: LiveEsClient,
  index: string,
  ids: string[],
): Promise<Set<string>> {
  const survivors = new Set<string>();
  if (ids.length === 0) return survivors;
  try {
    const res = await client.search({
      index,
      size: ids.length,
      _source: false,
      query: { ids: { values: ids } },
    });
    for (const hit of res.hits?.hits ?? []) {
      if (hit._id) survivors.add(String(hit._id));
    }
  } catch {
    // Fail closed: treat all as survivors so we do not unlink media.
    for (const id of ids) survivors.add(id);
  }
  return survivors;
}

function mediaPathsForChunk(
  spoolRoot: string,
  sessionId: string,
  chunkId: string,
): string[] {
  if (!sessionId || !chunkId) return [];
  const sessionDir = sessionSpoolDir(spoolRoot, sessionId);
  return [
    path.join(sessionDir, 'media', `${chunkId}.mp4`),
    path.join(sessionDir, 'media', `${chunkId}.thumb.jpg`),
  ];
}

function measureSessionMedia(
  spoolRoot: string,
  sessionId: string,
  chunkId: string,
): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const p of mediaPathsForChunk(spoolRoot, sessionId, chunkId)) {
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      files += 1;
      bytes += fs.statSync(p).size;
    } catch {
      // ignore
    }
  }
  return { files, bytes };
}

function unlinkSessionMedia(
  spoolRoot: string,
  sessionId: string,
  chunkId: string,
): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const p of mediaPathsForChunk(spoolRoot, sessionId, chunkId)) {
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      bytes += fs.statSync(p).size;
      fs.unlinkSync(p);
      files += 1;
    } catch {
      // Best-effort local reclaim after ES delete succeeded.
    }
  }
  return { files, bytes };
}

/**
 * Ops age-delete: remove ES chunk/event docs older than the cutoff and
 * best-effort unlink retained clip/thumb under the session spool.
 *
 * Ordering (completion A-11): delete / hide search docs first; only then
 * unlink local media for successfully deleted chunk ids.
 */
export async function runLiveAgeDelete(
  options: AgeDeleteOptions,
): Promise<AgeDeleteAudit> {
  const cfg = options.cfg ?? getLiveConfig();
  const client = options.client ?? defaultLiveEsClient();
  const { ms, token } = resolveOlderThanMs(options.olderThan);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ms);
  const cutoffIso = cutoff.toISOString();
  const dryRun = options.dryRun === true;
  const sessionId = options.sessionId?.trim() || undefined;
  const pageOpts = {
    pageSize: options.pageSize,
    maxCandidates: options.maxCandidates,
  };

  const protectRepo =
    options.protectRepo ??
    new LiveProtectRangeRepository(client, cfg);
  const ranges =
    options.protectRanges ??
    (await protectRepo.listForAgeDelete(sessionId));

  const errors: string[] = [];
  const chunkPage = await collectAgeCandidates(
    client,
    cfg.ES_DATA_STREAM_LIVE_CHUNKS,
    'window_end_at',
    cutoffIso,
    sessionId,
    pageOpts,
  );
  const eventPage = await collectAgeCandidates(
    client,
    cfg.ES_DATA_STREAM_LIVE_EVENTS,
    '@timestamp',
    cutoffIso,
    sessionId,
    pageOpts,
  );
  const truncated = chunkPage.truncated || eventPage.truncated;
  if (truncated) {
    errors.push(
      'age-delete truncated: candidate page budget exhausted before full scan',
    );
  }

  const chunkSel = selectAgeDeleteTargets(
    chunkPage.candidates,
    cutoffIso,
    ranges,
  );
  const eventSel = selectAgeDeleteTargets(
    eventPage.candidates,
    cutoffIso,
    ranges,
  );

  let mediaPlannedFiles = 0;
  let mediaPlannedBytes = 0;
  for (const c of chunkSel.toDelete) {
    const m = measureSessionMedia(cfg.LIVE_SPOOL_DIR, c.session_id, c.id);
    mediaPlannedFiles += m.files;
    mediaPlannedBytes += m.bytes;
  }

  // Refuse destructive mutation when the scan was truncated (unless dry_run):
  // operators must raise maxCandidates / continue rather than partial-delete.
  if (truncated && !dryRun) {
    return {
      dry_run: false,
      cutoff_at: cutoffIso,
      older_than: token,
      session_id: sessionId ?? null,
      chunks_matched: chunkSel.matchedCount,
      chunks_protected: chunkSel.protectedCount,
      chunks_planned: chunkSel.toDelete.length,
      chunks_deleted: 0,
      events_matched: eventSel.matchedCount,
      events_protected: eventSel.protectedCount,
      events_planned: eventSel.toDelete.length,
      events_deleted: 0,
      media_files_planned: mediaPlannedFiles,
      media_bytes_planned: mediaPlannedBytes,
      media_files_deleted: 0,
      media_bytes_freed: 0,
      truncated: true,
      errors: [
        ...errors,
        'age-delete refused mutation because candidate scan was truncated',
      ],
    };
  }

  // ES first — never unlink media when dry_run or before docs are gone.
  const chunkDel = await deleteDocs(client, chunkSel.toDelete, dryRun);
  const eventDel = await deleteDocs(client, eventSel.toDelete, dryRun);
  errors.push(...chunkDel.errors, ...eventDel.errors);

  let mediaFiles = 0;
  let mediaBytes = 0;
  if (!dryRun) {
    for (const c of chunkSel.toDelete) {
      if (!chunkDel.deletedIds.has(c.id)) continue;
      const freed = unlinkSessionMedia(
        cfg.LIVE_SPOOL_DIR,
        c.session_id,
        c.id,
      );
      mediaFiles += freed.files;
      mediaBytes += freed.bytes;
    }
  }

  return {
    dry_run: dryRun,
    cutoff_at: cutoffIso,
    older_than: token,
    session_id: sessionId ?? null,
    chunks_matched: chunkSel.matchedCount,
    chunks_protected: chunkSel.protectedCount,
    chunks_planned: chunkSel.toDelete.length,
    chunks_deleted: chunkDel.deleted,
    events_matched: eventSel.matchedCount,
    events_protected: eventSel.protectedCount,
    events_planned: eventSel.toDelete.length,
    events_deleted: eventDel.deleted,
    media_files_planned: mediaPlannedFiles,
    media_bytes_planned: mediaPlannedBytes,
    media_files_deleted: mediaFiles,
    media_bytes_freed: mediaBytes,
    truncated,
    errors,
  };
}
