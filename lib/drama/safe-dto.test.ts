import { describe, expect, it } from 'vitest';
import {
  dramaResultsFromAsset,
  dramaSummaryFromAsset,
} from './safe-dto';
import type { VideoAssetDocument } from '../es/index-assets';
import type { DramaMetaPayload } from './persist-meta';

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
    const doc = docWithMetaDrama({} as DramaMetaPayload);
    (doc.meta as Record<string, unknown>) = { revision: 1, updated_at: '' };
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
    (doc.meta as Record<string, unknown>) = { revision: 1, updated_at: '' };
    expect(dramaSummaryFromAsset(doc)).toBeUndefined();
  });
});

describe('dramaResultsFromAsset sanitizes paths', () => {
  it('drops media_path and all *_path/thumb_path fields', () => {
    const doc = docWithMetaDrama({
      run_id: 'r1',
      enrichment_status: 'succeeded',
      modules: ['directors_script', 'key_scenes'],
      languages: ['zh'],
      subtitle_paths: ['/internal/media/v1/drama/r1/zh.srt'],
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
});