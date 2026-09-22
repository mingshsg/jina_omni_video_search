import { getLiveConfig, type LiveConfig } from './config';
import {
  defaultLiveEsClient,
  type LiveEsClient,
} from './es-doc';
import { isVersionConflictError, VersionConflictError } from './concurrency';
import type { LiveChunkDocument } from './types';

export type ChunkCreateResult = 'created' | 'duplicate';

/**
 * Create-only live chunk writes to the configured data stream.
 * Recovery callers must search by chunk_id before create (rollover caveat).
 */
export class LiveChunkRepository {
  constructor(
    private readonly client: LiveEsClient = defaultLiveEsClient(),
    private readonly cfg: LiveConfig = getLiveConfig(),
  ) {}

  private get stream(): string {
    return this.cfg.ES_DATA_STREAM_LIVE_CHUNKS;
  }

  async findByChunkId(
    chunkId: string,
  ): Promise<LiveChunkDocument | null> {
    const res = await this.client.search({
      index: this.stream,
      size: 1,
      query: { term: { chunk_id: chunkId } },
    });
    const hit = (
      res as {
        hits: { hits: Array<{ _source?: LiveChunkDocument }> };
      }
    ).hits.hits[0];
    return hit?._source ?? null;
  }

  /**
   * Acknowledge an existing hit only when immutable fingerprints match.
   */
  async verifyExistingOrNull(
    doc: LiveChunkDocument,
  ): Promise<ChunkCreateResult | null> {
    const existing = await this.findByChunkId(doc.chunk_id);
    if (!existing) return null;
    if (existing.immutable_fingerprint === doc.immutable_fingerprint) {
      return 'duplicate';
    }
    throw new VersionConflictError(
      `chunk fingerprint mismatch for ${doc.chunk_id}`,
    );
  }

  async create(doc: LiveChunkDocument): Promise<ChunkCreateResult> {
    const prior = await this.verifyExistingOrNull(doc);
    if (prior) return prior;

    try {
      await this.client.index({
        index: this.stream,
        id: doc.chunk_id,
        document: doc,
        op_type: 'create',
        refresh: 'wait_for',
      });
      return 'created';
    } catch (err) {
      if (isVersionConflictError(err)) {
        const existing = await this.findByChunkId(doc.chunk_id);
        if (
          existing &&
          existing.immutable_fingerprint === doc.immutable_fingerprint
        ) {
          return 'duplicate';
        }
        throw new VersionConflictError(
          `chunk fingerprint mismatch for ${doc.chunk_id}`,
        );
      }
      throw err;
    }
  }

  /**
   * Micro-batch create with a single refresh=wait_for (latency tuning).
   * Pre-queries by chunk_id for recovery-safe create across rollover.
   */
  async createBatch(
    docs: LiveChunkDocument[],
  ): Promise<Array<{ chunk_id: string; result: ChunkCreateResult }>> {
    if (docs.length === 0) return [];

    const results: Array<{ chunk_id: string; result: ChunkCreateResult }> = [];
    const toCreate: LiveChunkDocument[] = [];

    for (const doc of docs) {
      const prior = await this.verifyExistingOrNull(doc);
      if (prior) {
        results.push({ chunk_id: doc.chunk_id, result: prior });
      } else {
        toCreate.push(doc);
      }
    }

    if (toCreate.length === 0) return results;

    const operations = toCreate.flatMap((doc) => [
      { create: { _index: this.stream, _id: doc.chunk_id } },
      doc as unknown as Record<string, unknown>,
    ]);

    const response = await this.client.bulk({
      refresh: 'wait_for',
      operations,
    });

    const items = (response as { items?: Array<Record<string, { status?: number; error?: unknown }> > }).items ?? [];
    for (let i = 0; i < toCreate.length; i++) {
      const doc = toCreate[i]!;
      const op = items[i]?.create;
      const status = op?.status;
      if (status === 201 || status === 200) {
        results.push({ chunk_id: doc.chunk_id, result: 'created' });
        continue;
      }
      if (status === 409) {
        const verified = await this.verifyExistingOrNull(doc);
        if (verified === 'duplicate') {
          results.push({ chunk_id: doc.chunk_id, result: 'duplicate' });
          continue;
        }
        throw new VersionConflictError(
          `chunk fingerprint mismatch for ${doc.chunk_id}`,
        );
      }
      const reason =
        op?.error && typeof op.error === 'object' && op.error !== null && 'reason' in op.error
          ? String((op.error as { reason?: string }).reason)
          : JSON.stringify(op?.error ?? `status=${status}`);
      throw new Error(`bulk create failed for ${doc.chunk_id}: ${reason}`);
    }

    return results;
  }
}
