import { describe, expect, it } from 'vitest';
import { loadLiveConfig } from './config';
import { createMemoryLiveEsClient } from './memory-es';
import { LiveEventRepository } from './event-repository';
import { computeEventFingerprint, eventIdFor } from './fingerprint';
import type { LiveEventDocument } from './types';

describe('LiveEventRepository.listAfterRevision', () => {
  it('returns events ordered by revision after cursor', async () => {
    const cfg = loadLiveConfig({});
    const { client } = createMemoryLiveEsClient();
    const events = new LiveEventRepository(client, cfg);
    const sessionId = 'ls_evt';

    for (const rev of [1, 2, 3]) {
      const body: Omit<LiveEventDocument, 'event_fingerprint'> = {
        '@timestamp': new Date().toISOString(),
        event_id: eventIdFor(sessionId, rev),
        session_id: sessionId,
        source_id: 'src',
        revision: rev,
        type: 'searchable',
        chunk_id: `${sessionId}_1_${rev}`,
        payload: {},
      };
      const doc: LiveEventDocument = {
        ...body,
        event_fingerprint: computeEventFingerprint(body),
      };
      await events.create(doc);
    }

    const after1 = await events.listAfterRevision(sessionId, 1);
    expect(after1.map((e) => e.revision)).toEqual([2, 3]);
  });
});
