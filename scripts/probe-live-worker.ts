/**
 * Worker capability probe — records Node/FFmpeg surface for acceptance evidence.
 * Usage: yarn probe-live-worker
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  hashCapabilities,
  probeWorkerCapabilities,
} from '../lib/live/worker-capability-probe';

async function main(): Promise<void> {
  const imageDigest = process.env.LIVE_WORKER_IMAGE_DIGEST?.trim() || undefined;
  const manifest = await probeWorkerCapabilities({ imageDigest });
  const capabilities_hash =
    manifest.capabilities_hash ?? hashCapabilities(manifest);
  const out = { ...manifest, capabilities_hash };
  const dir = path.join(process.cwd(), 'data', 'live-spool');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'worker-capabilities.json');
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, file, ...out }, null, 2));
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      null,
      2,
    ),
  );
  process.exit(1);
});
