import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ copy: vi.fn(), create: vi.fn(), upload: vi.fn() }));
vi.mock('../config', () => ({ getConfig: () => ({ DEFAULT_LOCALE: 'en' }) }));
vi.mock('../drama/env', () => ({ getDramaEnv: () => ({ DRAMA_MAX_DURATION_MS: 1000 }) }));
vi.mock('./sources', () => ({
  BATCH_IMPORT_MAX_FILES: 20,
  importFromLocalPath: async () => ({ mediaPath: '/source/long.mp4', probe: { duration_ms: 2000 } }),
  listVideoFilesInImportFolder: async () => ['/source/long.mp4'],
  copyLocalToOriginals: mocks.copy, importFromUploadStream: mocks.upload,
}));
vi.mock('./job-store', () => ({ createIngestJob: mocks.create }));
vi.mock('./pipeline', () => ({ prepareJobEstimate: vi.fn(), startPipelineAsync: vi.fn() }));
import { POST as batch } from '../../app/api/ingest/batch/route';
import { POST as single } from '../../app/api/ingest/route';

describe('rejected local enrichment imports', () => {
  beforeEach(() => vi.clearAllMocks());
  const drama = { enabled: true, modules: ['structure'], languages: [] };
  it('returns the specific per-file reason when every batch item is rejected', async () => {
    const response = await batch(new Request('http://localhost/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'folder', path: '/source', chunk_preset: '2s', drama }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INGEST_BATCH_EMPTY' }, errors: [{ source: 'long.mp4', code: 'INGEST_DRAMA_TOO_LONG' }] });
    expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects a single local import before copying its original', async () => {
    const response = await single(new Request('http://localhost/ingest', { method: 'POST', body: JSON.stringify({ mode: 'local', source: '/source/long.mp4', chunk_preset: '2s', drama }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INGEST_DRAMA_TOO_LONG' } });
    expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('returns per-upload errors when every uploaded recording is rejected', async () => {
    mocks.upload.mockResolvedValue({ mediaPath: '/uploads/long.mp4', probe: { duration_ms: 2000 } });
    const form = new FormData();
    form.append('files', new File(['video'], 'long.mp4')); form.append('chunk_preset', '2s');
    form.append('drama_enabled', 'true'); form.append('drama_modules', 'structure');
    const response = await batch(new Request('http://localhost/batch', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ source: 'long.mp4', code: 'INGEST_DRAMA_TOO_LONG' }] });
  });
});
