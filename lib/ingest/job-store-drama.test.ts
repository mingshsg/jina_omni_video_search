import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { VideoAssetDocument } from '../es/index-assets';

const findAssetByJobIdMock = vi.fn();

vi.mock('../es/index-assets', () => ({
  findAssetByJobId: (...args: unknown[]) => findAssetByJobIdMock(...args),
  getAsset: vi.fn(async () => null),
  persistIngestAsset: vi.fn(async () => undefined),
}));

import { clearIngestJobs, resolveIngestJob } from './job-store';

function assetWithDrama(
  jobId: string,
  drama: unknown,
  jobDrama?: unknown,
): VideoAssetDocument {
  const now = new Date().toISOString();
  return {
    video_id: 'vid1',
    title: 'test',
    source_mode: 'upload',
    media_path: '/tmp/video.mp4',
    duration_ms: 120_000,
    width: 1280,
    height: 720,
    fps: 24,
    has_audio: true,
    size_bytes: 1,
    container: 'mp4',
    video_codec: 'h264',
    variants: [],
    status: 'ready',
    job: {
      job_id: jobId,
      stage: 'complete',
      progress_pct: 100,
      windows_total: 1,
      windows_done: 1,
      started_at: now,
      updated_at: now,
      completed_at: now,
      // I4: durable drama request/status record on the job section.
      ...(jobDrama !== undefined
        ? { drama: jobDrama as VideoAssetDocument['job']['drama'] }
        : {}),
    },
    created_at: now,
    updated_at: now,
    // meta.drama is written by persistDramaMeta outside the AssetMeta type.
    meta: {
      revision: 1,
      updated_at: now,
      drama,
    } as VideoAssetDocument['meta'],
  };
}

describe('R7 resolveIngestJob restores drama', () => {
  beforeEach(() => {
    clearIngestJobs();
    vi.clearAllMocks();
  });

  it('restores partial drama with modules_done', async () => {
    findAssetByJobIdMock.mockResolvedValueOnce(
      assetWithDrama('job-partial', {
        run_id: 'run1',
        enrichment_status: 'partial',
        modules: ['structure', 'subtitles'],
        languages: ['zh'],
        modules_done: ['structure'],
        error: { code: 'DRAMA_ENRICHMENT_ERROR', message: 'subtitles:zh: boom' },
      }),
    );
    const job = await resolveIngestJob('job-partial');
    expect(job?.drama?.status).toBe('partial');
    expect(job?.drama?.modules_done).toEqual(['structure']);
    expect(job?.drama?.run_id).toBe('run1');
    expect(job?.drama?.error?.message).toMatch(/boom/);
  });

  it('maps an interrupted running record back to pending', async () => {
    findAssetByJobIdMock.mockResolvedValueOnce(
      assetWithDrama('job-running', {
        run_id: 'run2',
        enrichment_status: 'running',
        modules: ['structure'],
        languages: [],
        modules_done: [],
      }),
    );
    const job = await resolveIngestJob('job-running');
    expect(job?.drama?.status).toBe('pending');
    expect(job?.drama?.modules).toEqual(['structure']);
  });

  it('leaves drama undefined when no durable record exists', async () => {
    findAssetByJobIdMock.mockResolvedValueOnce(assetWithDrama('job-plain', undefined));
    const job = await resolveIngestJob('job-plain');
    expect(job?.drama).toBeUndefined();
  });
});

describe('I4 marker-failure recovery through asset state', () => {
  beforeEach(() => {
    clearIngestJobs();
    vi.clearAllMocks();
  });

  it('restores a failed handoff from the job drama record (no meta.drama)', async () => {
    // The exact I4 branch: marker write failed, ready persisted.
    findAssetByJobIdMock.mockResolvedValueOnce(
      assetWithDrama(
        'job-handoff-fail',
        undefined,
        {
          status: 'failed',
          languages: ['zh'],
          modules: ['structure', 'subtitles'],
          modules_done: [],
          error_code: 'DRAMA_HANDOFF_ERROR',
          error_message: 'drama handoff marker failed: ES down',
        },
      ),
    );
    const job = await resolveIngestJob('job-handoff-fail');
    expect(job?.drama?.status).toBe('failed');
    expect(job?.drama?.modules).toEqual(['structure', 'subtitles']);
    expect(job?.drama?.error?.code).toBe('DRAMA_HANDOFF_ERROR');
    expect(job?.drama?.error?.message).toMatch(/marker failed/);
  });

  it('prefers meta.drama over the job request record', async () => {
    findAssetByJobIdMock.mockResolvedValueOnce(
      assetWithDrama(
        'job-both',
        {
          run_id: 'run9',
          enrichment_status: 'partial',
          modules: ['structure'],
          languages: [],
          modules_done: ['structure'],
        },
        {
          status: 'running',
          languages: [],
          modules: ['structure'],
          modules_done: [],
          run_id: 'run9',
        },
      ),
    );
    const job = await resolveIngestJob('job-both');
    expect(job?.drama?.status).toBe('partial');
    expect(job?.drama?.run_id).toBe('run9');
  });

  it('maps an interrupted job-record running state back to pending', async () => {
    findAssetByJobIdMock.mockResolvedValueOnce(
      assetWithDrama(
        'job-req-running',
        undefined,
        {
          status: 'running',
          languages: [],
          modules: ['structure'],
          modules_done: [],
        },
      ),
    );
    const job = await resolveIngestJob('job-req-running');
    expect(job?.drama?.status).toBe('pending');
  });
});
