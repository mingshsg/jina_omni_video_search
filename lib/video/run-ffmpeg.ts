import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Run ffmpeg or ffprobe with captured stdout/stderr. */
export async function runFfmpeg(
  binary: 'ffmpeg' | 'ffprobe',
  args: string[],
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const message =
      e.stderr?.trim() ||
      e.message ||
      `${binary} exited with code ${String(e.code ?? 'unknown')}`;
    throw new Error(`${binary} failed: ${message}`);
  }
}
