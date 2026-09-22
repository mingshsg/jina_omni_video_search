import { getLiveConfig, type LiveConfig } from './config';
import { isVersionConflictError, VersionConflictError } from './concurrency';
import {
  defaultLiveEsClient,
  type LiveEsClient,
} from './es-doc';
import type { LiveEventDocument } from './types';

export type EventCreateResult = 'created' | 'duplicate';

/**
 * Create-only durable event writes + session revision polling for SSE.
 */
export class LiveEventRepository {
  constructor(
    private readonly client: LiveEsClient = defaultLiveEsClient(),
    private readonly cfg: LiveConfig = getLiveConfig(),
  ) {}

  private get stream(): string {
    return this.cfg.ES_DATA_STREAM_LIVE_EVENTS;
  }

  async findByEventId(
    eventId: string,
  ): Promise<LiveEventDocument | null> {
    const res = await this.client.search({
      index: this.stream,
      size: 1,
      query: { term: { event_id: eventId } },
    });
    const hit = (
      res as {
        hits: { hits: Array<{ _source?: LiveEventDocument }> };
      }
    ).hits.hits[0];
    return hit?._source ?? null;
  }

  async verifyExistingOrNull(
    doc: LiveEventDocument,
  ): Promise<EventCreateResult | null> {
    const existing = await this.findByEventId(doc.event_id);
    if (!existing) return null;
    if (existing.event_fingerprint === doc.event_fingerprint) {
      return 'duplicate';
    }
    throw new VersionConflictError(
      `event fingerprint mismatch for ${doc.event_id}`,
    );
  }

  async create(doc: LiveEventDocument): Promise<EventCreateResult> {
    const prior = await this.verifyExistingOrNull(doc);
    if (prior) return prior;

    try {
      await this.client.index({
        index: this.stream,
        id: doc.event_id,
        document: doc,
        op_type: 'create',
        refresh: 'wait_for',
      });
      return 'created';
    } catch (err) {
      if (isVersionConflictError(err)) {
        const existing = await this.findByEventId(doc.event_id);
        if (
          existing &&
          existing.event_fingerprint === doc.event_fingerprint
        ) {
          return 'duplicate';
        }
        throw new VersionConflictError(
          `event fingerprint mismatch for ${doc.event_id}`,
        );
      }
      throw err;
    }
  }

  /**
   * Poll durable events for a session with revision > afterRevision,
   * ordered ascending by revision (SSE catch-up).
   */
  async listAfterRevision(
    sessionId: string,
    afterRevision: number,
    size = 100,
  ): Promise<LiveEventDocument[]> {
    const res = await this.client.search({
      index: this.stream,
      size,
      query: {
        bool: {
          filter: [
            { term: { session_id: sessionId } },
            { range: { revision: { gt: afterRevision } } },
          ],
        },
      },
      sort: [{ revision: 'asc' }],
    });
    const hits =
      (
        res as {
          hits?: { hits?: Array<{ _source?: LiveEventDocument }> };
        }
      ).hits?.hits ?? [];
    return hits
      .map((h) => h._source)
      .filter((s): s is LiveEventDocument => Boolean(s));
  }
}
