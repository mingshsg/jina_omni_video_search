import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendManifestRecord,
  pendingReplayChunkIds,
  readManifestRecords,
  reduceManifestWindows,
} from './fragment-manifest';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('fragment manifest', () => {
  it('appends, truncates corrupt tail, and reduces statuses', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-manifest-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'manifest.jsonl');

    appendManifestRecord(file, {
      type: 'window_allocated',
      chunk_id: 's_1_3',
      sequence_no: 3,
      stream_epoch: 1,
    });
    appendManifestRecord(file, {
      type: 'window_finalized',
      chunk_id: 's_1_3',
    });
    appendManifestRecord(file, {
      type: 'event_intent',
      chunk_id: 's_1_3',
      revision: 1,
    });

    // Corrupt truncated final line
    fs.appendFileSync(file, '{"type":"index_ack","chunk_id":"s_1_3"', 'utf8');
    const records = readManifestRecords(file);
    expect(records).toHaveLength(3);
    expect(pendingReplayChunkIds(records)).toEqual(['s_1_3']);

    appendManifestRecord(file, {
      type: 'index_ack',
      chunk_id: 's_1_3',
      result: 'created',
    });
    const states = reduceManifestWindows(readManifestRecords(file));
    expect(states.get('s_1_3')?.status).toBe('acknowledged');
    expect(pendingReplayChunkIds(readManifestRecords(file))).toEqual([]);
  });

  it('fails hard on corruption before the final line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-manifest-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'manifest.jsonl');
    fs.writeFileSync(
      file,
      '{"type":"window_allocated","chunk_id":"a","schema_version":1,"record_id":"1","at":"t"}\n' +
        '{not-json\n' +
        '{"type":"index_ack","chunk_id":"a","schema_version":1,"record_id":"2","at":"t"}\n',
      'utf8',
    );
    expect(() => readManifestRecords(file)).toThrow(/corrupt before final/i);
  });

  it('covers crash-boundary terminal states in the reducer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-manifest-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'manifest.jsonl');
    const cases: Array<[string, string]> = [
      ['window_abandoned', 'abandoned'],
      ['window_failed', 'failed'],
      ['window_dropped', 'dropped'],
      ['window_incomplete', 'incomplete'],
      ['media_expired', 'expired'],
    ];
    for (const [type, status] of cases) {
      const chunk = `c_${type}`;
      appendManifestRecord(file, {
        type: 'window_allocated',
        chunk_id: chunk,
      } as never);
      appendManifestRecord(file, { type: type as never, chunk_id: chunk });
      expect(reduceManifestWindows(readManifestRecords(file)).get(chunk)?.status).toBe(
        status,
      );
    }
  });

  it('rejects when free bytes are below LIVE_MANIFEST_RESERVE_BYTES (A-17)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-manifest-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'manifest.jsonl');
    expect(() =>
      appendManifestRecord(
        file,
        { type: 'epoch_started', stream_epoch: 1 },
        {
          reserveBytes: 1_048_576,
          freeBytesReader: () => 100,
        },
      ),
    ).toThrow(/manifest reserve/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('appends when reserve headroom is satisfied (A-17)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-manifest-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'manifest.jsonl');
    appendManifestRecord(
      file,
      { type: 'epoch_started', stream_epoch: 1 },
      {
        reserveBytes: 1_048_576,
        freeBytesReader: () => 10_000_000,
      },
    );
    expect(readManifestRecords(file)).toHaveLength(1);
  });
});
