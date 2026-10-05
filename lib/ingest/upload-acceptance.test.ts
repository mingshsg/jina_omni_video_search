import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config';
const probe = vi.hoisted(() => ({ duration_ms: 1000, width: 100, height: 100, fps: 25, video_codec: 'h264', container: 'mp4', has_audio: true, size_bytes: 5 }));
vi.mock('./validate-probe', () => ({ validateMediaProbe: vi.fn(async () => probe) }));
import { importFromUploadStream } from './sources';
import { IngestError } from './errors';

// Test artifacts are preserved in the OS temp directory, matching the no-deletion rule.
describe('upload acceptance before media promotion', () => {
  const cfg = () => ({ MEDIA_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'jve-acceptance-')), MAX_SOURCE_BYTES: 100 } as AppConfig);
  it('quarantines a rejected recording without an accepted original or data loss', async () => {
    const config = cfg();
    await expect(importFromUploadStream(Readable.from([Buffer.from('video')]), 'clip.mp4', config, () => { throw new IngestError('INGEST_DRAMA_TOO_LONG'); }))
      .rejects.toMatchObject({ code: 'INGEST_DRAMA_TOO_LONG' });
    expect(fs.readdirSync(path.join(config.MEDIA_ROOT, 'uploads'))).toEqual([]);
    const rejected = fs.readdirSync(path.join(config.MEDIA_ROOT, 'quarantine'));
    expect(rejected).toHaveLength(1);
    expect(fs.readFileSync(path.join(config.MEDIA_ROOT, 'quarantine', rejected[0]), 'utf8')).toBe('video');
  });
  it('retains the original upload contract when no enrichment is requested', async () => {
    const config = cfg();
    const result = await importFromUploadStream(Readable.from([Buffer.from('video')]), 'clip.mp4', config);
    expect(result.probe).toEqual(probe);
    expect(fs.readFileSync(result.mediaPath, 'utf8')).toBe('video');
    expect(fs.readdirSync(path.join(config.MEDIA_ROOT, 'uploads'))).toHaveLength(1);
  });
});
