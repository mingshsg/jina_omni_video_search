import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvedDramaMediaPath } from './media-access';
import type { DramaMetaPayload } from './persist-meta';

const root = '/media-root';
const runRoot = path.resolve(root, 'media', 'vid1', 'drama', 'run1');
const drama: DramaMetaPayload = {
  run_id: 'run1',
  enrichment_status: 'succeeded',
  modules: ['directors_script', 'key_scenes', 'key_actors'],
  languages: ['en', 'zh'],
  subtitle_paths: [
    path.join(runRoot, 'subtitles', 'en.srt'),
    path.join(runRoot, 'subtitles', 'host_en.srt'),
  ],
  directors_script_zh_path: path.join(runRoot, 'scripts', 'directors_script_zh.md'),
  directors_script_raw_path: path.join(runRoot, 'scripts', 'directors_script_bilingual_raw.md'),
  key_scenes: [{ start_ms: 0, end_ms: 1000, thumb_path: path.join(runRoot, 'scenes', 'one.jpg') }],
  key_actors: [
    { role_zh: 'verified', verified: true, thumb_path: path.join(runRoot, 'faces', 'yes.jpg') },
    { role_zh: 'unverified', verified: false, thumb_path: path.join(runRoot, 'faces', 'no.jpg') },
  ],
};

function allowed(rest: string[], selectedDrama: DramaMetaPayload | undefined = drama, runId = 'run1') {
  return approvedDramaMediaPath({ mediaRoot: root, videoId: 'vid1', runId, rest, drama: selectedDrama });
}

describe('approvedDramaMediaPath', () => {
  it('serves only published script, final subtitle and still paths', () => {
    expect(allowed(['scripts', 'directors_script_zh.md'])).toBe(drama.directors_script_zh_path);
    expect(allowed(['subtitles', 'en.srt'])).toBe(drama.subtitle_paths?.[0]);
    expect(allowed(['scenes', 'one.jpg'])).toBe(drama.key_scenes?.[0].thumb_path);
    expect(allowed(['faces', 'yes.jpg'])).toBe(drama.key_actors?.[0].thumb_path);
  });

  it('rejects internal, raw and unverified artifacts even inside the run', () => {
    for (const rest of [
      ['meta.json'],
      ['audio', 'asr_zh.mp3'],
      ['subtitles', 'zh.srt'],
      ['subtitles', 'host_en.srt'],
      ['scripts', 'directors_script_bilingual_raw.md'],
      ['scripts', 'directors_audit.json'],
      ['frames', 't_0001s.jpg'],
      ['faces', 'no.jpg'],
      ['scenes', 'not-published.jpg'],
    ]) {
      expect(allowed(rest), rest.join('/')).toBeNull();
    }
  });

  it('rejects another generation, missing metadata and path escape', () => {
    expect(allowed(['scenes', 'one.jpg'], drama, 'other')).toBeNull();
    expect(approvedDramaMediaPath({
      mediaRoot: root,
      videoId: 'vid1',
      runId: 'run1',
      rest: ['scenes', 'one.jpg'],
      drama: undefined,
    })).toBeNull();
    expect(allowed(['..', '..', 'video.mp4'])).toBeNull();
  });
});
