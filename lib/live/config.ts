import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SPOOL_MIN_FREE_BYTES } from './spool-accounting';

/**
 * Live-only configuration (Phase 1+).
 * Independent from file `AppConfig` — do not require these on file-video startup.
 *
 * Product decisions (2026-09-10):
 * - Retention: forever until explicit delete (no 7d/8d/24h auto-expiry).
 * - Spool byte caps: unset/0 = unlimited retained growth.
 * - Soft free-space floor: LIVE_SPOOL_MIN_FREE_BYTES (default 50 GiB); 0 = disabled.
 * - MVP allowlist defaults: localhost/127.0.0.1 and ports 554,8554.
 */

const FOREVER_TOKENS = new Set(['forever', 'indefinite', '0', 'none', 'unlimited']);

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((issue) => {
      const key = issue.path.length ? issue.path.join('.') : '(root)';
      return `  ${key}: ${issue.message}`;
    })
    .join('\n');
}

const positiveInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be a positive integer (default ${fallback})`,
        });
        return z.NEVER;
      }
      return n;
    });

/** Optional non-negative byte cap: unset/empty/0 → undefined (unlimited). */
const optionalUnlimitedBytes = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === '' || v.trim() === '0') {
      return undefined;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a non-negative integer, 0, or unset (unlimited)',
      });
      return z.NEVER;
    }
    if (n === 0) return undefined;
    return n;
  });

/**
 * Soft free-space floor: unset → default 50 GiB; 0 → disabled (undefined);
 * positive integer → that many bytes.
 */
const optionalMinFreeBytes = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be a non-negative integer (default ${fallback}; 0 disables)`,
        });
        return z.NEVER;
      }
      if (n === 0) return undefined;
      return n;
    });

const foreverRetention = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const raw = (v ?? 'forever').trim().toLowerCase();
    if (FOREVER_TOKENS.has(raw)) {
      return 'forever' as const;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'must be forever|indefinite|0|none|unlimited (age-based retention is disabled; product decision 2026-09-10)',
    });
    return z.NEVER;
  });

const commaList = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const raw = (v === undefined || v.trim() === '' ? fallback : v).trim();
      const parts = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must be a non-empty comma-separated list',
        });
        return z.NEVER;
      }
      return parts;
    });

const portList = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const raw = (v === undefined || v.trim() === '' ? fallback : v).trim();
      const parts = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must be a non-empty comma-separated port list',
        });
        return z.NEVER;
      }
      const ports: number[] = [];
      for (const part of parts) {
        const n = Number(part);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `invalid port "${part}" (expected 1-65535)`,
          });
          return z.NEVER;
        }
        ports.push(n);
      }
      return [...new Set(ports)];
    });

const durationRangeToken = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const raw = (v ?? '24h').trim().toLowerCase();
    const m = /^(\d+)(ms|s|m|h|d)$/.exec(raw);
    if (!m) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must look like <n>ms|s|m|h|d (e.g. 24h)',
      });
      return z.NEVER;
    }
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duration magnitude must be a positive integer',
      });
      return z.NEVER;
    }
    return raw;
  });

const cleanPath = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const trimmed = (v === undefined || v.trim() === '' ? fallback : v).trim();
      if (trimmed.includes('\0')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must not contain null bytes',
        });
        return z.NEVER;
      }
      const parts = trimmed.split(/[/\\]/);
      if (parts.includes('..')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must not contain ".." path segments',
        });
        return z.NEVER;
      }
      return path.resolve(trimmed);
    });

const indexName = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const name = (v === undefined || v.trim() === '' ? fallback : v).trim();
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'must be a lowercase Elasticsearch index/data-stream name',
        });
        return z.NEVER;
      }
      return name;
    });

const liveEnvSchema = z
  .object({
    ES_INDEX_LIVE_SOURCES: indexName('live-video-sources'),
    ES_INDEX_LIVE_SESSIONS: indexName('live-video-sessions'),
    ES_INDEX_LIVE_WORKERS: indexName('live-video-workers'),
    ES_INDEX_LIVE_PROTECT_RANGES: indexName('live-video-protect-ranges'),
    ES_DATA_STREAM_LIVE_CHUNKS: indexName('live-video-chunks'),
    ES_DATA_STREAM_LIVE_EVENTS: indexName('live-video-events'),

    LIVE_ALLOWED_PROTOCOLS: commaList('rtsp'),
    // host.docker.internal: Docker live-worker → MediaMTX published on the host.
LIVE_ALLOWED_HOSTS: commaList('localhost,127.0.0.1,host.docker.internal'),
    LIVE_ALLOWED_PORTS: portList('554,8554'),
    LIVE_RTSP_TRANSPORT: z
      .enum(['tcp', 'udp'])
      .optional()
      .default('tcp'),
    /**
     * SRT listener peer admission (IPs / CIDRs). Empty = listener mode denied
     * (fail closed). Caller mode does not require this list.
     */
    LIVE_SRT_PEER_ALLOWLIST: z
      .string()
      .optional()
      .transform((v) => {
        if (v === undefined || v.trim() === '') return [] as string[];
        return v
          .split(',')
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
      }),

    LIVE_CONNECT_TIMEOUT_MS: positiveInt(10_000),
    LIVE_READ_TIMEOUT_MS: positiveInt(15_000),
    LIVE_RECONNECT_MAX_MS: positiveInt(10_000),

    LIVE_FRAGMENT_MS: positiveInt(2_000),
    LIVE_WINDOW_MS: positiveInt(8_000),
    LIVE_OVERLAP_MS: positiveInt(2_000),

    LIVE_QUEUE_MAX_WINDOWS: positiveInt(12),
    LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS: positiveInt(12),
    LIVE_INDEX_MAX_IN_FLIGHT_BATCHES: positiveInt(2),
    LIVE_PROCESSING_CONCURRENCY: positiveInt(2),
    LIVE_WINDOW_DEADLINE_MS: positiveInt(15_000),
    LIVE_EMBED_MAX_ATTEMPTS: positiveInt(3),
    LIVE_EMBED_RETRY_MAX_MS: positiveInt(5_000),
    LIVE_INDEX_MAX_ATTEMPTS: positiveInt(3),
    LIVE_PROXY_MAX_LONG_EDGE: positiveInt(720),
    LIVE_PROXY_MAX_ATTEMPTS: positiveInt(3),

    LIVE_SPOOL_DIR: cleanPath('./data/live-spool'),
    LIVE_PENDING_SPOOL_MAX_BYTES: optionalUnlimitedBytes,
    LIVE_RETAINED_MEDIA_MAX_BYTES: optionalUnlimitedBytes,
    LIVE_SPOOL_MIN_FREE_BYTES: optionalMinFreeBytes(DEFAULT_SPOOL_MIN_FREE_BYTES),
    LIVE_MANIFEST_RESERVE_BYTES: positiveInt(1_048_576),
    LIVE_DROP_POLICY: z.enum(['oldest']).optional().default('oldest'),

    LIVE_VECTOR_RETENTION: foreverRetention,
    LIVE_EVENT_RETENTION: foreverRetention,
    LIVE_CLIP_RETENTION: foreverRetention,

    LIVE_QUERY_CACHE_TTL_MS: positiveInt(300_000),
    LIVE_EVENT_POLL_MS: positiveInt(500),
    LIVE_SEARCH_MAX_RANGE: durationRangeToken,
    LIVE_API_MAX_BODY_BYTES: positiveInt(65_536),
    LIVE_IMAGE_QUERY_MAX_BYTES: positiveInt(5_242_880),
    LIVE_MUTATION_RATE_PER_MINUTE: positiveInt(30),
    LIVE_WORKER_STALE_MS: positiveInt(15_000),
    LIVE_STOP_DRAIN_TIMEOUT_MS: positiveInt(30_000),
    LIVE_WORKER_ID: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    const storageNames = [
      data.ES_INDEX_LIVE_SOURCES,
      data.ES_INDEX_LIVE_SESSIONS,
      data.ES_INDEX_LIVE_WORKERS,
      data.ES_INDEX_LIVE_PROTECT_RANGES,
      data.ES_DATA_STREAM_LIVE_CHUNKS,
      data.ES_DATA_STREAM_LIVE_EVENTS,
    ];
    if (new Set(storageNames).size !== storageNames.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ES_INDEX_LIVE_SOURCES'],
        message: 'live index and data-stream names must be distinct',
      });
    }

    const fragment = data.LIVE_FRAGMENT_MS;
    const window = data.LIVE_WINDOW_MS;
    const overlap = data.LIVE_OVERLAP_MS;
    if (overlap >= window) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LIVE_OVERLAP_MS'],
        message: 'must be strictly less than LIVE_WINDOW_MS',
      });
    }
    if (window % fragment !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LIVE_WINDOW_MS'],
        message: 'must be divisible by LIVE_FRAGMENT_MS',
      });
    }
    const step = window - overlap;
    if (step <= 0 || step % fragment !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LIVE_OVERLAP_MS'],
        message:
          'window step (LIVE_WINDOW_MS - LIVE_OVERLAP_MS) must be positive and divisible by LIVE_FRAGMENT_MS',
      });
    }

    if (data.LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LIVE_INDEX_ACK_QUEUE_MAX_WINDOWS'],
        message: 'must be a positive integer',
      });
    }
    if (data.LIVE_QUEUE_MAX_WINDOWS < data.LIVE_PROCESSING_CONCURRENCY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LIVE_QUEUE_MAX_WINDOWS'],
        message: 'must be >= LIVE_PROCESSING_CONCURRENCY',
      });
    }

    for (const host of data.LIVE_ALLOWED_HOSTS) {
      if (host === '.' || host === '*.' || host.endsWith('..')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LIVE_ALLOWED_HOSTS'],
          message: `invalid host token "${host}"`,
        });
      }
    }

    const protocols = data.LIVE_ALLOWED_PROTOCOLS.map((p) => p.toLowerCase());
    for (const p of protocols) {
      if (!['rtsp', 'hls', 'srt', 'whip'].includes(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LIVE_ALLOWED_PROTOCOLS'],
          message: `unsupported protocol "${p}" (rtsp|hls|srt|whip)`,
        });
      }
    }
  });

export type LiveConfig = z.output<typeof liveEnvSchema> & {
  /** Derived: window step in ms (window - overlap). */
  LIVE_WINDOW_STEP_MS: number;
  /** Derived: fragments per window. */
  LIVE_FRAGMENTS_PER_WINDOW: number;
  /**
   * DSL template lifecycle: enabled without data_retention = indefinite keep.
   * Never set an age-based delete phase.
   */
  LIVE_DSL_LIFECYCLE: { enabled: true };
};

export type LiveConfigInput = NodeJS.ProcessEnv;

/**
 * Load and validate live configuration. Fail fast with the offending variable name.
 * Does not require file-video AppConfig fields.
 */
export function loadLiveConfig(env: LiveConfigInput = process.env): LiveConfig {
  const result = liveEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid live configuration (.env). Fix the following variables:\n${formatZodError(result.error)}`,
    );
  }
  const data = result.data;
  return {
    ...data,
    LIVE_ALLOWED_PROTOCOLS: data.LIVE_ALLOWED_PROTOCOLS.map((p) =>
      p.toLowerCase(),
    ),
    LIVE_WINDOW_STEP_MS: data.LIVE_WINDOW_MS - data.LIVE_OVERLAP_MS,
    LIVE_FRAGMENTS_PER_WINDOW: data.LIVE_WINDOW_MS / data.LIVE_FRAGMENT_MS,
    LIVE_DSL_LIFECYCLE: { enabled: true },
  };
}

/** Ensure spool root exists and is writable when validating for worker start. */
export function assertLiveSpoolWritable(cfg: LiveConfig): void {
  const dir = cfg.LIVE_SPOOL_DIR;
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
}

let cached: LiveConfig | null = null;

export function getLiveConfig(): LiveConfig {
  if (!cached) {
    cached = loadLiveConfig();
  }
  return cached;
}

/** Reset singleton — for scripts/tests only. */
export function resetLiveConfig(): void {
  cached = null;
}
