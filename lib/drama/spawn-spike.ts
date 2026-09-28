/**
 * P0 spike: verify the episode_processing orchestrator is spawnable.
 * Full stage execution lands in P1+.
 */
import { spawn } from 'node:child_process';
import {
  isEpisodeProcessingAvailable,
  processEpisodeScriptPath,
} from './paths';

export type DramaSpawnProbeResult =
  | { ok: true; script: string; exitCode: number; stderrTail: string }
  | { ok: false; reason: 'missing_submodule' | 'spawn_failed'; detail: string };

/**
 * Run `python3 process_episode.py --help` (or argv) with a short timeout.
 * Does not process media — only proves the submodule + interpreter path.
 */
export function probeProcessEpisodeHelp(
  pythonBin = process.env.DRAMA_PYTHON_BIN || 'python3',
  timeoutMs = 15_000,
): Promise<DramaSpawnProbeResult> {
  if (!isEpisodeProcessingAvailable()) {
    return Promise.resolve({
      ok: false,
      reason: 'missing_submodule',
      detail: `expected ${processEpisodeScriptPath()}`,
    });
  }
  const script = processEpisodeScriptPath();
  return new Promise((resolve) => {
    const child = spawn(pythonBin, [script, '--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        ok: false,
        reason: 'spawn_failed',
        detail: `timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8');
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        reason: 'spawn_failed',
        detail: err.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: true,
        script,
        exitCode: code ?? -1,
        stderrTail: stderr.trim(),
      });
    });
  });
}
