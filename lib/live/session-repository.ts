import { getLiveConfig, type LiveConfig } from './config';
import { withOptimisticRetry } from './concurrency';
import {
  defaultLiveEsClient,
  getVersionedDoc,
  indexWithVersion,
  type LiveEsClient,
} from './es-doc';
import {
  mergeSessionApiPatch,
  mergeSessionWorkerPatch,
} from './ownership';
import type {
  LiveSessionDesiredFields,
  LiveSessionDocument,
  LiveSessionObservedFields,
  VersionedDoc,
} from './types';

export class LiveSessionRepository {
  constructor(
    private readonly client: LiveEsClient = defaultLiveEsClient(),
    private readonly cfg: LiveConfig = getLiveConfig(),
  ) {}

  private get index(): string {
    return this.cfg.ES_INDEX_LIVE_SESSIONS;
  }

  async get(
    sessionId: string,
  ): Promise<VersionedDoc<LiveSessionDocument> | null> {
    return getVersionedDoc<LiveSessionDocument>(
      this.client,
      this.index,
      sessionId,
    );
  }

  /** Create-if-absent; 409 means idempotent retry must verify keys. */
  async create(
    doc: LiveSessionDocument,
  ): Promise<
    | { status: 'created'; session: VersionedDoc<LiveSessionDocument> }
    | { status: 'exists'; session: VersionedDoc<LiveSessionDocument> }
  > {
    try {
      const version = await indexWithVersion(this.client, {
        index: this.index,
        id: doc.session_id,
        document: doc,
        opType: 'create',
      });
      return {
        status: 'created',
        session: { id: doc.session_id, source: doc, ...version },
      };
    } catch (err) {
      const existing = await this.get(doc.session_id);
      if (!existing) throw err;
      return { status: 'exists', session: existing };
    }
  }

  async updateDesiredState(
    sessionId: string,
    patch: Partial<LiveSessionDesiredFields>,
  ): Promise<VersionedDoc<LiveSessionDocument>> {
    return withOptimisticRetry(async () => {
      const current = await this.get(sessionId);
      if (!current) throw new Error(`Session not found: ${sessionId}`);
      const next = mergeSessionApiPatch(
        current.source,
        patch,
        new Date().toISOString(),
      );
      const version = await indexWithVersion(this.client, {
        index: this.index,
        id: sessionId,
        document: next,
        version: current,
      });
      return { id: sessionId, source: next, ...version };
    });
  }

  async updateObservedFields(
    sessionId: string,
    patch: Omit<Partial<LiveSessionObservedFields>, 'health'> & {
      health?: Partial<LiveSessionDocument['health']>;
    },
  ): Promise<VersionedDoc<LiveSessionDocument>> {
    return withOptimisticRetry(async () => {
      const current = await this.get(sessionId);
      if (!current) throw new Error(`Session not found: ${sessionId}`);
      const next = mergeSessionWorkerPatch(current.source, patch);
      const version = await indexWithVersion(this.client, {
        index: this.index,
        id: sessionId,
        document: next,
        version: current,
      });
      return { id: sessionId, source: next, ...version };
    });
  }

  /**
   * Reserve the next searchable-event revision with true CAS (M1 / A-13).
   * Revision is computed inside the optimistic retry from the latest document.
   */
  async reserveNextRevision(
    sessionId: string,
  ): Promise<{ revision: number; session: VersionedDoc<LiveSessionDocument> }> {
    return withOptimisticRetry(async () => {
      const current = await this.get(sessionId);
      if (!current) throw new Error(`Session not found: ${sessionId}`);
      const revision = current.source.reserved_revision + 1;
      const next = mergeSessionWorkerPatch(current.source, {
        reserved_revision: revision,
        timestamps: {
          updated_at: new Date().toISOString(),
        },
      });
      const version = await indexWithVersion(this.client, {
        index: this.index,
        id: sessionId,
        document: next,
        version: current,
      });
      return {
        revision,
        session: { id: sessionId, source: next, ...version },
      };
    });
  }

  /** Poll sessions the worker should drive (desired_state=running). */
  async listDesiredRunning(
    size = 50,
  ): Promise<VersionedDoc<LiveSessionDocument>[]> {
    const res = await this.client.search({
      index: this.index,
      size,
      seq_no_primary_term: true,
      query: { term: { desired_state: 'running' } },
    });
    return mapSessionHits(res);
  }

  async listBySourceId(
    sourceId: string,
    size = 20,
  ): Promise<VersionedDoc<LiveSessionDocument>[]> {
    const res = await this.client.search({
      index: this.index,
      size,
      seq_no_primary_term: true,
      query: { term: { source_id: sourceId } },
    });
    return mapSessionHits(res);
  }
}

function mapSessionHits(res: unknown): VersionedDoc<LiveSessionDocument>[] {
  const hits =
    (
      res as {
        hits?: {
          hits?: Array<{
            _id: string;
            _source?: LiveSessionDocument;
            _seq_no?: number;
            _primary_term?: number;
          }>;
        };
      }
    ).hits?.hits ?? [];
  const out: VersionedDoc<LiveSessionDocument>[] = [];
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
