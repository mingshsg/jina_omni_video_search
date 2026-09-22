import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendManifestRecord,
  manifestPath,
  pendingReplayChunkIds,
} from './fragment-manifest';
import {
  buildRecoveryWorkItem,
  reconcileSourceClaim,
  recoverSessionDir,
  scanAllSessionManifests,
} from './recovery';
import { ensureSessionSpoolLayout } from './spool-paths';
import type { LiveSessionDocument } from './types';

describe('recovery scanner', () => {
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

  function sessionDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-rec-'));
    dirs.push(root);
    const dir = path.join(root, 'sessions', 'ls_abc');
    ensureSessionSpoolLayout(dir);
    return dir;
  }

  it('abandons allocated-only windows and lists replay candidates', () => {
    const dir = sessionDir();
    const mp = manifestPath(dir);
    appendManifestRecord(mp, {
      type: 'epoch_started',
      stream_epoch: 1,
    });
    appendManifestRecord(mp, {
      type: 'window_allocated',
      chunk_id: 'ls_abc_1_1',
      stream_epoch: 1,
      sequence_no: 1,
    });
    appendManifestRecord(mp, {
      type: 'window_allocated',
      chunk_id: 'ls_abc_1_2',
      stream_epoch: 1,
      sequence_no: 2,
    });
    appendManifestRecord(mp, {
      type: 'window_finalized',
      chunk_id: 'ls_abc_1_2',
      stream_epoch: 1,
      sequence_no: 2,
    });

    const plan = recoverSessionDir(dir);
    expect(plan.abandoned_chunk_ids).toContain('ls_abc_1_1');
    expect(plan.replay_chunk_ids).toContain('ls_abc_1_2');
    expect(plan.replay_chunk_ids).not.toContain('ls_abc_1_1');
    expect(pendingReplayChunkIds(plan.records)).toEqual(['ls_abc_1_2']);
  });

  it('A-14/V-05: preserves finalize metadata for equivalent replay work items', () => {
    const dir = sessionDir();
    const mp = manifestPath(dir);
    const mediaPath = path.join(dir, 'media', 'ls_abc_1_4.mp4');
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.writeFileSync(mediaPath, 'fake-mp4');
    appendManifestRecord(mp, {
      type: 'window_finalized',
      chunk_id: 'ls_abc_1_4',
      stream_epoch: 1,
      sequence_no: 4,
      media_path: mediaPath,
      media_sha256: 'sha256:deadbeef',
      duration_ms: 8000,
      window_end_at: '2026-09-12T08:00:08.000Z',
      receive_anchor_utc: '2026-09-12T08:00:09.000Z',
      receive_anchor_monotonic_ns: '123456789012345',
    });
    appendManifestRecord(mp, {
      type: 'window_processed',
      chunk_id: 'ls_abc_1_4',
      media_sha256: 'sha256:deadbeef',
      immutable_fingerprint: 'sha256:fp1',
      duration_ms: 8000,
      window_end_at: '2026-09-12T08:00:08.000Z',
    });

    const plan = recoverSessionDir(dir);
    expect(plan.replay_chunk_ids).toEqual(['ls_abc_1_4']);
    const state = plan.windows.get('ls_abc_1_4')!;
    expect(state.media_sha256).toBe('sha256:deadbeef');
    expect(state.window_end_at).toBe('2026-09-12T08:00:08.000Z');
    expect(state.immutable_fingerprint).toBe('sha256:fp1');
    expect(state.receive_anchor_utc).toBe('2026-09-12T08:00:09.000Z');

    const item = buildRecoveryWorkItem({
      sessionId: 'ls_abc',
      sessionDir: dir,
      state,
      defaultDurationMs: 9999,
      streamEpochFallback: 99,
      nowIso: '2099-01-01T00:00:00.000Z',
    });
    expect(item.media_sha256).toBe('sha256:deadbeef');
    expect(item.window_end_at).toBe('2026-09-12T08:00:08.000Z');
    expect(item.receive_anchor_utc).toBe('2026-09-12T08:00:09.000Z');
    expect(item.duration_ms).toBe(8000);
    expect(item.media_path).toBe(mediaPath);
    expect(item.stream_epoch).toBe(1);
    expect(item.sequence_no).toBe(4);
    // Must not fall back to invented nowIso / defaultDuration when durable fields exist.
    expect(item.window_end_at).not.toBe('2099-01-01T00:00:00.000Z');
    expect(item.duration_ms).not.toBe(9999);
  });

  it('scans all session directories under spool root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-scan-'));
    dirs.push(root);
    const a = path.join(root, 'sessions', 'ls_a');
    const b = path.join(root, 'sessions', 'ls_b');
    ensureSessionSpoolLayout(a);
    ensureSessionSpoolLayout(b);
    appendManifestRecord(manifestPath(a), {
      type: 'epoch_started',
      stream_epoch: 1,
    });
    const plans = scanAllSessionManifests(root);
    expect(plans.map((p) => p.session_id).sort()).toEqual(['ls_a', 'ls_b']);
  });
});

describe('source claim reconciliation', () => {
  const baseSession = {
    session_id: 'ls_x',
    observed_state: 'live',
  } as LiveSessionDocument;

  it('keeps nonterminal claims', () => {
    expect(
      reconcileSourceClaim({
        source_id: 'src',
        active_session_id: 'ls_x',
        session: baseSession,
      }).action,
    ).toBe('keep');
  });

  it('clears missing and terminal sessions', () => {
    expect(
      reconcileSourceClaim({
        source_id: 'src',
        active_session_id: 'ls_x',
        session: null,
      }).action,
    ).toBe('clear_missing_session');
    expect(
      reconcileSourceClaim({
        source_id: 'src',
        active_session_id: 'ls_x',
        session: { ...baseSession, observed_state: 'stopped' },
      }).action,
    ).toBe('clear_terminal_session');
  });
});
