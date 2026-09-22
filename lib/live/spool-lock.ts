import fs from 'node:fs';
import path from 'node:path';

/**
 * Process-lifetime exclusive lock on the live spool root.
 * Path: `${LIVE_SPOOL_DIR}/.worker.lock` (AD-4 / architecture spine).
 * Stale locks (dead PID) are reclaimable so a crashed worker can restart.
 */

export class SpoolLockHeldError extends Error {
  readonly code = 'SPOOL_LOCK_HELD';

  constructor(
    message: string,
    readonly lockPath: string,
    readonly holderPid?: number,
  ) {
    super(message);
    this.name = 'SpoolLockHeldError';
  }
}

export function workerLockPath(spoolRoot: string): string {
  return path.join(path.resolve(spoolRoot), '.worker.lock');
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    // EPERM means the process exists but we cannot signal it.
    return code === 'EPERM';
  }
}

function readLockPid(lockPath: string): number | undefined {
  try {
    const text = fs.readFileSync(lockPath, 'utf8');
    const line = text.split(/\r?\n/)[0]?.trim();
    if (!line) return undefined;
    const pid = Number(line);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

export interface SpoolRootLockOptions {
  /** Override for tests. */
  pid?: number;
  /** Called when a stale lock file is removed. */
  onStaleReclaim?: (stalePid: number | undefined) => void;
}

/**
 * Exclusive spool-root lock. Hold for the worker process lifetime; release on exit.
 */
export class SpoolRootLock {
  private fd: number | null = null;
  private lockPath: string | null = null;
  private readonly pid: number;

  constructor(private readonly options: SpoolRootLockOptions = {}) {
    this.pid = options.pid ?? process.pid;
  }

  get held(): boolean {
    return this.fd !== null;
  }

  get path(): string | null {
    return this.lockPath;
  }

  acquire(spoolRoot: string): void {
    if (this.fd !== null) {
      throw new Error('SpoolRootLock already acquired');
    }
    const root = path.resolve(spoolRoot);
    fs.mkdirSync(root, { recursive: true });
    const lockPath = workerLockPath(root);

    this.tryCreateExclusive(lockPath);
    this.lockPath = lockPath;
  }

  private tryCreateExclusive(lockPath: string, attempt = 0): void {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const body = `${this.pid}\n${new Date().toISOString()}\n`;
      fs.writeSync(fd, body);
      fs.fsyncSync(fd);
      this.fd = fd;
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code?: string }).code
          : undefined;
      if (code !== 'EEXIST') throw err;

      const holder = readLockPid(lockPath);
      if (holder !== undefined && isPidAlive(holder) && holder !== this.pid) {
        throw new SpoolLockHeldError(
          `Another live worker holds ${lockPath} (pid ${holder})`,
          lockPath,
          holder,
        );
      }

      // Stale or self-owned leftover — reclaim once.
      if (attempt >= 2) {
        throw new SpoolLockHeldError(
          `Unable to reclaim stale spool lock at ${lockPath}`,
          lockPath,
          holder,
        );
      }
      this.options.onStaleReclaim?.(holder);
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // concurrent reclaim race — retry
      }
      this.tryCreateExclusive(lockPath, attempt + 1);
    }
  }

  release(): void {
    if (this.fd === null || this.lockPath === null) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      // ignore
    }
    this.fd = null;
    try {
      const holder = readLockPid(this.lockPath);
      if (holder === undefined || holder === this.pid) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // ignore
    }
    this.lockPath = null;
  }
}
