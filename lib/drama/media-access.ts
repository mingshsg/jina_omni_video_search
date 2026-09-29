import path from 'node:path';
import type { DramaMetaPayload } from './persist-meta';

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Only published scripts and approved stills are downloadable. Run-internal
 * meta.json, audio, SRT, audit/usage files and disposable frames are never
 * authorized by a caller-controlled path alone.
 */
export function approvedDramaMediaPath(params: {
  mediaRoot: string;
  videoId: string;
  runId: string;
  rest: string[];
  drama: DramaMetaPayload | undefined;
}): string | null {
  const { mediaRoot, videoId, runId, rest, drama } = params;
  if (!drama || drama.run_id !== runId || rest.length === 0) return null;

  const root = path.resolve(mediaRoot, 'media', videoId, 'drama', runId);
  const requested = path.resolve(root, ...rest);
  if (!inside(root, requested)) return null;

  const published = [
    drama.directors_script_zh_path,
    drama.directors_script_en_path,
    ...(drama.key_scenes ?? []).map((scene) => scene.thumb_path),
    ...(drama.key_actors ?? [])
      .filter((actor) => actor.verified)
      .map((actor) => actor.thumb_path),
  ];
  for (const raw of published) {
    if (typeof raw !== 'string' || !raw) continue;
    const candidate = path.resolve(root, raw);
    if (inside(root, candidate) && candidate === requested) return candidate;
  }
  return null;
}
