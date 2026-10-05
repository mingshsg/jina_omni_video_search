import { beforeEach, describe, expect, it } from 'vitest';
import {
  dramaResultsFromAsset,
  dramaSummaryFromAsset,
} from './safe-dto';
import type { VideoAssetDocument } from '../es/index-assets';
import type { DramaMetaPayload } from './persist-meta';
import { clearDramaRunLeases, reserveDramaStart, tryAcquireDramaRun } from './run-lease';
beforeEach(() => clearDramaRunLeases());

function docWithMetaDrama(metaDrama: DramaMetaPayload): VideoAssetDocument {
  return {
    video_id: 'v1',
    title: 't',
    source_mode: 'local',
    media_path: '/internal/media/v1.mp4',
    duration_ms: 1000,
    width: 1,
    height: 1,
    fps: 1,
    has_audio: false,
    size_bytes: 1,
    container: 'mp4',
    video_codec: 'h264',
    variants: [],
    status: 'ready',
    job: {
      job_id: 'j1',
      stage: 'ready',
      progress_pct: 100,
      windows_total: 0,
      windows_done: 0,
      updated_at: '',
    },
    created_at: '',
    updated_at: '',
    meta: {
      revision: 1,
      updated_at: '',
      drama: metaDrama,
    } as VideoAssetDocument['meta'],
  };
}

describe('dramaSummaryFromAsset', () => {
  it('prefers meta.drama over job.drama', () => {
    const metaDrama: DramaMetaPayload = {
      run_id: 'r1',
      enrichment_status: 'partial',
      modules: ['subtitles'],
      languages: ['zh'],
      modules_done: ['subtitles'],
      synopsis_status: 'provisional',
      error: { code: 'DRAMA_ENRICHMENT_ERROR', message: 'subtitles:en: boom' },
    };
    const doc = {
      ...docWithMetaDrama(metaDrama),
      job: {
        ...docWithMetaDrama(metaDrama).job,
        drama: {
          status: 'succeeded',
          languages: ['zh'],
          modules: ['subtitles'],
        },
      },
    };
    const dto = dramaSummaryFromAsset(doc);
    expect(dto).toEqual({
      status: 'partial',
      languages: ['zh'],
      modules: ['subtitles'],
      modules_done: ['subtitles'],
      synopsis_status: 'provisional',
      error: 'subtitles:en: boom',
      run_id: 'r1',
    });
  });

  it('falls back to job.drama when meta.drama is absent', () => {
    tryAcquireDramaRun('v1', 'j1');
    const doc = docWithMetaDrama({} as DramaMetaPayload);
    doc.meta = { revision: 1, updated_at: '' } as unknown as VideoAssetDocument['meta'];
    doc.job.drama = {
      status: 'running',
      languages: ['ko'],
      modules: ['subtitles'],
      modules_done: [],
      run_id: 'r2',
      error_code: 'X',
      error_message: 'err',
    };
    expect(dramaSummaryFromAsset(doc)).toEqual({
      status: 'running',
      languages: ['ko'],
      modules: ['subtitles'],
      modules_done: [],
      error: 'err',
      run_id: 'r2',
    });
  });

  it('returns undefined when no drama anywhere', () => {
    const doc = docWithMetaDrama({} as DramaMetaPayload);
    doc.meta = { revision: 1, updated_at: '' } as unknown as VideoAssetDocument['meta'];
    expect(dramaSummaryFromAsset(doc)).toBeUndefined();
  });
});

describe('dramaResultsFromAsset sanitizes paths', () => {
  it('keeps earlier subtitles and scripts visible while a later structure run is active', () => {
    tryAcquireDramaRun('v1', 'j1');
    const oldRoot = '/internal/media/v1/drama/oldrun';
    const dto = dramaResultsFromAsset(docWithMetaDrama({
      run_id: 'newrun',
      enrichment_status: 'running',
      modules: ['structure'],
      modules_done: [],
      languages: [],
      runs: [{
        run_id: 'oldrun',
        enrichment_status: 'succeeded',
        modules: ['subtitles', 'directors_script'],
        modules_done: ['subtitles', 'directors_script'],
        languages: ['en', 'zh'],
        subtitle_paths: [`${oldRoot}/subtitles/en.srt`, `${oldRoot}/subtitles/zh.srt`],
        directors_script_zh_path: `${oldRoot}/scripts/zh.md`,
        synopsis_zh: '旧摘要',
        synopsis_status: 'audited',
      }],
    }))!;
    expect(dto.status).toBe('running');
    expect(dto.subtitle_urls).toEqual({
      en: '/api/drama-media/v1/oldrun/subtitles/en.srt',
      zh: '/api/drama-media/v1/oldrun/subtitles/zh.srt',
    });
    expect(dto.script_urls?.zh).toBe('/api/drama-media/v1/oldrun/scripts/zh.md');
    expect(dto.synopsis_zh).toBe('旧摘要');
    expect(dto.previous_runs).toEqual([expect.objectContaining({ run_id: 'oldrun', status: 'succeeded' })]);
    expect(dto.earlier_run_sources).toEqual({
      synopsis: 'oldrun',
      script_zh: 'oldrun',
      subtitles: { en: 'oldrun', zh: 'oldrun' },
    });
    expect(JSON.stringify(dto)).not.toContain(oldRoot);
  });

  it('labels no section when every result comes from the current run', () => {
    const dto = dramaResultsFromAsset(docWithMetaDrama({
      run_id: 'r1',
      enrichment_status: 'succeeded',
      modules: ['subtitles', 'directors_script'],
      modules_done: ['subtitles', 'directors_script'],
      languages: ['en'],
      subtitle_paths: ['subtitles/en.srt'],
      synopsis_en: 'current',
    }))!;
    expect(dto.earlier_run_sources).toBeUndefined();
  });

  it('uses the latest successful language while retaining other languages', () => {
    const dto = dramaResultsFromAsset(docWithMetaDrama({
      run_id: 'newrun',
      enrichment_status: 'partial',
      modules: ['subtitles'],
      modules_done: ['subtitles'],
      languages: ['en', 'zh'],
      subtitle_paths: ['subtitles/en.srt'],
      runs: [{
        run_id: 'oldrun', enrichment_status: 'succeeded',
        modules: ['subtitles'], modules_done: ['subtitles'], languages: ['en', 'zh'],
        subtitle_paths: ['subtitles/en.srt', 'subtitles/zh.srt'],
      }],
    }))!;
    expect(dto.subtitle_urls).toEqual({
      en: '/api/drama-media/v1/newrun/subtitles/en.srt',
      zh: '/api/drama-media/v1/oldrun/subtitles/zh.srt',
    });
    expect(dto.earlier_run_sources).toEqual({ subtitles: { zh: 'oldrun' } });
  });

  it('returns route links for published scripts and stills only', () => {
    const base = '/internal/media/v1/drama/r1';
    const doc = docWithMetaDrama({
      run_id: 'r1',
      enrichment_status: 'succeeded',
      modules: ['directors_script', 'key_scenes', 'key_actors'],
      languages: ['zh'],
      directors_script_zh_path: `${base}/scripts/zh.md`,
      directors_script_raw_path: `${base}/scripts/raw.md`,
      key_scenes: [{ start_ms: 0, end_ms: 100, thumb_path: `${base}/scenes/one.jpg` }],
      key_actors: [
        { role_zh: 'verified', verified: true, thumb_path: `${base}/faces/yes.jpg` },
        { role_zh: 'unverified', verified: false, thumb_path: `${base}/faces/no.jpg` },
      ],
    });
    const dto = dramaResultsFromAsset(doc)!;
    expect(dto.script_urls?.zh).toBe('/api/drama-media/v1/r1/scripts/zh.md');
    expect(dto.key_scenes?.[0].thumb_url).toBe('/api/drama-media/v1/r1/scenes/one.jpg');
    expect(dto.key_actors?.[0].thumb_url).toBe('/api/drama-media/v1/r1/faces/yes.jpg');
    expect(dto.key_actors?.[1].thumb_url).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain('/internal/media');
    expect(JSON.stringify(dto)).not.toContain('scripts/raw.md');
  });

  it('drops media_path and all *_path/thumb_path fields', () => {
    const doc = docWithMetaDrama({
      run_id: 'r1',
      enrichment_status: 'succeeded',
      modules: ['directors_script', 'key_scenes'],
      languages: ['zh'],
      subtitle_paths: ['/internal/media/v1/drama/r1/subtitles/zh.srt'],
      directors_script_zh_path: '/internal/script/zh.md',
      directors_script_raw_path: '/internal/script/raw.json',
      synopsis_zh: 'synopsis',
      structure: [
        {
          kind: 'body',
          start_ms: 0,
          end_ms: 1000,
          confidence: 0.5,
          source: 'heuristic',
        },
      ],
      key_scenes: [
        {
          start_ms: 0,
          end_ms: 500,
          summary_zh: 's',
          thumb_path: '/internal/thumbs/a.jpg',
        },
      ],
      key_actors: [
        {
          role_zh: 'role',
          verified: false,
          thumb_path: '/internal/faces/a.jpg',
          t_ms: 10,
        },
      ],
    });
    const dto = dramaResultsFromAsset(doc);
    expect(dto).toBeDefined();
    const raw = JSON.stringify(dto);
    expect(raw).not.toContain('/internal/media');
    expect(raw).not.toContain('/internal/script');
    expect(raw).not.toContain('/internal/thumbs');
    expect(raw).not.toContain('thumb_path');
    expect(raw).not.toContain('directors_script_zh_path');
    expect(raw).not.toContain('directors_script_en_path');
    expect(raw).not.toContain('directors_script_raw_path');
    expect(raw).not.toContain('subtitle_paths');
    expect(dto!.subtitle_count).toBe(1);
    expect(dto!.key_scenes![0]).toEqual({
      start_ms: 0,
      end_ms: 500,
      summary_zh: 's',
    });
    expect(dto!.key_actors![0]).toEqual({
      role_zh: 'role',
      verified: false,
      t_ms: 10,
    });
  });

  it('exposes published final subtitle links without exposing run paths', () => {
    const base = '/internal/media/v1/drama/r1';
    const doc = docWithMetaDrama({
      run_id: 'r1',
      enrichment_status: 'succeeded',
      modules: ['subtitles'],
      languages: ['en', 'zh'],
      subtitle_paths: [
        `${base}/subtitles/en.srt`,
        `${base}/subtitles/zh.srt`,
        `${base}/subtitles/host_en.srt`,
      ],
    });
    const dto = dramaResultsFromAsset(doc)!;
    expect(dto.subtitle_urls).toEqual({
      en: '/api/drama-media/v1/r1/subtitles/en.srt',
      zh: '/api/drama-media/v1/r1/subtitles/zh.srt',
    });
    expect(JSON.stringify(dto)).not.toContain('/internal/media');
    expect(JSON.stringify(dto)).not.toContain('host_en.srt');
  });
});

describe('interrupted enrichment recovery', () => {
  const running = () => docWithMetaDrama({ run_id: 'r1', enrichment_status: 'running', modules: ['structure'], languages: [] });
  it('surfaces an unowned running marker as retryable failure without mutating history', () => {
    const asset = running();
    expect(dramaSummaryFromAsset(asset)).toMatchObject({ status: 'failed', run_id: 'r1', error: expect.stringContaining('interrupted') });
    expect((asset.meta as VideoAssetDocument['meta'] & { drama: DramaMetaPayload }).drama.enrichment_status).toBe('running');
  });
  it('keeps a handoff reservation and a live run active', () => {
    reserveDramaStart('v1');
    expect(dramaSummaryFromAsset(running())?.status).toBe('running');
    clearDramaRunLeases(); tryAcquireDramaRun('v1', 'j1');
    expect(dramaSummaryFromAsset(running())?.status).toBe('running');
  });
  it('does not turn a pending base ingest into an interrupted enrichment', () => {
    const asset = running(); asset.status = 'processing';
    expect(dramaSummaryFromAsset(asset)?.status).toBe('running');
  });
});
