/**
 * Locate episode_processing scripts (git submodule vendor/episode_processing).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveEpisodeProcessingRoot } from './env';

export function episodeProcessingRoot(): string {
  return resolveEpisodeProcessingRoot();
}

export function processEpisodeScriptPath(): string {
  return path.join(
    episodeProcessingRoot(),
    'scripts',
    'process_episode.py',
  );
}

/** True when the submodule (or vendored tree) looks present. */
export function isEpisodeProcessingAvailable(): boolean {
  try {
    return fs.existsSync(processEpisodeScriptPath());
  } catch {
    return false;
  }
}
