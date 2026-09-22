import { getLiveConfig, type LiveConfig } from './config';
import {
  defaultLiveEsClient,
  getVersionedDoc,
  indexWithVersion,
  type LiveEsClient,
} from './es-doc';
import type { LiveProtectRangeDocument, VersionedDoc } from './types';

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

/** Control-index CRUD for A-20 protect/keep ranges. */
export class LiveProtectRangeRepository {
  constructor(
    private readonly client: LiveEsClient = defaultLiveEsClient(),
    private readonly cfg: LiveConfig = getLiveConfig(),
  ) {}

  private get index(): string {
    return this.cfg.ES_INDEX_LIVE_PROTECT_RANGES;
  }

  async get(
    rangeId: string,
  ): Promise<VersionedDoc<LiveProtectRangeDocument> | null> {
    return getVersionedDoc<LiveProtectRangeDocument>(
      this.client,
      this.index,
      rangeId,
    );
  }

  async create(
    doc: LiveProtectRangeDocument,
  ): Promise<VersionedDoc<LiveProtectRangeDocument>> {
    const version = await indexWithVersion(this.client, {
      index: this.index,
      id: doc.range_id,
      document: doc,
      opType: 'create',
    });
    return { id: doc.range_id, source: doc, ...version };
  }

  async listAll(
    size = 200,
  ): Promise<VersionedDoc<LiveProtectRangeDocument>[]> {
    const res = await this.client.search({
      index: this.index,
      size,
      seq_no_primary_term: true,
      query: { match_all: {} },
      sort: [{ start_at: 'asc' }, { _id: 'asc' }],
    });
    return mapSearchHits<LiveProtectRangeDocument>(res);
  }

  /**
   * Exhaust every protect range relevant to age-delete (completion A-10).
   * Pages with search_after so ranges beyond the first 500 are still honored.
   */
  async listForAgeDelete(
    sessionId?: string,
    pageSize = 200,
  ): Promise<LiveProtectRangeDocument[]> {
    const size = Math.max(1, pageSize);
    const out: LiveProtectRangeDocument[] = [];
    let searchAfter: unknown[] | undefined;

    for (;;) {
      const filters: Array<Record<string, unknown>> = [];
      if (sessionId) {
        // Global ranges (no session_id) + session-scoped ranges.
        filters.push({
          bool: {
            should: [
              { bool: { must_not: { exists: { field: 'session_id' } } } },
              { term: { session_id: sessionId } },
            ],
            minimum_should_match: 1,
          },
        });
      }
      const res = await this.client.search({
        index: this.index,
        size,
        seq_no_primary_term: true,
        query:
          filters.length > 0
            ? { bool: { filter: filters } }
            : { match_all: {} },
        sort: [{ start_at: 'asc' }, { _id: 'asc' }],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      });
      const hits =
        (
          res as {
            hits?: {
              hits?: Array<{
                _id: string;
                _source?: LiveProtectRangeDocument;
                sort?: unknown[];
              }>;
            };
          }
        ).hits?.hits ?? [];
      if (hits.length === 0) break;
      for (const h of hits) {
        if (!h._source) continue;
        out.push(h._source);
      }
      if (hits.length < size) break;
      const last = hits[hits.length - 1];
      if (!last?.sort?.length) break;
      searchAfter = last.sort;
    }

    return out;
  }

  async delete(rangeId: string): Promise<boolean> {
    const existing = await this.get(rangeId);
    if (!existing) return false;
    await this.client.delete({
      index: this.index,
      id: rangeId,
      refresh: 'wait_for',
    });
    return true;
  }
}
