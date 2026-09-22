import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  nextReconnectDelayMs,
  ProcessSupervisor,
} from './process-supervisor';

function mockSpawnFactory(behavior: {
  stderrChunks?: string[];
  exitCode?: number;
  emitError?: Error;
}) {
  return vi.fn((_bin: string, _args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      killed: boolean;
      pid: number;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    child.stderr = new EventEmitter();
    (child.stderr as EventEmitter & { setEncoding: (enc: string) => void }).setEncoding =
      () => undefined;
    child.killed = false;
    child.pid = 4242;
    child.kill = vi.fn(() => {
      child.killed = true;
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return true;
    });
    queueMicrotask(() => {
      for (const c of behavior.stderrChunks ?? []) {
        child.stderr.emit('data', c);
      }
      if (behavior.emitError) {
        child.emit('error', behavior.emitError);
      } else {
        child.emit('close', behavior.exitCode ?? 0, null);
      }
    });
    return child;
  });
}

describe('ProcessSupervisor', () => {
  it('spawns without shell and redacts secrets in stderr', async () => {
    const spawnImpl = mockSpawnFactory({
      stderrChunks: ['connecting with password=s3cret\n'],
      exitCode: 0,
    });
    const onStderr = vi.fn();
    const supervisor = new ProcessSupervisor({
      args: ['-i', 'rtsp://u:s3cret@127.0.0.1/x'],
      redact: ['s3cret'],
      spawnImpl: spawnImpl as never,
      onStderr,
      connectTimeoutMs: 5000,
    });
    const result = await supervisor.run();
    expect(spawnImpl).toHaveBeenCalled();
    const call = spawnImpl.mock.calls[0]!;
    // Third arg options: shell must be false
    expect(call[2]).toMatchObject({ shell: false });
    expect(result.stderrTail).not.toContain('s3cret');
    expect(onStderr.mock.calls[0]![0]).not.toContain('s3cret');
  });

  it('connect timeout kill is timedOut/not stopped (retryable)', async () => {
    const spawnImpl = vi.fn((_bin: string, _args: readonly string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        killed: boolean;
        pid: number;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      child.stderr = new EventEmitter();
      (child.stderr as EventEmitter & { setEncoding: (enc: string) => void }).setEncoding =
        () => undefined;
      child.killed = false;
      child.pid = 5252;
      child.kill = vi.fn((signal?: NodeJS.Signals) => {
        child.killed = true;
        queueMicrotask(() => child.emit('close', null, signal ?? 'SIGKILL'));
        return true;
      });
      // Never emit stderr progress — timeout should fire.
      return child;
    });
    const supervisor = new ProcessSupervisor({
      args: ['-i', 'rtsp://127.0.0.1/x'],
      spawnImpl: spawnImpl as never,
      connectTimeoutMs: 30,
    });
    const result = await supervisor.run();
    expect(result.timedOut).toBe(true);
    expect(result.stopped).toBe(false);
  });

  it('caps reconnect backoff', () => {
    expect(nextReconnectDelayMs(1, { maxMs: 10_000 })).toBe(500);
    expect(nextReconnectDelayMs(2, { maxMs: 10_000 })).toBe(1000);
    expect(nextReconnectDelayMs(20, { maxMs: 10_000 })).toBe(10_000);
  });
});
