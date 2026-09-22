import { describe, expect, it } from 'vitest';
import {
  FieldOwnershipError,
  mergeSessionApiPatch,
  mergeSessionWorkerPatch,
  mergeSourceApiPatch,
  mergeSourceWorkerPatch,
  supervisorHealthPatch,
} from './ownership';
import type { LiveSessionDocument, LiveSourceDocument } from './types';

function sampleSource(): LiveSourceDocument {
  return {
    source_id: 'src_1',
    name: 'cam',
    protocol: 'rtsp',
    source_revision: 1,
    connection_ref: 'LIVE_SOURCE_DEMO_URL',
    transport: 'tcp',
    enabled: true,
    validation_state: 'ready',
    endpoint_redacted: 'rtsp://127.0.0.1:8554/live',
    endpoint_fingerprint: 'fp',
    allowed_host: '127.0.0.1',
    allowed_port: 8554,
    created_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
  };
}

function sampleSession(): LiveSessionDocument {
  return {
    session_id: 'ls_1',
    source_id: 'src_1',
    idempotency_key: 'k1',
    desired_state: 'running',
    observed_state: 'created',
    reserved_revision: 0,
    published_revision: 0,
    stream_epoch: 0,
    last_sequence_no_in_current_epoch: 0,
    source_snapshot: {
      source_revision: 1,
      protocol: 'rtsp',
      transport: 'tcp',
      connection_ref: 'LIVE_SOURCE_DEMO_URL',
      endpoint_fingerprint: 'fp',
      allowed_host: '127.0.0.1',
      allowed_port: 8554,
    },
    variant_id: 'v1',
    retention: { mode: 'until_explicit_delete' },
    window: { fragment_ms: 2000, window_ms: 8000, overlap_ms: 2000 },
    embedding: {
      provider: 'eis',
      model: 'm',
      task: 'retrieval.passage',
      dims: 1024,
      normalized_by: 'provider',
    },
    timestamps: {
      created_at: '2026-09-10T00:00:00.000Z',
      command_requested_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    },
    health: {
      queue_depth: 0,
      queue_high_water: 0,
      indexing_batches_in_flight: 0,
      spool_bytes: 0,
      reconnect_count: 0,
      windows_searchable: 0,
      windows_failed: 0,
      windows_dropped: 0,
    },
  };
}

describe('field ownership', () => {
  it('prevents API from writing worker source fields', () => {
    expect(() =>
      mergeSourceApiPatch(
        sampleSource(),
        { validation_state: 'invalid' } as never,
        '2026-09-10T01:00:00.000Z',
      ),
    ).toThrow(FieldOwnershipError);
  });

  it('prevents worker from writing API source fields', () => {
    expect(() =>
      mergeSourceWorkerPatch(
        sampleSource(),
        { name: 'hijack' } as never,
        '2026-09-10T01:00:00.000Z',
      ),
    ).toThrow(FieldOwnershipError);
  });

  it('clears derived provenance when API changes connection fields', () => {
    const next = mergeSourceApiPatch(
      sampleSource(),
      { connection_ref: 'LIVE_SOURCE_OTHER_URL' },
      '2026-09-10T01:00:00.000Z',
    );
    expect(next.source_revision).toBe(2);
    expect(next.validation_state).toBe('pending_validation');
    expect(next.endpoint_fingerprint).toBeUndefined();
    expect(next.allowed_host).toBeUndefined();
  });

  it('prevents API from writing observed session fields', () => {
    expect(() =>
      mergeSessionApiPatch(
        sampleSession(),
        { observed_state: 'live' } as never,
        '2026-09-10T01:00:00.000Z',
      ),
    ).toThrow(FieldOwnershipError);
  });

  it('prevents worker from writing desired_state', () => {
    expect(() =>
      mergeSessionWorkerPatch(sampleSession(), {
        desired_state: 'stopped',
      } as never),
    ).toThrow(FieldOwnershipError);
  });

  it('allows each owner to update its own fields', () => {
    const api = mergeSourceApiPatch(
      sampleSource(),
      { name: 'front-door' },
      '2026-09-10T01:00:00.000Z',
    );
    expect(api.name).toBe('front-door');
    const worker = mergeSourceWorkerPatch(
      api,
      { validation_state: 'invalid' },
      '2026-09-10T01:01:00.000Z',
    );
    expect(worker.validation_state).toBe('invalid');
    expect(worker.name).toBe('front-door');
  });

  it('deep-merges health so supervisor patches preserve windows_searchable (H2)', () => {
    const base = sampleSession();
    base.health.windows_searchable = 7;
    const afterIndexer = mergeSessionWorkerPatch(base, {
      health: { windows_searchable: 8 },
      timestamps: {
        ...base.timestamps,
        last_searchable_at: '2026-09-12T00:00:00.000Z',
        updated_at: '2026-09-12T00:00:00.000Z',
      },
    });
    expect(afterIndexer.health.windows_searchable).toBe(8);

    const afterHealth = mergeSessionWorkerPatch(afterIndexer, {
      health: supervisorHealthPatch({
        ...afterIndexer.health,
        queue_depth: 3,
        reconnect_count: 2,
        windows_searchable: 0, // local counter must not be written
      }),
    });
    expect(afterHealth.health.windows_searchable).toBe(8);
    expect(afterHealth.health.queue_depth).toBe(3);
    expect(afterHealth.health.reconnect_count).toBe(2);
  });

  it('merges partial timestamps without dropping created_at', () => {
    const base = sampleSession();
    const next = mergeSessionWorkerPatch(base, {
      timestamps: { updated_at: '2026-09-13T00:00:00.000Z' },
    });
    expect(next.timestamps.created_at).toBe(base.timestamps.created_at);
    expect(next.timestamps.command_requested_at).toBe(
      base.timestamps.command_requested_at,
    );
    expect(next.timestamps.updated_at).toBe('2026-09-13T00:00:00.000Z');
  });
});
