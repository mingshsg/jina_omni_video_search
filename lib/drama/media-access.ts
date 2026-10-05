import path from 'node:path';
import type { DramaMetaPayload } from './persist-meta';
import { dramaArtifactRelativePath } from './artifact-path';

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Only published scripts, final subtitles, and approved stills are viewable.
 * Run-internal meta.json, audio, host transcripts, audit/usage files and
 * disposable frames are never authorized by a caller-controlled path alone.
 */
export function approvedDramaMediaPath(params: {
  mediaRoot: string;
  videoId: string;
  runId: string;
  rest: string[];
  drama: DramaMetaPayload | undefined;
}): string | null {
  const { mediaRoot, videoId, runId, rest, drama } = params;
  if (!drama || rest.length === 0) return null;
  const publishedRun = [drama, ...(drama.runs ?? [])].find((run) => run.run_id === runId);
  if (!publishedRun) return null;

  const root = path.resolve(mediaRoot, 'media', videoId, 'drama', runId);
  const requested = path.resolve(root, ...rest);
  if (!inside(root, requested)) return null;

  const published = [
    publishedRun.directors_script_zh_path,
    publishedRun.directors_script_en_path,
    ...(publishedRun.subtitle_paths ?? []).filter((raw) => {
      if (typeof raw !== 'string') return false;
      const relative = dramaArtifactRelativePath(raw, videoId, runId);
      if (!relative) return false;
      const match = /^subtitles\/(en|zh|ko|th)\.srt$/.exec(relative);
      return Boolean(match && publishedRun.languages.includes(match[1] as 'en' | 'zh' | 'ko' | 'th'));
    }),
    ...(publishedRun.key_scenes ?? []).map((scene) => scene.thumb_path),
    ...(publishedRun.key_actors ?? [])
      .filter((actor) => actor.verified)
      .map((actor) => actor.thumb_path),
  ];
  for (const raw of published) {
    if (typeof raw !== 'string' || !raw) continue;
    const relative = dramaArtifactRelativePath(raw, videoId, runId);
    if (!relative) continue;
    const candidate = path.resolve(root, relative);
    if (inside(root, candidate) && candidate === requested) return candidate;
  }
  return null;
}
