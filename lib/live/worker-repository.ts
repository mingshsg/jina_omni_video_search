import { getLiveConfig, type LiveConfig } from './config';
import {
  defaultLiveEsClient,
  getVersionedDoc,
  indexWithVersion,
  type LiveEsClient,
} from './es-doc';
import {
  LIVE_WORKER_DOC_ID,
  type LiveWorkerDocument,
  type VersionedDoc,
} from './types';

export class LiveWorkerRepository {
  constructor(
    private readonly client: LiveEsClient = defaultLiveEsClient(),
    private readonly cfg: LiveConfig = getLiveConfig(),
  ) {}

  private get index(): string {
    return this.cfg.ES_INDEX_LIVE_WORKERS;
  }

  async getSingleton(): Promise<VersionedDoc<LiveWorkerDocument> | null> {
    return getVersionedDoc<LiveWorkerDocument>(
      this.client,
      this.index,
      LIVE_WORKER_DOC_ID,
    );
  }

  async publishHeartbeat(
    doc: LiveWorkerDocument,
  ): Promise<VersionedDoc<LiveWorkerDocument>> {
    const version = await indexWithVersion(this.client, {
      index: this.index,
      id: LIVE_WORKER_DOC_ID,
      document: doc,
      opType: 'index',
    });
    return { id: LIVE_WORKER_DOC_ID, source: doc, ...version };
  }

  isFresh(
    doc: LiveWorkerDocument,
    nowMs: number = Date.now(),
    staleMs: number = this.cfg.LIVE_WORKER_STALE_MS,
  ): boolean {
    const heartbeatMs = Date.parse(doc.heartbeat_at);
    if (!Number.isFinite(heartbeatMs)) return false;
    return nowMs - heartbeatMs <= staleMs;
  }
}
