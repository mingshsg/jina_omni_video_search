import { randomUUID } from 'node:crypto';
import type { LiveConfig } from './config';
import { LiveSessionRepository } from './session-repository';
import { LiveSourceRepository } from './source-repository';
import {
  reconcileSourceClaim,
  scanAllSessionManifests,
  TERMINAL_OBSERVED,
  type SessionRecoveryPlan,
} from './recovery';
import { SessionRuntime, type SessionRuntimeHooks } from './session-supervisor';
import {
  LiveConnectionRefError,
  resolveConnectionSecret,
} from './connection-ref';
import {
  createLiveSourceAdapter,
  validateLiveSourceSecret,
} from './adapters/registry';
import { LiveSourcePolicyError, type ResolveAddressesFn } from './source-policy';
import type {
  LiveSessionDocument,
  LiveSourceDocument,
  LiveSourceValidationError,
  VersionedDoc,
} from './types';
import type { LiveWorkerCapabilityManifest } from './worker-manifest';
import { createSingleFlight, type SingleFlight } from './concurrency';

/**
 * Top-level worker loop: recover manifests, reconcile claims, poll sessions.
 */

export type ValidatePendingSourceFn = (args: {
  source: LiveSourceDocument;
  cfg: LiveConfig;
  env: NodeJS.ProcessEnv;
  resolveFn?: ResolveAddressesFn;
  capabilityManifest?: LiveWorkerCapabilityManifest;
}) => Promise<{
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
}>;

export interface LiveWorkerLoopOptions {
  cfg: LiveConfig;
  workerId: string;
  sessions?: LiveSessionRepository;
  sources?: LiveSourceRepository;
  runtimeHooks?: Partial<SessionRuntimeHooks>;
  pollIntervalMs?: number;
  env?: NodeJS.ProcessEnv;
  /** When false, skip opening capture (unit tests that only exercise poll/recovery). */
  enableCapture?: boolean;
  /** Injected for unit tests (V-01); production uses validateLiveSourceSecret. */
  validatePendingSource?: ValidatePendingSourceFn;
  resolveAddressesFn?: ResolveAddressesFn;
  /** Probed FFmpeg surface — gates SRT (and future) capability checks. */
  capabilityManifest?: LiveWorkerCapabilityManifest;
}

export class LiveWorkerLoop {
  private readonly sessions: LiveSessionRepository;
  private readonly sources: LiveSourceRepository;
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly recoveryBySession = new Map<string, SessionRecoveryPlan>();
  private stopRequested = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pollFlight: SingleFlight = createSingleFlight({
    onError: (err) => {
      console.error(
        JSON.stringify({
          ok: false,
          phase: 'worker_poll',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    },
  });

  constructor(private readonly options: LiveWorkerLoopOptions) {
    this.sessions = options.sessions ?? new LiveSessionRepository();
    this.sources = options.sources ?? new LiveSourceRepository();
  }

  get activeSessionIds(): string[] {
    return [...this.runtimes.keys()];
  }

  getRuntime(sessionId: string): SessionRuntime | undefined {
    return this.runtimes.get(sessionId);
  }

  /** Scan spool manifests and reconcile source claims before polling. */
  async bootstrap(): Promise<{
    recovery: SessionRecoveryPlan[];
    claimsCleared: number;
  }> {
    const recovery = scanAllSessionManifests(this.options.cfg.LIVE_SPOOL_DIR);
    for (const plan of recovery) {
      this.recoveryBySession.set(plan.session_id, plan);
    }

    let claimsCleared = 0;
    const claimed = await this.sources.listWithActiveClaims();
    for (const src of claimed) {
      const sessionId = src.source.active_session_id!;
      const session = await this.sessions.get(sessionId);
      const decision = reconcileSourceClaim({
        source_id: src.source.source_id,
        active_session_id: sessionId,
        session: session?.source ?? null,
      });
      if (decision.action !== 'keep') {
        await this.sources.clearActiveSessionClaim(
          src.source.source_id,
          sessionId,
        );
        claimsCleared += 1;
      }
    }
    return { recovery, claimsCleared };
  }

  startPolling(): void {
    if (this.pollTimer) return;
    const interval = this.options.pollIntervalMs ?? 1_000;
    const tick = () => {
      // A-19: skip overlapping polls; drain waits for the active one.
      void this.pollFlight.run(() => this.pollOnce());
    };
    tick();
    this.pollTimer = setInterval(tick, interval);
  }

  async pollOnce(): Promise<void> {
    if (this.stopRequested) return;

    // A-01: promote API-created sources out of pending_validation.
    await this.validatePendingSources();

    const desired = await this.sessions.listDesiredRunning();
    const desiredIds = new Set(desired.map((d) => d.id));

    // Stop runtimes whose desired state is no longer running.
    for (const [sessionId, runtime] of this.runtimes) {
      if (!desiredIds.has(sessionId)) {
        const session = await this.sessions.get(sessionId);
        await runtime.stop('stop_requested');
        // onTerminal clears claim + deletes runtime; ensure cleanup if hook skipped
        if (this.runtimes.has(sessionId)) {
          if (session) {
            await this.sources.clearActiveSessionClaim(
              session.source.source_id,
              sessionId,
            );
          }
          this.runtimes.delete(sessionId);
        }
      }
    }

    // MVP: at most one active capture runtime.
    if (this.runtimes.size >= 1) {
      return;
    }

    for (const doc of desired) {
      if (this.stopRequested) return;
      if (TERMINAL_OBSERVED.has(doc.source.observed_state)) continue;
      if (doc.source.observed_state === 'stopping') continue;
      if (this.runtimes.has(doc.id)) continue;

      await this.startSession(doc);
      break; // one stream MVP
    }
  }

  /**
   * Resolve LIVE_SOURCE_* secrets for pending sources and write ready/invalid.
   * Returns how many sources were transitioned (for tests / logging).
   */
  async validatePendingSources(): Promise<{
    validated: number;
    ready: number;
    invalid: number;
  }> {
    // Also retry `invalid` so transient/DNS policy fixes can recover without
    // forcing the operator to delete/recreate the source.
    const pending = (await this.sources.listAll()).filter(
      (s) =>
        s.source.validation_state === 'pending_validation' ||
        s.source.validation_state === 'invalid',
    );
    let ready = 0;
    let invalid = 0;
    const env = this.options.env ?? process.env;
    const validate =
      this.options.validatePendingSource ?? defaultValidatePendingSource;

    for (const doc of pending) {
      if (this.stopRequested) break;
      try {
        const result = await validate({
          source: doc.source,
          cfg: this.options.cfg,
          env,
          resolveFn: this.options.resolveAddressesFn,
          capabilityManifest: this.options.capabilityManifest,
        });
        await this.sources.updateWorkerFields(doc.source.source_id, {
          validation_state: 'ready',
          endpoint_redacted: result.endpoint_redacted,
          endpoint_fingerprint: result.endpoint_fingerprint,
          allowed_host: result.allowed_host,
          allowed_port: result.allowed_port,
          validation_error: null,
        });
        ready += 1;
      } catch (err) {
        await this.sources.updateWorkerFields(doc.source.source_id, {
          validation_state: 'invalid',
          validation_error: mapSourceValidationError(err),
        });
        invalid += 1;
      }
    }
    return { validated: ready + invalid, ready, invalid };
  }

  private async startSession(
    doc: VersionedDoc<LiveSessionDocument>,
  ): Promise<void> {
    const session = doc.source;
    const hooks: SessionRuntimeHooks = {
      updateObserved: async (sessionId, patch) => {
        const current = await this.sessions.get(sessionId);
        if (!current) return;
        const base = current.source;
        const timestamps = {
          ...base.timestamps,
          ...(patch.timestamps ?? {}),
          updated_at:
            patch.timestamps?.updated_at ?? new Date().toISOString(),
        };
        await this.sessions.updateObservedFields(sessionId, {
          ...(patch.observed_state
            ? { observed_state: patch.observed_state }
            : {}),
          ...(patch.worker_id ? { worker_id: patch.worker_id } : {}),
          ...(patch.stream_epoch !== undefined
            ? { stream_epoch: patch.stream_epoch }
            : {}),
          ...(patch.last_sequence_no_in_current_epoch !== undefined
            ? {
                last_sequence_no_in_current_epoch:
                  patch.last_sequence_no_in_current_epoch,
              }
            : {}),
          ...(patch.health ? { health: patch.health } : {}),
          ...(patch.current_error !== undefined
            ? { current_error: patch.current_error }
            : {}),
          timestamps,
        });
      },
      resolveSource: async () => {
        const secret = resolveConnectionSecret(
          session.source_snapshot.connection_ref,
          this.options.env ?? process.env,
        );
        const adapter = createLiveSourceAdapter(
          session.source_snapshot.protocol,
          this.options.cfg,
          {
            resolveFn: this.options.resolveAddressesFn,
            transport: session.source_snapshot.transport,
            requireSrtCapability: true,
            capabilityManifest: this.options.capabilityManifest,
            // Worker resolve must re-check HLS graph; allow network.
            fetchPlaylist: true,
          },
        );
        return adapter.resolve(session.source_snapshot, secret);
      },
      onTerminal: async (sessionId) => {
        await this.sources.clearActiveSessionClaim(
          session.source_id,
          sessionId,
        );
        this.runtimes.delete(sessionId);
      },
      ...this.options.runtimeHooks,
    };

    const runtime = new SessionRuntime(
      this.options.cfg,
      session,
      this.options.workerId,
      hooks,
    );
    const plan = this.recoveryBySession.get(session.session_id);
    if (plan) runtime.applyRecovery(plan);

    this.runtimes.set(session.session_id, runtime);

    if (this.options.enableCapture === false) {
      await hooks.updateObserved(session.session_id, {
        observed_state: 'connecting',
        worker_id: this.options.workerId,
      });
      return;
    }

    try {
      const secret = resolveConnectionSecret(
        session.source_snapshot.connection_ref,
        this.options.env ?? process.env,
      );
      const adapter = createLiveSourceAdapter(
        session.source_snapshot.protocol,
        this.options.cfg,
        {
          resolveFn: this.options.resolveAddressesFn,
          transport: session.source_snapshot.transport,
          requireSrtCapability: true,
          capabilityManifest: this.options.capabilityManifest,
          fetchPlaylist: true,
        },
      );
      const validated = await adapter.resolve(session.source_snapshot, secret);
      await runtime.startCapture(validated);
    } catch (err) {
      await this.sessions.updateObservedFields(session.session_id, {
        observed_state: 'failed',
        current_error: {
          code: 'LIVE_SOURCE_INVALID',
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        },
        timestamps: {
          ...session.timestamps,
          stopped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      await this.sources.clearActiveSessionClaim(
        session.source_id,
        session.session_id,
      );
      this.runtimes.delete(session.session_id);
    }
  }

  async drain(): Promise<void> {
    this.stopRequested = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.pollFlight.waitIdle();
    const stops = [...this.runtimes.values()].map((r) => r.stop('drain'));
    await Promise.all(stops);
    this.runtimes.clear();
  }
}

export function generateWorkerId(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return `live-worker_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function defaultValidatePendingSource(args: {
  source: LiveSourceDocument;
  cfg: LiveConfig;
  env: NodeJS.ProcessEnv;
  resolveFn?: ResolveAddressesFn;
  capabilityManifest?: LiveWorkerCapabilityManifest;
}): Promise<{
  endpoint_redacted: string;
  endpoint_fingerprint: string;
  allowed_host: string;
  allowed_port: number;
}> {
  const secret = resolveConnectionSecret(args.source.connection_ref, args.env);
  const validated = await validateLiveSourceSecret({
    source: args.source,
    cfg: args.cfg,
    secret,
    resolveFn: args.resolveFn,
    capabilityManifest: args.capabilityManifest,
    // Pending validation may run without a live playlist; still validate URL policy.
    // Full graph revalidation happens again at capture resolve when fetch succeeds.
    fetchPlaylist: false,
  });
  return {
    endpoint_redacted: validated.endpoint_redacted,
    endpoint_fingerprint: validated.endpoint_fingerprint,
    allowed_host: validated.allowed_host,
    allowed_port: validated.allowed_port,
  };
}

export function mapSourceValidationError(
  err: unknown,
): LiveSourceValidationError {
  const at = new Date().toISOString();
  if (err instanceof LiveSourcePolicyError) {
    return {
      code:
        err.code === 'LIVE_SOURCE_POLICY_DENIED'
          ? 'LIVE_SOURCE_FORBIDDEN'
          : err.code,
      message: err.message,
      at,
    };
  }
  if (err instanceof LiveConnectionRefError) {
    return { code: err.code, message: err.message, at };
  }
  return {
    code: 'LIVE_SOURCE_INVALID',
    message: err instanceof Error ? err.message : String(err),
    at,
  };
}
