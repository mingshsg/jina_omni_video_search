import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SpoolLockHeldError, SpoolRootLock } from './spool-lock';

describe('SpoolRootLock', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  function tmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'live-lock-'));
    dirs.push(d);
    return d;
  }

  it('acquires exclusive lock and releases', () => {
    const root = tmp();
    const a = new SpoolRootLock({ pid: 900001 });
    a.acquire(root);
    expect(a.held).toBe(true);
    expect(fs.existsSync(path.join(root, '.worker.lock'))).toBe(true);
    a.release();
    expect(a.held).toBe(false);
    expect(fs.existsSync(path.join(root, '.worker.lock'))).toBe(false);
  });

  it('refuses when another live PID holds the lock', () => {
    const root = tmp();
    const holder = new SpoolRootLock({ pid: process.pid });
    holder.acquire(root);
    const other = new SpoolRootLock({ pid: process.pid + 99999 });
    expect(() => other.acquire(root)).toThrow(SpoolLockHeldError);
    holder.release();
  });

  it('reclaims stale lock from dead PID', () => {
    const root = tmp();
    const lockPath = path.join(root, '.worker.lock');
    fs.writeFileSync(lockPath, '1\n1970-01-01T00:00:00.000Z\n', 'utf8');
    // PID 1 may be alive on some systems — use an absurd PID unlikely to exist
    fs.writeFileSync(lockPath, '2147483646\n1970-01-01T00:00:00.000Z\n', 'utf8');
    const lock = new SpoolRootLock({ pid: 900002 });
    lock.acquire(root);
    expect(lock.held).toBe(true);
    lock.release();
  });
});
