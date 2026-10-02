import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('local Whisper helper terminates real workers and recovers HTTP capacity after abort/timeout', async () => {
  // Standard-library Python only: fake model workers exercise actual pipes,
  // signals and sockets without MLX, downloads or private recordings.
  const result = await promisify(execFile)(process.env.VOICE_WHISPER_TEST_PYTHON ?? 'python3',
    ['-B', fileURLToPath(new URL('./whisper-server_test.py', import.meta.url))],
    { timeout: 25000, maxBuffer: 64 * 1024 });
  expect(result.stderr).toContain('Ran 12 tests');
  expect(result.stderr).toContain('OK');
}, 30000);
