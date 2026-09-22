import path from 'node:path';
import {
  appendManifestRecord,
  manifestPath,
} from './fragment-manifest';
import {
  computeEventFingerprint,
  computeEventIntentSeedFingerprint,
  eventIdFor,
} from './fingerprint';
import { LiveChunkRepository } from './chunk-repository';
import { LiveEventRepository } from './event-repository';
import { LiveSessionRepository } from './session-repository';
import type { IndexAckItem } from './queue';
import type { LiveChunkDocument, LiveEventDocument } from './types';
import { sessionSpoolDir } from './spool-paths';
import type { LiveConfig } from './config';
import { getLiveConfig } from './config';

/**
 * Live searchable outbox + micro-batch indexer (Phase 5).
 *
 * Per batch:
 * 1. Reserve event revisions (CAS) + append event_intent
 * 2. Bulk create chunks with one refresh=wait_for
 * 3. Create searchable events + append index_ack / advance published_revision
 */

export interface LiveIndexDraft {
  chunk: LiveChunkDocument;
  session_dir?: string;
}

export function isLiveIndexDraft(value: unknown): value is LiveIndexDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Boolean(v.chunk && typeof v.chunk === 'object');
}

export class LiveIndexer {
  private chunksRepo: LiveChunkRepository | undefined;
  private eventsRepo: LiveEventRepository | undefined;
  private sessionsRepo: LiveSessionRepository | undefined;

  constructor(
    private readonly cfg: LiveConfig = getLiveConfig(),
    chunks?: LiveChunkRepository,
    events?: LiveEventRepository,
    sessions?: LiveSessionRepository,
  ) {
    this.chunksRepo = chunks;
    this.eventsRepo = events;
    this.sessionsRepo = sessions;
  }

  private get chunks(): LiveChunkRepository {
    if (!this.chunksRepo) {
      this.chunksRepo = new LiveChunkRepository(undefined, this.cfg);
    }
    return this.chunksRepo;
  }

  private get events(): LiveEventRepository {
    if (!this.eventsRepo) {
      this.eventsRepo = new LiveEventRepository(undefined, this.cfg);
    }
    return this.eventsRepo;
  }

  private get sessions(): LiveSessionRepository {
    if (!this.sessionsRepo) {
      this.sessionsRepo = new LiveSessionRepository(undefined, this.cfg);
    }
    return this.sessionsRepo;
  }

  /**
   * Index a micro-batch of prepared drafts from the acknowledgment queue.
   */
  async indexAckBatch(items: IndexAckItem[]): Promise<void> {
    const drafts: Array<{
      item: IndexAckItem;
      draft: LiveIndexDraft;
      revision: number;
      eventId: string;
      sessionDir: string;
    }> = [];

    for (const item of items) {
      if (!isLiveIndexDraft(item.draft)) {
        throw new Error(`Index ack item ${item.chunk_id} missing LiveIndexDraft`);
      }
      const sessionDir =
        item.draft.session_dir ??
        sessionSpoolDir(this.cfg.LIVE_SPOOL_DIR, item.session_id);
      const reserved = await this.reserveSearchableRevision(
        item.session_id,
        item.chunk_id,
        sessionDir,
      );
      drafts.push({
        item,
        draft: item.draft,
        revision: reserved.revision,
        eventId: reserved.eventId,
        sessionDir,
      });
    }

    const chunkDocs = drafts.map((d) => d.draft.chunk);
    await this.chunks.createBatch(chunkDocs);

    const searchableAt = new Date().toISOString();
    for (const d of drafts) {
      await this.publishSearchableEvent(d, searchableAt);
    }
  }

  private async reserveSearchableRevision(
    sessionId: string,
    chunkId: string,
    sessionDir: string,
  ): Promise<{ revision: number; eventId: string }> {
    const mp = manifestPath(sessionDir);
    // M1/A-13: CAS first (revision computed inside retry), then append intent.
    const reserved = await this.sessions.reserveNextRevision(sessionId);
    const revision = reserved.revision;
    const eventId = eventIdFor(sessionId, revision);
    const seed = computeEventIntentSeedFingerprint({
      event_id: eventId,
      session_id: sessionId,
      chunk_id: chunkId,
      revision,
      event_type: 'searchable',
    });

    appendManifestRecord(mp, {
      type: 'event_intent',
      chunk_id: chunkId,
      revision,
      event_id: eventId,
      event_type: 'searchable',
      seed_fingerprint: seed,
    });

    return { revision, eventId };
  }

  private async publishSearchableEvent(
    d: {
      item: IndexAckItem;
      draft: LiveIndexDraft;
      revision: number;
      eventId: string;
      sessionDir: string;
    },
    searchableAt: string,
  ): Promise<void> {
    const chunk = d.draft.chunk;
    const session = await this.sessions.get(d.item.session_id);
    if (!session) throw new Error(`Session not found: ${d.item.session_id}`);

    const indexStarted = Date.parse(chunk.processing.index_requested_at);
    const indexDurationMs = Number.isFinite(indexStarted)
      ? Math.max(0, Date.now() - indexStarted)
      : 0;
    const windowEnd = Date.parse(chunk.window_end_at);
    const processingLagMs = Number.isFinite(windowEnd)
      ? Math.max(0, Date.parse(searchableAt) - windowEnd)
      : undefined;

    const eventBody: Omit<LiveEventDocument, 'event_fingerprint'> = {
      '@timestamp': searchableAt,
      event_id: d.eventId,
      session_id: chunk.session_id,
      source_id: chunk.source_id,
      revision: d.revision,
      type: 'searchable',
      chunk_id: chunk.chunk_id,
      searchable_at: searchableAt,
      processing_lag_ms: processingLagMs,
      index_duration_ms: indexDurationMs,
      payload: {
        stream_epoch: chunk.stream_epoch,
        sequence_no: chunk.sequence_no,
        immutable_fingerprint: chunk.immutable_fingerprint,
        variant_id: chunk.variant_id,
      },
    };
    const event: LiveEventDocument = {
      ...eventBody,
      event_fingerprint: computeEventFingerprint(eventBody),
    };

    const mp = manifestPath(d.sessionDir);
    appendManifestRecord(mp, {
      type: 'event_ready',
      chunk_id: chunk.chunk_id,
      revision: d.revision,
      event_id: d.eventId,
      event_fingerprint: event.event_fingerprint,
      event,
    });

    await this.events.create(event);

    appendManifestRecord(mp, {
      type: 'event_published',
      chunk_id: chunk.chunk_id,
      revision: d.revision,
      event_id: d.eventId,
    });
    appendManifestRecord(mp, {
      type: 'index_ack',
      chunk_id: chunk.chunk_id,
      revision: d.revision,
      event_id: d.eventId,
      immutable_fingerprint: chunk.immutable_fingerprint,
    });

    const alreadyCounted = session.source.published_revision >= d.revision;
    const nextPublished = Math.max(session.source.published_revision, d.revision);
    const health = {
      ...session.source.health,
      windows_searchable: alreadyCounted
        ? session.source.health.windows_searchable
        : session.source.health.windows_searchable + 1,
    };
    await this.sessions.updateObservedFields(d.item.session_id, {
      published_revision: nextPublished,
      health,
      timestamps: {
        ...session.source.timestamps,
        last_searchable_at: searchableAt,
        updated_at: searchableAt,
      },
    });
  }
}

/** Recovery helper: ensure chunk exists or create after fingerprint check. */
export async function recoverChunkCreate(
  chunks: LiveChunkRepository,
  doc: LiveChunkDocument,
): Promise<'created' | 'duplicate'> {
  return chunks.create(doc);
}

export function sessionDirFromSpool(
  cfg: LiveConfig,
  sessionId: string,
): string {
  return path.join(cfg.LIVE_SPOOL_DIR, 'sessions', sessionId);
}
