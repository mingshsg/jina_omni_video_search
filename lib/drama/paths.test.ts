import { describe, expect, it } from 'vitest';
import {
  isEpisodeProcessingAvailable,
  processEpisodeScriptPath,
} from './paths';

describe('drama episode_processing submodule', () => {
  it('resolves process_episode.py under vendor/episode_processing', () => {
    expect(isEpisodeProcessingAvailable()).toBe(true);
    expect(processEpisodeScriptPath()).toMatch(
      /vendor[/\\]episode_processing[/\\]scripts[/\\]process_episode\.py$/,
    );
  });
});
