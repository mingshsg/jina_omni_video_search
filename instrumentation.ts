/**
 * Next.js instrumentation — web process startup guards.
 * Reject LIVE_SOURCE_* secrets in the web/API surface.
 */
import { assertWebEnvHasNoLiveSourceSecrets } from './lib/live/env-surfaces';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  assertWebEnvHasNoLiveSourceSecrets();
}
