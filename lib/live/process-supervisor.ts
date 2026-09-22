import { spawn, type ChildProcess } from 'node:child_process';
import { redactSecretsInText } from './connection-ref';
import type { FfmpegExit } from './source-adapter';

export type SupervisorState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface ProcessSupervisorOptions {
  binary?: string;
  args: readonly string[];
  /** Secrets to redact from any logged stderr. */
  redact?: Array<string | undefined>;
  connectTimeoutMs?: number;
  /** Max stderr bytes retained for classification. */
  stderrLimitBytes?: number;
  /** When true, do not kill the process on connectTimeoutMs (long-running capture). */
  disableConnectTimeout?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Called with redacted stderr chunks. */
  onStderr?: (chunk: string) => void;
  spawnImpl?: typeof spawn;
}

export interface ProcessSupervisorResult extends FfmpegExit {
  state: SupervisorState;
}

/**
 * Spawn-based FFmpeg supervisor: no shell, process-group cleanup, bounded stderr,
 * connect timeout, and graceful stop (SIGTERM then SIGKILL).
 */
export class ProcessSupervisor {
  private child: ChildProcess | null = null;
  private state: SupervisorState = 'idle';
  private stderrBuf = '';
  private timedOut = false;
  private stopRequested = false;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: Required<
    Pick<
      ProcessSupervisorOptions,
      'binary' | 'connectTimeoutMs' | 'stderrLimitBytes'
    >
  > &
    ProcessSupervisorOptions;

  constructor(opts: ProcessSupervisorOptions) {
    this.opts = {
      binary: opts.binary ?? 'ffmpeg',
      connectTimeoutMs: opts.connectTimeoutMs ?? 10_000,
      stderrLimitBytes: opts.stderrLimitBytes ?? 32_768,
      ...opts,
    };
  }

  getState(): SupervisorState {
    return this.state;
  }

  getStderrTail(): string {
    return this.stderrBuf;
  }

  /**
   * Cancel the connect timeout once media is flowing (A-17).
   * Safe to call repeatedly; no-op when already cleared or disabled.
   */
  clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  /**
   * Start the process and wait until exit (or call stop() from outside).
   */
  async run(): Promise<ProcessSupervisorResult> {
    if (this.state !== 'idle' && this.state !== 'stopped' && this.state !== 'failed') {
      throw new Error(`Cannot start supervisor from state ${this.state}`);
    }
    this.state = 'starting';
    this.stderrBuf = '';
    this.timedOut = false;
    this.stopRequested = false;
    this.connectTimeout = null;

    const spawnFn = this.opts.spawnImpl ?? spawn;
    // stdin/stdout ignored; only stderr is piped for classification/redaction.
    const child = spawnFn(this.opts.binary, [...this.opts.args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: this.opts.env ?? process.env,
      cwd: this.opts.cwd,
      detached: process.platform !== 'win32',
      shell: false,
    });
    this.child = child;
    this.state = 'running';

    if (
      !this.opts.disableConnectTimeout &&
      this.opts.connectTimeoutMs > 0
    ) {
      this.connectTimeout = setTimeout(() => {
        this.timedOut = true;
        this.connectTimeout = null;
        // Do NOT set stopRequested — timeout must be retryable, not "stopped".
        void this.killProcess('SIGKILL');
      }, this.opts.connectTimeoutMs);
    }

    const stderr = child.stderr;
    if (stderr) {
      if (typeof stderr.setEncoding === 'function') {
        stderr.setEncoding('utf8');
      }
      stderr.on('data', (chunk: string | Buffer) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const redacted = redactSecretsInText(text, this.opts.redact ?? []);
        this.stderrBuf = (this.stderrBuf + redacted).slice(
          -this.opts.stderrLimitBytes,
        );
        this.opts.onStderr?.(redacted);
        // First media / connection progress cancels connect timeout.
        if (
          this.connectTimeout &&
          /rtsp|Opening|Stream #|Video:|Audio:|Output #|hls/i.test(redacted) &&
          !this.stopRequested
        ) {
          this.clearConnectTimeout();
        }
      });
    }

    return new Promise((resolve) => {
      child.on('error', (err) => {
        this.clearConnectTimeout();
        this.state = 'failed';
        this.child = null;
        resolve({
          state: 'failed',
          code: null,
          signal: null,
          timedOut: this.timedOut,
          stopped: this.stopRequested && !this.timedOut,
          stderrTail: `${this.stderrBuf}\n${err.message}`.trim(),
        });
      });

      child.on('close', (code, signal) => {
        this.clearConnectTimeout();
        this.child = null;
        // Intentional operator/session stop only — connect-timeout kills are retryable.
        const intentionalStop = this.stopRequested && !this.timedOut;
        const stopped =
          intentionalStop ||
          (signal === 'SIGTERM' && !this.timedOut && this.stopRequested);
        this.state = stopped || code === 0 ? 'stopped' : 'failed';
        resolve({
          state: this.state,
          code,
          signal,
          timedOut: this.timedOut,
          stopped,
          stderrTail: this.stderrBuf,
        });
      });
    });
  }

  private async killProcess(signal: NodeJS.Signals): Promise<void> {
    const child = this.child;
    if (!child || child.killed) return;
    try {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      } else {
        child.kill(signal);
      }
    } catch {
      // already exited
    }
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    this.stopRequested = true;
    this.state = 'stopping';
    this.clearConnectTimeout();
    const child = this.child;
    if (!child || child.killed) {
      this.state = 'stopped';
      return;
    }
    await this.killProcess(signal);

    if (signal === 'SIGTERM') {
      await new Promise((r) => setTimeout(r, 1500));
      if (this.child && !this.child.killed) {
        await this.killProcess('SIGKILL');
      }
    }
    this.state = 'stopped';
  }
}

export interface ReconnectBackoffOptions {
  initialMs?: number;
  maxMs: number;
  factor?: number;
}

/** Capped exponential reconnect backoff. */
export function nextReconnectDelayMs(
  attempt: number,
  options: ReconnectBackoffOptions,
): number {
  const initial = options.initialMs ?? 500;
  const factor = options.factor ?? 2;
  const raw = initial * factor ** Math.max(0, attempt - 1);
  return Math.min(options.maxMs, Math.round(raw));
}
