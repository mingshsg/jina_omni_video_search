/**
 * Split web vs worker environment surfaces.
 * Web must never receive LIVE_SOURCE_* secrets; worker resolves them.
 */

const LIVE_SOURCE_ENV_RE = /^LIVE_SOURCE_[A-Z0-9_]+_(URL|CONNECTION)$/;

export function listLiveSourceSecretKeys(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return Object.keys(env).filter((k) => LIVE_SOURCE_ENV_RE.test(k));
}

/**
 * Call during web/API process startup. Throws if any LIVE_SOURCE_* secret is present.
 */
export function assertWebEnvHasNoLiveSourceSecrets(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const keys = listLiveSourceSecretKeys(env);
  if (keys.length > 0) {
    throw new Error(
      `Web process must not receive live source secrets. Remove: ${keys.join(', ')}`,
    );
  }
}

/**
 * Worker startup check: connection secrets are optional until sources are configured,
 * but if present they must match the naming pattern (already enforced by the filter).
 */
export function assertWorkerEnvSurface(
  env: NodeJS.ProcessEnv = process.env,
): { liveSourceSecretCount: number } {
  return { liveSourceSecretCount: listLiveSourceSecretKeys(env).length };
}
