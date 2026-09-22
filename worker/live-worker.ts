/**
 * Live video worker entrypoint (Phase 4).
 *
 * - Acquires exclusive spool-root lock
 * - Publishes singleton heartbeat / capabilities
 * - Recovers all session manifests before capture
 * - Polls desired-running sessions (one stream MVP)
 *
 * Start: yarn live-worker
 */
import { loadWorkerDotenv } from '../scripts/load-dotenv';
import {
  assertLiveSpoolWritable,
  getLiveConfig,
  resetLiveConfig,
} from '../lib/live/config';
import { assertWorkerEnvSurface } from '../lib/live/env-surfaces';
import { SpoolLockHeldError, SpoolRootLock } from '../lib/live/spool-lock';
import { LiveWorkerRepository } from '../lib/live/worker-repository';
import {
  hashCapabilities,
  probeWorkerCapabilities,
} from '../lib/live/worker-capability-probe';
import { generateWorkerId, LiveWorkerLoop } from '../lib/live/worker-loop';
import { LIVE_WORKER_DOC_ID } from '../lib/live/types';

loadWorkerDotenv();

async function main(): Promise<void> {
  resetLiveConfig();
  const cfg = getLiveConfig();
  assertLiveSpoolWritable(cfg);
  const envSurface = assertWorkerEnvSurface();

  const workerId = generateWorkerId(cfg.LIVE_WORKER_ID || undefined);
  const lock = new SpoolRootLock();
  try {
    lock.acquire(cfg.LIVE_SPOOL_DIR);
  } catch (err) {
    if (err instanceof SpoolLockHeldError) {
      console.error(
        JSON.stringify({
          ok: false,
          error: err.message,
          code: err.code,
          lockPath: err.lockPath,
          holderPid: err.holderPid,
        }),
      );
      process.exit(1);
    }
    throw err;
  }

  const releaseLock = () => {
    try {
      lock.release();
    } catch {
      // ignore
    }
  };
  process.on('exit', releaseLock);

  const imageDigest = process.env.LIVE_WORKER_IMAGE_DIGEST?.trim() || '';
  const capabilities = await probeWorkerCapabilities({
    imageDigest: imageDigest || undefined,
  });
  const capabilitiesHash =
    capabilities.capabilities_hash ?? hashCapabilities(capabilities);

  const workerRepo = new LiveWorkerRepository();
  const startedAt = new Date().toISOString();

  const publishHeartbeat = async () => {
    await workerRepo.publishHeartbeat({
      worker_id: workerId,
      started_at: startedAt,
      heartbeat_at: new Date().toISOString(),
      spool_lock_held: lock.held,
      version: process.env.npm_package_version ?? '0.1.0',
      image_digest: imageDigest || 'unpinned',
      capabilities_hash: capabilitiesHash,
    });
  };

  await publishHeartbeat();
  const heartbeatTimer = setInterval(() => {
    void publishHeartbeat().catch((err) => {
      console.error(
        JSON.stringify({
          ok: false,
          phase: 'heartbeat',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  }, Math.max(1_000, Math.floor(cfg.LIVE_WORKER_STALE_MS / 3)));

  const loop = new LiveWorkerLoop({
    cfg,
    workerId,
    enableCapture: true,
    capabilityManifest: capabilities,
  });

  const { recovery, claimsCleared } = await loop.bootstrap();
  console.log(
    JSON.stringify({
      ok: true,
      phase: 'bootstrap',
      worker_id: workerId,
      worker_doc_id: LIVE_WORKER_DOC_ID,
      spool_lock: lock.path,
      live_source_secrets: envSurface.liveSourceSecretCount,
      recovery_sessions: recovery.length,
      claims_cleared: claimsCleared,
      capabilities_hash: capabilitiesHash,
    }),
  );

  loop.startPolling();

  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ ok: true, phase: 'drain', signal }));
    clearInterval(heartbeatTimer);
    try {
      await loop.drain();
    } finally {
      releaseLock();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
