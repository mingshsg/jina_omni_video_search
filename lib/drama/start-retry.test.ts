import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestJob } from '../ingest/job-store';

const mocks = vi.hoisted(() => ({
  asset: vi.fn(), resolve: vi.fn(), get: vi.fn(), create: vi.fn(),
  handoff: vi.fn(), start: vi.fn(), update: vi.fn(),
  estimate: vi.fn(), pipeline: vi.fn(),
}));
vi.mock('../config', () => ({ getConfig: () => ({ DEFAULT_LOCALE: 'en' }) }));
vi.mock('../es/index-assets', () => ({ getAsset: mocks.asset }));
vi.mock('../ingest/job-store', () => ({
  resolveIngestJob: mocks.resolve, getIngestJob: mocks.get,
  createIngestJob: mocks.create, updateJob: mocks.update,
  toProgressEvent: (value: IngestJob) => ({ stage: value.stage }),
}));
vi.mock('../ingest/pipeline', () => ({ prepareJobEstimate: mocks.estimate, startPipelineAsync: mocks.pipeline }));
vi.mock('./runner', async () => ({
  ...(await import('./run-lease')),
  prepareDramaHandoff: mocks.handoff, startDramaEnrichmentAsync: mocks.start,
}));
vi.mock('node:fs', () => ({ default: { existsSync: () => true, statSync: () => ({ isFile: () => true }) } }));

import { POST } from '../../app/api/jobs/[id]/retry/route';
import { startExistingDrama } from './start-existing';
import { clearDramaRunLeases, isDramaWorkActive, reserveDramaStart } from './run-lease';

function job(): IngestJob {
  return {
    id: 'j1', videoId: 'v1', mode: 'upload', status: 'ready', stage: 'complete',
    mediaPath: '/media/video.mp4', createdAt: '', updatedAt: '', title: 'Video',
    probe: { duration_ms: 120000, width: 100, height: 100, fps: 25, video_codec: 'h264', container: 'mp4', has_audio: true, size_bytes: 12 },
    windowsTotal: 1, windowsDone: 1, windowsFailed: 0, progressPct: 100,
    windowErrors: [], variants: [], autoStart: true, pipelineRunning: false,
    chunking: { preset: '2s', windowMs: 2000, overlapMs: 1000, minMs: 1000 },
    drama: { status: 'partial', run_id: 'oldrun', modules: ['structure'], modules_done: ['structure'], languages: [], subtitleSource: 'auto', directorCoverage: 'sampled' },
  };
}
const options = { enabled: true as const, modules: ['structure'] as const, languages: [] as const, subtitleSource: 'auto' as const, directorCoverage: 'sampled' as const };
const startOptions = () => ({ ...options, modules: [...options.modules], languages: [...options.languages] });
const retry = () => POST(new Request('http://localhost/retry', { method: 'POST' }), { params: { id: 'j1' } });

describe('enrichment start/retry handoff', () => {
  let current: IngestJob;
  beforeEach(() => {
    vi.resetAllMocks(); clearDramaRunLeases(); current = job();
    mocks.get.mockReturnValue(current); mocks.resolve.mockResolvedValue(current);
    mocks.asset.mockResolvedValue({ video_id: 'v1', status: 'ready', duration_ms: 120000, media_path: current.mediaPath, job: { job_id: 'j1' }, meta: { drama: { enrichment_status: 'running', run_id: 'oldrun' } } });
    mocks.handoff.mockImplementation(async (value: IngestJob) => {
      expect(value.drama?.run_id).toBeUndefined();
      value.drama = { ...value.drama!, status: 'running', run_id: 'newrun' };
      return { runId: 'newrun' };
    });
    mocks.update.mockResolvedValue(undefined);
  });

  it('mints a generation and durably hands it off before returning or starting', async () => {
    const response = await retry();
    expect(response.status).toBe(200);
    expect(current.drama).toMatchObject({ run_id: 'newrun', status: 'running' });
    expect(mocks.update).toHaveBeenCalledWith(current, { drama: current.drama }, { persist: true });
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]);
  });

  it('allows Library Start after a stale running marker with no owner', async () => {
    expect(await startExistingDrama('v1', startOptions())).toMatchObject({ run_id: 'newrun' });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('rejects retry while Library Start is awaiting its asset lookup', async () => {
    let complete!: (value: unknown) => void;
    mocks.asset.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const starting = startExistingDrama('v1', startOptions());
    expect((await retry()).status).toBe(409);
    complete({ status: 'ready', duration_ms: 120000, media_path: current.mediaPath, job: { job_id: 'j1' } });
    await starting;
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('rejects Library Start while retry is awaiting its marker write', async () => {
    let complete!: () => void;
    mocks.handoff.mockImplementationOnce(async (value: IngestJob) => {
      await new Promise<void>((resolve) => { complete = resolve; });
      value.drama = { ...value.drama!, status: 'running', run_id: 'newrun' };
      return { runId: 'newrun' };
    });
    const retrying = retry();
    await vi.waitFor(() => expect(isDramaWorkActive('v1')).toBe(true));
    await expect(startExistingDrama('v1', startOptions())).rejects.toMatchObject({ status: 409 });
    complete(); await retrying;
  });

  it('restores prior job state and releases the reservation when handoff fails', async () => {
    mocks.handoff.mockRejectedValueOnce(new Error('ES unavailable'));
    expect((await retry()).status).toBe(500);
    expect(current.drama).toMatchObject({ status: 'partial', run_id: 'oldrun' });
    expect(isDramaWorkActive('v1')).toBe(false);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('respects an existing shared reservation without changing the job', async () => {
    reserveDramaStart('v1');
    expect((await retry()).status).toBe(409);
    expect(current.drama?.run_id).toBe('oldrun');
  });
});
