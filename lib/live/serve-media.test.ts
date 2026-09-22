import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveApiError } from './errors';
import {
  promoteThumbToRetainedMedia,
  resolveLiveMediaPath,
  serveLiveSpoolFile,
} from './serve-media';
import type { LiveChunkDocument } from './types';
import type { LiveConfig } from './config';

function makeDoc(sessionId: string, chunkId: string): LiveChunkDocument {
  return {
    '@timestamp': new Date().toISOString(),
    event_ingested: new Date().toISOString(),
    chunk_id: chunkId,
    source_id: 'src',
    session_id: sessionId,
    stream_epoch: 1,
    sequence_no: 1,
    variant_id: 'var',
    window_start_at: new Date().toISOString(),
    window_end_at: new Date().toISOString(),
    start_pts_ms: 0,
    end_pts_ms: 8000,
    start_offset_ms: 0,
    end_offset_ms: 8000,
    duration_ms: 8000,
    clock: {
      mode: 'receive_anchor',
      epoch_pts_origin_ms: 0,
      epoch_anchor_utc: new Date().toISOString(),
      uncertainty_ms: 0,
    },
    discontinuity_before: false,
    media_sha256: 'sha256:x',
    immutable_fingerprint: 'fp',
    schema_version: 1,
    embedding_video: [],
    provider: 'eis',
    model: 'm',
    task: 't',
    normalized_by: 'provider',
    video_proxy: {
      bytes: 1,
      width: 1,
      height: 1,
      frames: 1,
      crf: 28,
      strategy: 'fixed',
    },
    media: {
      clip_ref: 'livemedia_clip_aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbb',
      thumb_ref: 'livemedia_thumb_aaaaaaaaaaaa_cccccccccccccccccccccccc',
      clip_expires_at: null,
      thumb_expires_at: null,
    },
    processing: {
      window_ready_at: new Date().toISOString(),
      inference_started_at: new Date().toISOString(),
      inference_finished_at: new Date().toISOString(),
      index_requested_at: new Date().toISOString(),
      worker_boot_id: 'boot',
      attempt: 1,
      queue_wait_ms: 0,
      proxy_duration_ms: 0,
      inference_duration_ms: 0,
      stage_clock: {
        window_closed: {
          worker_boot_id: 'boot',
          monotonic_ns: 0,
          utc: new Date().toISOString(),
          uncertainty_ms: 0,
        },
        inference_started: {
          worker_boot_id: 'boot',
          monotonic_ns: 0,
          utc: new Date().toISOString(),
          uncertainty_ms: 0,
        },
        inference_finished: {
          worker_boot_id: 'boot',
          monotonic_ns: 0,
          utc: new Date().toISOString(),
          uncertainty_ms: 0,
        },
        index_requested: {
          worker_boot_id: 'boot',
          monotonic_ns: 0,
          utc: new Date().toISOString(),
          uncertainty_ms: 0,
        },
      },
    },
  } as LiveChunkDocument;
}

describe('serve-media', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('resolves clip under session spool and serves Range', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-media-'));
    dirs.push(root);
    const sessionId = 'sess-1';
    const chunkId = 'sess-1_1_1';
    const sessionDir = path.join(root, 'sessions', sessionId);
    fs.mkdirSync(path.join(sessionDir, 'media'), { recursive: true });
    const filePath = path.join(sessionDir, 'media', `${chunkId}.mp4`);
    fs.writeFileSync(filePath, Buffer.from('0123456789abcdef'));

    const liveCfg = { LIVE_SPOOL_DIR: root } as LiveConfig;
    const doc = makeDoc(sessionId, chunkId);
    const resolved = await resolveLiveMediaPath({
      chunkId,
      kind: 'clip',
      liveCfg,
      chunks: {
        findByChunkId: async () => doc,
      } as never,
    });
    expect(resolved.path).toBe(fs.realpathSync(filePath));

    const res = serveLiveSpoolFile(
      resolved.path,
      new Request('http://local/media', {
        headers: { range: 'bytes=0-3' },
      }),
    );
    expect(res.status).toBe(206);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString('utf8')).toBe('0123');
  });

  it('returns LIVE_MEDIA_EXPIRED when file missing or soft-expired', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-media-'));
    dirs.push(root);
    const liveCfg = { LIVE_SPOOL_DIR: root } as LiveConfig;
    const doc = makeDoc('sess-x', 'missing');
    await expect(
      resolveLiveMediaPath({
        chunkId: 'missing',
        kind: 'thumb',
        liveCfg,
        chunks: { findByChunkId: async () => doc } as never,
      }),
    ).rejects.toBeInstanceOf(LiveApiError);

    doc.media.thumb_expires_at = '2020-01-01T00:00:00.000Z';
    await expect(
      resolveLiveMediaPath({
        chunkId: 'missing',
        kind: 'thumb',
        liveCfg,
        nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
        chunks: { findByChunkId: async () => doc } as never,
      }),
    ).rejects.toMatchObject({ code: 'LIVE_MEDIA_EXPIRED' });
  });

  it('promotes thumb from tmp to media and refuses tmp-only serve (M4)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-media-'));
    dirs.push(root);
    const sessionId = 'sess-thumb';
    const chunkId = 'sess-thumb_1_4';
    const sessionDir = path.join(root, 'sessions', sessionId);
    fs.mkdirSync(path.join(sessionDir, 'tmp'), { recursive: true });
    fs.mkdirSync(path.join(sessionDir, 'media'), { recursive: true });
    const tmpThumb = path.join(sessionDir, 'tmp', `${chunkId}.thumb.jpg`);
    fs.writeFileSync(tmpThumb, Buffer.from('jpeg-bytes'));

    const retained = promoteThumbToRetainedMedia({
      sessionDir,
      chunkId,
      tmpThumbPath: tmpThumb,
    });
    expect(retained).toBe(
      path.join(sessionDir, 'media', `${chunkId}.thumb.jpg`),
    );
    expect(fs.existsSync(tmpThumb)).toBe(false);
    expect(fs.existsSync(retained)).toBe(true);

    const liveCfg = { LIVE_SPOOL_DIR: root } as LiveConfig;
    const doc = makeDoc(sessionId, chunkId);
    const resolved = await resolveLiveMediaPath({
      chunkId,
      kind: 'thumb',
      liveCfg,
      chunks: { findByChunkId: async () => doc } as never,
    });
    expect(resolved.path).toBe(fs.realpathSync(retained));

    // tmp-only thumb must not be served after M4.
    fs.unlinkSync(retained);
    fs.writeFileSync(tmpThumb, Buffer.from('jpeg-bytes'));
    await expect(
      resolveLiveMediaPath({
        chunkId,
        kind: 'thumb',
        liveCfg,
        chunks: { findByChunkId: async () => doc } as never,
      }),
    ).rejects.toBeInstanceOf(LiveApiError);
  });

  it('rejects symlink escape outside session dir', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-media-'));
    dirs.push(root);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'live-out-'));
    dirs.push(outside);
    const secret = path.join(outside, 'secret.mp4');
    fs.writeFileSync(secret, 'secret');

    const sessionId = 'sess-sym';
    const chunkId = 'sess-sym_1_1';
    const sessionDir = path.join(root, 'sessions', sessionId);
    fs.mkdirSync(path.join(sessionDir, 'media'), { recursive: true });
    fs.symlinkSync(secret, path.join(sessionDir, 'media', `${chunkId}.mp4`));

    const liveCfg = { LIVE_SPOOL_DIR: root } as LiveConfig;
    await expect(
      resolveLiveMediaPath({
        chunkId,
        kind: 'clip',
        liveCfg,
        chunks: {
          findByChunkId: async () => makeDoc(sessionId, chunkId),
        } as never,
      }),
    ).rejects.toBeInstanceOf(LiveApiError);
  });
});
