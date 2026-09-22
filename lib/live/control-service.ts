import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';
import {
  deriveVariantId,
  normalizedByForProvider,
  type ChunkingConfig,
} from '../ingest/variant';
import { getLiveConfig, type LiveConfig } from './config';
import { isValidConnectionRefName } from './connection-ref';
import { LiveApiError } from './errors';
import { liveProxySettings } from './live-proxy-ladder';
import { deriveSessionId } from './session-id';
import { LiveSessionRepository } from './session-repository';
import { LiveSourceRepository } from './source-repository';
import { LiveWorkerRepository } from './worker-repository';
import {
  publicSessionCreateResponse,
  sessionIsNonterminal,
  workerHeartbeatFresh,
} from './api-sanitize';
import type {
  LiveSessionDocument,
  LiveSourceDocument,
  LiveSourceSnapshot,
} from './types';
import { isTerminalObservedState } from './types';
import {
  enabledLiveProtocols,
  isLiveProtocolEnabled,
  transportsForProtocol,
} from './adapters/registry';

export interface CreateSourceInput {
  name: string;
  protocol: LiveSourceDocument['protocol'];
  connection_ref: string;
  transport?: LiveSourceDocument['transport'];
  enabled?: boolean;
}

export interface CreateSessionInput {
  source_id: string;
  idempotency_key: string;
  force_new?: boolean;
  window?: {
    fragment_ms?: number;
    window_ms?: number;
    overlap_ms?: number;
  };
}

export function deriveLiveVariantId(args: {
  windowMs: number;
  overlapMs: number;
  fragmentMs: number;
  liveCfg?: LiveConfig;
}): string {
  const liveCfg = args.liveCfg ?? getLiveConfig();
  const appCfg = getConfig();
  const proxySettings = liveProxySettings({
    maxLongEdge: liveCfg.LIVE_PROXY_MAX_LONG_EDGE,
    maxAttempts: liveCfg.LIVE_PROXY_MAX_ATTEMPTS,
  });
  const chunking: ChunkingConfig = {
    preset: 'standard',
    windowMs: args.windowMs,
    overlapMs: args.overlapMs,
    minMs: args.fragmentMs,
  };
  return deriveVariantId({
    chunking,
    provider: appCfg.EMBED_PROVIDER,
    model: appCfg.EMBED_MODEL,
    task: appCfg.EMBED_TASK_PASSAGE,
    dims: appCfg.EMBED_DIMS,
    normalizedBy: normalizedByForProvider(appCfg.EMBED_PROVIDER),
    proxySettings,
    schemaVersion: appCfg.SCHEMA_VERSION,
  });
}

function validateWindowDurations(args: {
  fragment_ms: number;
  window_ms: number;
  overlap_ms: number;
}): void {
  const { fragment_ms, window_ms, overlap_ms } = args;
  if (
    !Number.isInteger(fragment_ms) ||
    !Number.isInteger(window_ms) ||
    !Number.isInteger(overlap_ms) ||
    fragment_ms <= 0 ||
    window_ms <= 0 ||
    overlap_ms < 0
  ) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'window durations must be positive integers',
    });
  }
  if (overlap_ms >= window_ms) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'overlap_ms must be < window_ms',
    });
  }
  if (window_ms % fragment_ms !== 0) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'window_ms must be divisible by fragment_ms',
    });
  }
  const step = window_ms - overlap_ms;
  if (step <= 0 || step % fragment_ms !== 0) {
    throw new LiveApiError('LIVE_INVALID_REQUEST', {
      message: 'window step must be positive and divisible by fragment_ms',
    });
  }
}

export class LiveControlService {
  constructor(
    private readonly sources: LiveSourceRepository = new LiveSourceRepository(),
    private readonly sessions: LiveSessionRepository = new LiveSessionRepository(),
    private readonly workers: LiveWorkerRepository = new LiveWorkerRepository(),
    private readonly cfg: LiveConfig = getLiveConfig(),
  ) {}

  async assertWorkerFresh(): Promise<void> {
    const doc = await this.workers.getSingleton();
    if (!workerHeartbeatFresh(doc?.source, this.cfg.LIVE_WORKER_STALE_MS)) {
      throw new LiveApiError('LIVE_WORKER_UNAVAILABLE');
    }
  }

  async createSource(input: CreateSourceInput): Promise<LiveSourceDocument> {
    if (!isLiveProtocolEnabled(input.protocol, this.cfg)) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: `Protocol "${input.protocol}" is not enabled (LIVE_ALLOWED_PROTOCOLS=${enabledLiveProtocols(this.cfg).join(',') || 'none'})`,
      });
    }
    if (!isValidConnectionRefName(input.connection_ref)) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: 'connection_ref name is invalid',
      });
    }
    const allowedTransports = transportsForProtocol(input.protocol);
    const transport = input.transport ?? allowedTransports[0];
    if (!transport || !allowedTransports.includes(transport)) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: `Protocol ${input.protocol} requires transport in [${allowedTransports.join(', ')}]`,
      });
    }
    // RTSP MVP / WHIP subscribe stay TCP-only even if udp appears elsewhere.
    if (
      (input.protocol === 'rtsp' || input.protocol === 'whip') &&
      transport !== 'tcp'
    ) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: `${input.protocol} requires transport tcp`,
      });
    }
    const now = new Date().toISOString();
    const doc: LiveSourceDocument = {
      source_id: randomUUID(),
      name: input.name.trim(),
      protocol: input.protocol,
      connection_ref: input.connection_ref,
      transport,
      enabled: input.enabled ?? true,
      validation_state: 'pending_validation',
      source_revision: 1,
      created_at: now,
      updated_at: now,
    };
    if (!doc.name) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', { message: 'name is required' });
    }
    const created = await this.sources.create(doc);
    return created.source;
  }

  async patchSource(
    sourceId: string,
    patch: Partial<{
      name: string;
      connection_ref: string;
      transport: LiveSourceDocument['transport'];
      enabled: boolean;
    }>,
  ): Promise<LiveSourceDocument> {
    const current = await this.sources.get(sourceId);
    if (!current) throw new LiveApiError('LIVE_SOURCE_NOT_FOUND');

    if (
      patch.connection_ref !== undefined &&
      !isValidConnectionRefName(patch.connection_ref)
    ) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: 'connection_ref name is invalid',
      });
    }

    if (patch.transport !== undefined) {
      const allowedTransports = transportsForProtocol(current.source.protocol);
      if (!allowedTransports.includes(patch.transport)) {
        throw new LiveApiError('LIVE_INVALID_REQUEST', {
          message: `Protocol ${current.source.protocol} requires transport in [${allowedTransports.join(', ')}]`,
        });
      }
      if (
        (current.source.protocol === 'rtsp' ||
          current.source.protocol === 'whip') &&
        patch.transport !== 'tcp'
      ) {
        throw new LiveApiError('LIVE_INVALID_REQUEST', {
          message: `${current.source.protocol} requires transport tcp`,
        });
      }
    }

    const connectionChanged =
      (patch.connection_ref !== undefined &&
        patch.connection_ref !== current.source.connection_ref) ||
      (patch.transport !== undefined &&
        patch.transport !== current.source.transport);

    const apiPatch: Parameters<LiveSourceRepository['updateApiFields']>[1] = {
      ...patch,
    };
    const updated = await this.sources.updateApiFields(sourceId, apiPatch);

    if (connectionChanged) {
      return (
        await this.sources.updateWorkerFields(sourceId, {
          validation_state: 'pending_validation',
          endpoint_redacted: undefined,
          endpoint_fingerprint: undefined,
          allowed_host: undefined,
          allowed_port: undefined,
          validation_error: null,
        })
      ).source;
    }
    return updated.source;
  }

  async createSession(input: CreateSessionInput): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> {
    await this.assertWorkerFresh();

    const key = input.idempotency_key?.trim();
    if (!key || key.length > 128) {
      throw new LiveApiError('LIVE_INVALID_REQUEST', {
        message: 'idempotency_key is required and must be <= 128 chars',
      });
    }

    const source = await this.sources.get(input.source_id);
    if (!source) throw new LiveApiError('LIVE_SOURCE_NOT_FOUND');
    if (!source.source.enabled) throw new LiveApiError('LIVE_SOURCE_DISABLED');
    if (source.source.validation_state === 'pending_validation') {
      throw new LiveApiError('LIVE_SOURCE_PENDING_VALIDATION');
    }
    if (source.source.validation_state === 'invalid') {
      throw new LiveApiError('LIVE_SOURCE_INVALID');
    }
    if (source.source.validation_state !== 'ready') {
      throw new LiveApiError('LIVE_SOURCE_PENDING_VALIDATION');
    }
    if (
      !source.source.endpoint_fingerprint ||
      !source.source.allowed_host ||
      source.source.allowed_port == null
    ) {
      throw new LiveApiError('LIVE_SOURCE_PENDING_VALIDATION');
    }

    const liveCfg = this.cfg;
    const fragment_ms =
      input.window?.fragment_ms ?? liveCfg.LIVE_FRAGMENT_MS;
    const window_ms = input.window?.window_ms ?? liveCfg.LIVE_WINDOW_MS;
    const overlap_ms = input.window?.overlap_ms ?? liveCfg.LIVE_OVERLAP_MS;
    validateWindowDurations({ fragment_ms, window_ms, overlap_ms });

    const sessionId = deriveSessionId(input.source_id, key);

    if (source.source.active_session_id && source.source.active_session_id !== sessionId) {
      const active = await this.sessions.get(source.source.active_session_id);
      if (active && sessionIsNonterminal(active.source)) {
        if (input.force_new) {
          await this.sessions.updateDesiredState(active.id, {
            desired_state: 'stopped',
          });
          throw new LiveApiError('LIVE_SESSION_REPLACEMENT_PENDING');
        }
        throw new LiveApiError('LIVE_SESSION_CONFLICT');
      }
      // Terminal leftover claim — clear then continue
      await this.sources.clearActiveSessionClaim(
        input.source_id,
        source.source.active_session_id,
      );
    }

    const claim = await this.sources.claimActiveSession(
      input.source_id,
      sessionId,
    );
    if (claim.status === 'conflict') {
      if (input.force_new) {
        await this.sessions.updateDesiredState(claim.activeSessionId, {
          desired_state: 'stopped',
        });
        throw new LiveApiError('LIVE_SESSION_REPLACEMENT_PENDING');
      }
      throw new LiveApiError('LIVE_SESSION_CONFLICT');
    }
    if (claim.status === 'not_found') throw new LiveApiError('LIVE_SOURCE_NOT_FOUND');
    if (claim.status === 'not_ready') {
      throw new LiveApiError('LIVE_SOURCE_PENDING_VALIDATION');
    }

    const existing = await this.sessions.get(sessionId);
    if (existing) {
      if (
        existing.source.source_id !== input.source_id ||
        existing.source.idempotency_key !== key
      ) {
        // H4 residual: we may have just claimed this session id — clear before conflict.
        await this.sources.clearActiveSessionClaim(input.source_id, sessionId);
        throw new LiveApiError('LIVE_SESSION_CONFLICT');
      }
      // Same idempotency key must not resurrect a stopped/failed session as if active.
      if (
        existing.source.desired_state === 'stopped' ||
        isTerminalObservedState(existing.source.observed_state)
      ) {
        // H4 residual: claim-then-conflict must not leave a stuck active_session_id.
        await this.sources.clearActiveSessionClaim(input.source_id, sessionId);
        throw new LiveApiError('LIVE_SESSION_CONFLICT');
      }
      return {
        status: 202,
        body: publicSessionCreateResponse(existing.source),
      };
    }

    const appCfg = getConfig();
    const now = new Date().toISOString();
    const snapshot: LiveSourceSnapshot = {
      source_revision: source.source.source_revision,
      protocol: source.source.protocol,
      transport: source.source.transport,
      connection_ref: source.source.connection_ref,
      endpoint_fingerprint: source.source.endpoint_fingerprint,
      allowed_host: source.source.allowed_host,
      allowed_port: source.source.allowed_port,
    };
    const variant_id = deriveLiveVariantId({
      windowMs: window_ms,
      overlapMs: overlap_ms,
      fragmentMs: fragment_ms,
      liveCfg,
    });

    const doc: LiveSessionDocument = {
      session_id: sessionId,
      source_id: input.source_id,
      idempotency_key: key,
      desired_state: 'running',
      observed_state: 'created',
      reserved_revision: 0,
      published_revision: 0,
      stream_epoch: 1,
      last_sequence_no_in_current_epoch: 0,
      health: {
        queue_depth: 0,
        queue_high_water: 0,
        indexing_batches_in_flight: 0,
        spool_bytes: 0,
        reconnect_count: 0,
        windows_searchable: 0,
        windows_failed: 0,
        windows_dropped: 0,
      },
      timestamps: {
        created_at: now,
        command_requested_at: now,
        updated_at: now,
      },
      source_snapshot: snapshot,
      variant_id,
      retention: { mode: 'until_explicit_delete' },
      window: { fragment_ms, window_ms, overlap_ms },
      embedding: {
        provider: appCfg.EMBED_PROVIDER,
        model: appCfg.EMBED_MODEL,
        task: appCfg.EMBED_TASK_PASSAGE,
        dims: appCfg.EMBED_DIMS,
        normalized_by: normalizedByForProvider(appCfg.EMBED_PROVIDER),
      },
    };

    const created = await this.sessions.create(doc);
    return {
      status: 202,
      body: publicSessionCreateResponse(created.session.source),
    };
  }

  async startSession(sessionId: string): Promise<LiveSessionDocument> {
    await this.assertWorkerFresh();
    const current = await this.sessions.get(sessionId);
    if (!current) throw new LiveApiError('LIVE_SESSION_NOT_FOUND');
    const s = current.source;
    if (s.desired_state !== 'running') {
      throw new LiveApiError('LIVE_SESSION_CONFLICT');
    }
    if (
      s.observed_state === 'stopping' ||
      isTerminalObservedState(s.observed_state)
    ) {
      throw new LiveApiError('LIVE_SESSION_CONFLICT');
    }
    // Idempotent while created/connecting/live/degraded
    return s;
  }

  async stopSession(
    sessionId: string,
    drainTimeoutMs?: number,
  ): Promise<LiveSessionDocument> {
    const current = await this.sessions.get(sessionId);
    if (!current) throw new LiveApiError('LIVE_SESSION_NOT_FOUND');
    if (drainTimeoutMs !== undefined) {
      if (
        !Number.isInteger(drainTimeoutMs) ||
        drainTimeoutMs <= 0 ||
        drainTimeoutMs > this.cfg.LIVE_STOP_DRAIN_TIMEOUT_MS
      ) {
        throw new LiveApiError('LIVE_INVALID_REQUEST', {
          message: 'drain_timeout_ms must be <= LIVE_STOP_DRAIN_TIMEOUT_MS',
        });
      }
    }
    if (current.source.desired_state === 'stopped') {
      if (isTerminalObservedState(current.source.observed_state)) {
        await this.sources.clearActiveSessionClaim(
          current.source.source_id,
          sessionId,
        );
      }
      return current.source;
    }
    const updated = await this.sessions.updateDesiredState(sessionId, {
      desired_state: 'stopped',
    });
    // If already terminal (or no worker will drain), CAS-clear the source claim now.
    // Otherwise the worker clears on terminal transition after stop drain.
    if (isTerminalObservedState(updated.source.observed_state)) {
      await this.sources.clearActiveSessionClaim(
        updated.source.source_id,
        sessionId,
      );
    }
    return updated.source;
  }

  /**
   * Delete a source control document. Refuses while an active non-terminal
   * session still holds the claim — stop the session first. Does not cascade
   * age-delete of indexed windows (use ops age-delete separately).
   */
  async deleteSource(sourceId: string): Promise<{ deleted: true; source_id: string }> {
    const current = await this.sources.get(sourceId);
    if (!current) throw new LiveApiError('LIVE_SOURCE_NOT_FOUND');

    const activeId = current.source.active_session_id;
    if (activeId) {
      const active = await this.sessions.get(activeId);
      if (active && sessionIsNonterminal(active.source)) {
        throw new LiveApiError('LIVE_SESSION_CONFLICT', {
          message:
            'Stop the active session before deleting this source',
          details: { active_session_id: activeId },
        });
      }
      // Stale claim (missing or terminal session): clear then delete.
      await this.sources.clearActiveSessionClaim(sourceId, activeId);
    }

    const ok = await this.sources.delete(sourceId);
    if (!ok) throw new LiveApiError('LIVE_SOURCE_NOT_FOUND');
    return { deleted: true, source_id: sourceId };
  }
}
