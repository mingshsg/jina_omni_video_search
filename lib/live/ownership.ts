import type {
  LiveSessionDocument,
  LiveSessionDesiredFields,
  LiveSessionObservedFields,
  LiveSessionHealth,
  LiveSessionTimestamps,
  LiveSourceApiFields,
  LiveSourceDocument,
  LiveSourceWorkerFields,
} from './types';

/** API-owned source keys — worker must not overwrite via API merge path. */
export const SOURCE_API_KEYS = [
  'name',
  'protocol',
  'connection_ref',
  'transport',
  'enabled',
] as const satisfies ReadonlyArray<keyof LiveSourceApiFields>;

/** Worker-owned source keys — API must not overwrite. */
export const SOURCE_WORKER_KEYS = [
  'validation_state',
  'endpoint_redacted',
  'endpoint_fingerprint',
  'allowed_host',
  'allowed_port',
  'validation_error',
] as const satisfies ReadonlyArray<keyof LiveSourceWorkerFields>;

export const SESSION_API_KEYS = [
  'desired_state',
] as const satisfies ReadonlyArray<keyof LiveSessionDesiredFields>;

export const SESSION_WORKER_KEYS = [
  'observed_state',
  'reserved_revision',
  'published_revision',
  'worker_id',
  'stream_epoch',
  'last_sequence_no_in_current_epoch',
  'health',
  'current_error',
  'timestamps',
] as const satisfies ReadonlyArray<keyof LiveSessionObservedFields>;

/** Supervisor-owned health counters (never clobber indexer searchable). */
export const SESSION_HEALTH_SUPERVISOR_KEYS = [
  'capture_lag_ms',
  'processing_lag_ms',
  'queue_depth',
  'queue_high_water',
  'indexing_batches_in_flight',
  'spool_bytes',
  'reconnect_count',
  'windows_failed',
  'windows_dropped',
] as const satisfies ReadonlyArray<keyof LiveSessionHealth>;

/** Indexer-owned health counters. */
export const SESSION_HEALTH_INDEXER_KEYS = [
  'windows_searchable',
] as const satisfies ReadonlyArray<keyof LiveSessionHealth>;

/**
 * Build a supervisor health patch that omits indexer-owned fields so ES merge
 * preserves `windows_searchable` / related indexer updates.
 */
export function supervisorHealthPatch(
  health: LiveSessionHealth,
): Partial<LiveSessionHealth> {
  const patch: Partial<LiveSessionHealth> = {};
  for (const key of SESSION_HEALTH_SUPERVISOR_KEYS) {
    const value = health[key];
    if (value !== undefined) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

export class FieldOwnershipError extends Error {
  constructor(
    public readonly owner: 'api' | 'worker',
    public readonly fields: string[],
  ) {
    super(
      `${owner} update attempted to mutate foreign fields: ${fields.join(', ')}`,
    );
    this.name = 'FieldOwnershipError';
  }
}

function pickForbidden(
  patch: Record<string, unknown>,
  forbidden: readonly string[],
): string[] {
  return forbidden.filter((k) =>
    Object.prototype.hasOwnProperty.call(patch, k),
  );
}

/** Merge API-owned source fields; rejects worker-owned keys. */
export function mergeSourceApiPatch(
  current: LiveSourceDocument,
  patch: Partial<LiveSourceApiFields> & { source_revision?: number },
  updatedAt: string,
): LiveSourceDocument {
  const forbidden = pickForbidden(
    patch as Record<string, unknown>,
    SOURCE_WORKER_KEYS,
  );
  if (forbidden.length) {
    throw new FieldOwnershipError('api', forbidden);
  }

  const connectionChanged =
    (patch.connection_ref !== undefined &&
      patch.connection_ref !== current.connection_ref) ||
    (patch.protocol !== undefined && patch.protocol !== current.protocol) ||
    (patch.transport !== undefined && patch.transport !== current.transport);

  const next: LiveSourceDocument = {
    ...current,
    ...patch,
    updated_at: updatedAt,
  };

  if (connectionChanged) {
    next.source_revision = current.source_revision + 1;
    next.validation_state = 'pending_validation';
    next.endpoint_redacted = undefined;
    next.endpoint_fingerprint = undefined;
    next.allowed_host = undefined;
    next.allowed_port = undefined;
    next.validation_error = null;
  } else if (patch.source_revision !== undefined) {
    next.source_revision = patch.source_revision;
  }

  return next;
}

/** Merge worker-owned source fields; rejects API-owned keys. */
export function mergeSourceWorkerPatch(
  current: LiveSourceDocument,
  patch: Partial<LiveSourceWorkerFields>,
  updatedAt: string,
): LiveSourceDocument {
  const forbidden = pickForbidden(
    patch as Record<string, unknown>,
    SOURCE_API_KEYS,
  );
  if (forbidden.length) {
    throw new FieldOwnershipError('worker', forbidden);
  }
  return {
    ...current,
    ...patch,
    updated_at: updatedAt,
  };
}

/** Merge API desired_state only. */
export function mergeSessionApiPatch(
  current: LiveSessionDocument,
  patch: Partial<LiveSessionDesiredFields>,
  updatedAt: string,
): LiveSessionDocument {
  const forbidden = pickForbidden(
    patch as Record<string, unknown>,
    SESSION_WORKER_KEYS,
  );
  if (forbidden.length) {
    throw new FieldOwnershipError('api', forbidden);
  }
  return {
    ...current,
    ...patch,
    timestamps: {
      ...current.timestamps,
      updated_at: updatedAt,
      command_requested_at: updatedAt,
    },
  };
}

/** Merge worker observed fields; rejects desired_state. */
export function mergeSessionWorkerPatch(
  current: LiveSessionDocument,
  patch: Omit<Partial<LiveSessionObservedFields>, 'health' | 'timestamps'> & {
    health?: Partial<LiveSessionHealth>;
    timestamps?: Partial<LiveSessionTimestamps>;
  },
): LiveSessionDocument {
  const forbidden = pickForbidden(
    patch as Record<string, unknown>,
    SESSION_API_KEYS,
  );
  if (forbidden.length) {
    throw new FieldOwnershipError('worker', forbidden);
  }
  const health = patch.health
    ? {
        ...current.health,
        ...patch.health,
      }
    : current.health;
  return {
    ...current,
    ...patch,
    health,
    timestamps: {
      ...current.timestamps,
      ...(patch.timestamps ?? {}),
      updated_at:
        patch.timestamps?.updated_at ?? new Date().toISOString(),
    },
  };
}
