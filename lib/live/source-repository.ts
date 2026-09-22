import { getLiveConfig, type LiveConfig } from './config';
import { withOptimisticRetry, VersionConflictError } from './concurrency';
import {
  defaultLiveEsClient,
  getVersionedDoc,
  indexWithVersion,
  type LiveEsClient,
} from './es-doc';
import {
  mergeSourceApiPatch,
  mergeSourceWorkerPatch,
} from './ownership';
import type {
  LiveSourceApiFields,
  LiveSourceDocument,
  LiveSourceWorkerFields,
  VersionedDoc,
} from './types';

function mapSearchHits<T>(res: unknown): VersionedDoc<T>[] {
  const hits =
    (
      res as {
        hits?: {
          hits?: Array<{
            _id: string;
            _source?: T;
            _seq_no?: number;
            _primary_term?: number;
          }>;
        };
      }
    ).hits?.hits ?? [];
  const out: VersionedDoc<T>[] = [];
  for (const h of hits) {
    if (
      !h._source ||
      h._seq_no === undefined ||
      h._primary_term === undefined
    ) {
      continue;
    }
    out.push({
      id: h._id,
      source: h._source,
      _seq_no: h._seq_no,
      _primary_term: h._primary_term,
    });
  }
  return out;
}

export type SourceClaimResult =
  | { status: 'claimed'; source: VersionedDoc<LiveSourceDocument> }
  | { status: 'already_claimed'; source: VersionedDoc<LiveSourceDocument> }
  | {
      status: 'conflict';
      source: VersionedDoc<LiveSourceDocument>;
      activeSessionId: string;
    }
  | { status: 'not_found' }
  | { status: 'not_ready'; source: VersionedDoc<LiveSourceDocument> };

export class LiveSourceRepository {
  constructor(
    private readonly client: LiveEsClient = defaultLiveEsClient(),
    private readonly cfg: LiveConfig = getLiveConfig(),
  ) {}

  private get index(): string {
    return this.cfg.ES_INDEX_LIVE_SOURCES;
  }

  async get(sourceId: string): Promise<VersionedDoc<LiveSourceDocument> | null> {
    return getVersionedDoc<LiveSourceDocument>(this.client, this.index, sourceId);
  }

  async create(doc: LiveSourceDocument): Promise<VersionedDoc<LiveSourceDocument>> {
    const version = await indexWithVersion(this.client, {
      index: this.index,
      id: doc.source_id,
      document: doc,
      opType: 'create',
    });
    return { id: doc.source_id, source: doc, ...version };
  }

  async updateApiFields(
    sourceId: string,
    patch: Partial<LiveSourceApiFields>,
  ): Promise<VersionedDoc<LiveSourceDocument>> {
    return withOptimisticRetry(async () => {
      const current = await this.get(sourceId);
      if (!current) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      const next = mergeSourceApiPatch(
        current.source,
        patch,
        new Date().toISOString(),
      );
      const version = await indexWithVersion(this.client, {
        index: this.index,
        id: sourceId,
        document: next,
        version: current,
      });
      return { id: sourceId, source: next, ...version };
    });
  }

  async updateWorkerFields(
    sourceId: string,
    patch: Partial<LiveSourceWorkerFields>,
  ): Promise<VersionedDoc<LiveSourceDocument>> {
    return withOptimisticRetry(async () => {
      const current = await this.get(sourceId);
      if (!current) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      const next = mergeSourceWorkerPatch(
        current.source,
        patch,
        new Date().toISOString(),
      );
      const version = await indexWithVersion(this.client, {
        index: this.index,
        id: sourceId,
        document: next,
        version: current,
      });
      return { id: sourceId, source: next, ...version };
    });
  }

  /**
   * Compare-and-set `active_session_id` to the deterministic session id when
   * empty or already equal. Concurrent creates reconcile to one claim.
   */
  async claimActiveSession(
    sourceId: string,
    sessionId: string,
  ): Promise<SourceClaimResult> {
    return withOptimisticRetry(async () => {
      const current = await this.get(sourceId);
      if (!current) return { status: 'not_found' };

      if (
        current.source.validation_state !== 'ready' ||
        !current.source.enabled
      ) {
        return { status: 'not_ready', source: current };
      }

      const active = current.source.active_session_id;
      if (active && active !== sessionId) {
        return {
          status: 'conflict',
          source: current,
          activeSessionId: active,
        };
      }
      if (active === sessionId) {
        return { status: 'already_claimed', source: current };
      }

      const next: LiveSourceDocument = {
        ...current.source,
        active_session_id: sessionId,
        updated_at: new Date().toISOString(),
      };
      try {
        const version = await indexWithVersion(this.client, {
          index: this.index,
          id: sourceId,
          document: next,
          version: current,
        });
        return {
          status: 'claimed',
          source: { id: sourceId, source: next, ...version },
        };
      } catch (err) {
        if (err instanceof VersionConflictError) throw err;
        throw err;
      }
    });
  }

  /**
   * Clear active_session_id only when it still matches sessionId (terminal cleanup).
   */
  async listAll(size = 100): Promise<VersionedDoc<LiveSourceDocument>[]> {
    const res = await this.client.search({
      index: this.index,
      size,
      seq_no_primary_term: true,
      query: { match_all: {} },
    });
    return mapSearchHits<LiveSourceDocument>(res);
  }

  /** Sources that currently hold an active session claim (for startup reconcile). */
  async listWithActiveClaims(
    size = 100,
  ): Promise<VersionedDoc<LiveSourceDocument>[]> {
    // Prefer exists query when talking to real ES; memory client matches term.
    const res = await this.client.search({
      index: this.index,
      size,
      seq_no_primary_term: true,
      query: {
        bool: {
          filter: [{ exists: { field: 'active_session_id' } }],
        },
      },
    });
    const hits =
      (
        res as {
          hits?: {
            hits?: Array<{
              _id: string;
              _source?: LiveSourceDocument;
              _seq_no?: number;
              _primary_term?: number;
            }>;
          };
        }
      ).hits?.hits ?? [];
    const out: VersionedDoc<LiveSourceDocument>[] = [];
    for (const h of hits) {
      if (
        !h._source?.active_session_id ||
        h._seq_no === undefined ||
        h._primary_term === undefined
      ) {
        continue;
      }
      out.push({
        id: h._id,
        source: h._source,
        _seq_no: h._seq_no,
        _primary_term: h._primary_term,
      });
    }
    return out;
  }

  async clearActiveSessionClaim(
    sourceId: string,
    sessionId: string,
  ): Promise<VersionedDoc<LiveSourceDocument> | null> {
    return withOptimisticRetry(async () => {
      const current = await this.get(sourceId);
      if (!current) return null;
      if (current.source.active_session_id !== sessionId) {
        return current;
      }
      const next: LiveSourceDocument = {
        ...current.source,
        active_session_id: undefined,
        updated_at: new Date().toISOString(),
      };
      // Explicitly omit active_session_id by rewriting without the field.
      const { active_session_id: _removed, ...rest } = next;
      void _removed;
      const document = rest as LiveSourceDocument;
      const version = await indexWithVersion(this.client, {
        index: this.index,
        id: sourceId,
        document,
        version: current,
      });
      return { id: sourceId, source: document, ...version };
    });
  }

  /**
   * Delete the source control document. Caller must ensure no active
   * non-terminal session remains (see LiveControlService.deleteSource).
   */
  async delete(sourceId: string): Promise<boolean> {
    const existing = await this.get(sourceId);
    if (!existing) return false;
    await this.client.delete({
      index: this.index,
      id: sourceId,
      refresh: 'wait_for',
    });
    return true;
  }
}
