import { createHash } from 'node:crypto';

/**
 * Deterministic session id from source + idempotency key.
 * Stable across retries so source claim and create-index reconcile.
 */
export function deriveSessionId(
  sourceId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`live-session\0${sourceId}\0${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  return `ls_${digest}`;
}
