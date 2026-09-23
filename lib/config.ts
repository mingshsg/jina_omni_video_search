import { z } from 'zod';
import path from 'node:path';

const optionalPositiveInt = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === '') return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a positive integer',
      });
      return z.NEVER;
    }
    return n;
  });

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

const positiveFloat = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `must be a positive number (default ${fallback})`,
        });
        return z.NEVER;
      }
      return n;
    });

const nonEmptyRequired = z
  .string({ required_error: 'is required' })
  .min(1, 'is required');

/**
 * Optional path that must be absolute or relative without `..` traversal
 * after resolution. Empty / unset → undefined ("not configured").
 */
const optionalCleanPath = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === '') return undefined;
    const trimmed = v.trim();
    const resolved = path.resolve(trimmed);
    const relative = path.relative(process.cwd(), resolved);
    if (relative.startsWith('..') && !path.isAbsolute(trimmed)) {
      // relative path that escapes cwd — still allow absolute paths outside cwd
    }
    if (trimmed.includes('\0')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not contain null bytes',
      });
      return z.NEVER;
    }
    // Reject obvious relative traversal tokens in the raw value
    const parts = trimmed.split(/[/\\]/);
    if (parts.includes('..')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must not contain ".." path segments',
      });
      return z.NEVER;
    }
    return resolved;
  });

const envSchema = z
  .object({
    ELASTICSEARCH_URL: nonEmptyRequired,
    ELASTICSEARCH_API_KEY: nonEmptyRequired,
    ES_INDEX_ASSETS: z.string().optional().default('video-assets'),
    ES_INDEX_CHUNKS: z.string().optional().default('video-chunks'),

    EMBED_PROVIDER: z.enum(['eis', 'jina', 'local']).optional().default('eis'),
    EMBED_INFERENCE_ID: z.string().optional().default(''),
    EMBED_MODEL: z
      .string()
      .optional()
      .default('jina-embeddings-v5-omni-small'),
    EMBED_TASK_PASSAGE: z.string().optional().default('retrieval.passage'),
    EMBED_TASK_QUERY: z.string().optional().default('retrieval.query'),
    EMBED_DIMS: positiveInt(1024),

    EIS_MAX_BINARY_BYTES: optionalPositiveInt,
    JINA_MAX_BINARY_BYTES: optionalPositiveInt,
    LOCAL_MAX_BINARY_BYTES: optionalPositiveInt,
    EMBED_BUDGET_BYTE_LAYER: z
      .enum(['decoded_media', 'base64_string', 'json_request'])
      .optional()
      .default('decoded_media'),

    EMBED_VIDEO_FRAMES: positiveInt(32),
    EMBED_MAX_LONG_EDGE: positiveInt(1280),
    EMBED_CONCURRENCY: positiveInt(3),

    JINA_API_KEY: z.string().optional().default(''),
    LOCAL_EMBED_URL: z.string().optional().default(''),

    CHUNK_PRESET: z
      .enum(['standard', '60s', '30s', '20s', 'fine', '2s'])
      .optional()
      .default('2s'),
    CHUNK_WINDOW_MS: positiveInt(2000),
    CHUNK_OVERLAP_MS: positiveInt(1000),
    CHUNK_MIN_MS: positiveInt(1000),

    SEARCH_RANK_WINDOW_SIZE: positiveInt(50),
    SEARCH_RANK_CONSTANT: positiveInt(60),
    SEARCH_WEIGHT_VIDEO: positiveFloat(1.0),
    SEARCH_WEIGHT_AUDIO: positiveFloat(1.0),

    /** Phase 3.5: asset description embedding channel (default off). */
    ASSET_SEMANTIC_ENABLED: z
      .enum(['true', 'false', '1', '0', ''])
      .optional()
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    /**
     * Phase 3.5/3.6 query parser. `dictionary` is always safe (no LLM).
     * `none` disables parsing even when the client sends parse_query=true.
     */
    QUERY_PARSER_PROVIDER: z
      .enum(['none', 'dictionary', 'eis'])
      .optional()
      .default('dictionary'),
    QUERY_PARSER_INFERENCE_ID: z.string().optional().default(''),
    /** Hard deadline for EIS completion; Serverless default is 120s — always set. */
    QUERY_PARSER_TIMEOUT_MS: positiveInt(800),
    QUERY_PARSER_MAX_TOKENS: positiveInt(256),
    QUERY_PARSER_FACET_MODE: z.enum(['boost', 'filter']).optional().default('boost'),
    QUERY_PARSER_CACHE_TTL_MS: positiveInt(300_000),
    QUERY_PARSER_CACHE_MAX: positiveInt(128),
    /** Separate from EMBED_CONCURRENCY — interactive parse must not queue behind ingest. */
    QUERY_PARSER_CONCURRENCY: positiveInt(2),

    /**
     * Edit-time Suggest enrichment (plan/04).
     * Product path: `agent_builder` — web Suggest → Kibana converse → Jina MCP tools.
     * `jina` is optional direct REST (dev only). Library default is `none`;
     * the demo opts into `agent_builder` explicitly in `.env`.
     */
    SUGGEST_WEB_PROVIDER: z
      .enum(['none', 'jina', 'agent_builder'])
      .optional()
      .default('none'),
    SUGGEST_WEB_TIMEOUT_MS: positiveInt(60_000),
    SUGGEST_WEB_MAX_READS: positiveInt(2),
    /** Kibana base URL (optional on Elastic Cloud; derived from ES `.es.` → `.kb.`). */
    KIBANA_URL: z.string().optional().default(''),
    /** Optional; falls back to ELASTICSEARCH_API_KEY. */
    KIBANA_API_KEY: z.string().optional().default(''),
    /** Agent with jina.search_web + jina.read_url (see scripts/ensure-suggest-agent.ts). */
    SUGGEST_AGENT_ID: z
      .string()
      .optional()
      .default('video_metadata_research'),
    /**
     * Kibana GenAI / inference connector id passed to Agent Builder `converse`
     * as `connector_id`. Default is EIS Gemini 3.5 Flash Lite (same catalogue
     * model as QUERY_PARSER). Empty falls back to the Kibana project default
     * (often Claude Sonnet 5).
     */
    SUGGEST_AGENT_CONNECTOR_ID: z
      .string()
      .optional()
      .default('.google-gemini-3.5-flash-lite-chat_completion'),

    MEDIA_ROOT: z.string().optional().default('./data'),
    LOCAL_IMPORT_ROOT: optionalCleanPath,
    MAX_SOURCE_BYTES: positiveInt(2147483648),
    PLAYBACK_MAX_HEIGHT: positiveInt(720),

    DEFAULT_LOCALE: z.enum(['zh', 'en']).optional().default('en'),
    SCHEMA_VERSION: z.string().optional().default('1'),
  })
  .superRefine((data, ctx) => {
    if (data.EMBED_PROVIDER === 'jina' && !data.JINA_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JINA_API_KEY'],
        message: 'is required when EMBED_PROVIDER=jina',
      });
    }
    if (data.EMBED_PROVIDER === 'local' && !data.LOCAL_EMBED_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOCAL_EMBED_URL'],
        message: 'is required when EMBED_PROVIDER=local',
      });
    }
    if (data.EMBED_PROVIDER === 'eis' && !data.EMBED_INFERENCE_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMBED_INFERENCE_ID'],
        message: 'is required when EMBED_PROVIDER=eis (discover or create first)',
      });
    }
    if (
      data.QUERY_PARSER_PROVIDER === 'eis' &&
      !data.QUERY_PARSER_INFERENCE_ID.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['QUERY_PARSER_INFERENCE_ID'],
        message: 'is required when QUERY_PARSER_PROVIDER=eis',
      });
    }
    if (data.SUGGEST_WEB_PROVIDER === 'jina' && !data.JINA_API_KEY.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JINA_API_KEY'],
        message: 'is required when SUGGEST_WEB_PROVIDER=jina',
      });
    }
    if (data.SUGGEST_WEB_PROVIDER === 'agent_builder') {
      if (!data.SUGGEST_AGENT_ID.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUGGEST_AGENT_ID'],
          message: 'is required when SUGGEST_WEB_PROVIDER=agent_builder',
        });
      }
      const hasKibana =
        data.KIBANA_URL.trim().length > 0 ||
        data.ELASTICSEARCH_URL.includes('.es.');
      if (!hasKibana) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['KIBANA_URL'],
          message:
            'set KIBANA_URL (or use an Elastic Cloud ES URL with .es. for .kb. derivation)',
        });
      }
    }
  });

export type AppConfig = z.output<typeof envSchema>;

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((issue) => {
      const key = issue.path.length ? issue.path.join('.') : '(root)';
      return `  ${key}: ${issue.message}`;
    })
    .join('\n');
}

/**
 * Load and validate environment. Fail fast with the offending variable name.
 * Do not import this module from client components.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid configuration (.env). Fix the following variables:\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

/** Lazy singleton — only validates on first server-side access. */
let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

/** Reset singleton — for scripts/tests only. */
export function resetConfig(): void {
  cached = null;
}
