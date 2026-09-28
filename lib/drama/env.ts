/**
 * Drama enrichment env — separate from AppConfig so pipeline.test.ts
 * hand-built literals stay untouched (AGENTS.md trap #1).
 */
import { z } from 'zod';
import path from 'node:path';

/** Default 210 minutes in milliseconds. */
export const DRAMA_MAX_DURATION_MS_DEFAULT = 210 * 60 * 1000;

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

const dramaEnvSchema = z.object({
  /** Refuse drama enrichment when probe duration exceeds this (ms). */
  DRAMA_MAX_DURATION_MS: positiveInt(DRAMA_MAX_DURATION_MS_DEFAULT),
  /**
   * Dedicated index for timed multilingual subtitle segments + embeddings.
   * Not mashed into video-assets.meta (plan/12 OQ-3).
   */
  ES_INDEX_DRAMA_SUBTITLES: z
    .string()
    .optional()
    .default('video-drama-subtitles'),
  /**
   * Path to episode_processing checkout (git submodule). Absolute or
   * relative to process.cwd().
   */
  DRAMA_EPISODE_PROCESSING_ROOT: z
    .string()
    .optional()
    .default('vendor/episode_processing'),
  /**
   * ASR when no sidecar/embedded subs:
   * `auto` = try openai if key set, else whisper_cli if bin set, else skip.
   * `openai` | `whisper_cli` | `off` force a mode.
   */
  DRAMA_ASR_PROVIDER: z
    .enum(['auto', 'openai', 'whisper_cli', 'off'])
    .optional()
    .default('auto'),
  DRAMA_ASR_API_KEY: z.string().optional().default(''),
  DRAMA_ASR_API_URL: z.string().optional().default(''),
  DRAMA_ASR_MODEL: z.string().optional().default('whisper-1'),
  DRAMA_WHISPER_BIN: z.string().optional().default(''),
  /** Max subtitle cues to embed per language (cost bound). */
  DRAMA_SUBTITLE_EMBED_MAX: positiveInt(400),
  /**
   * EIS chat_completion id for directors propose (multimodal).
   * Empty → directors_script module fails with a clear config error.
   */
  DRAMA_EIS_CHAT_INFERENCE_ID: z.string().optional().default(''),
  /**
   * Different model for lightweight groundedness audit. Must differ from
   * propose id when both are set.
   */
  DRAMA_EIS_AUDIT_INFERENCE_ID: z.string().optional().default(''),
  /** Directors window length in seconds (default 120). */
  DRAMA_DIRECTORS_WINDOW_SEC: positiveInt(120),
  /** Cap windows per asset to bound EIS cost (default 8 ≈ 16 min). */
  DRAMA_DIRECTORS_MAX_WINDOWS: positiveInt(8),
  /** Stills per window sent to the model (default 4). */
  DRAMA_DIRECTORS_FRAMES_PER_WINDOW: positiveInt(4),
  /** Per-window EIS timeout ms. */
  DRAMA_DIRECTORS_TIMEOUT_MS: positiveInt(180_000),
  /** Key scenes kept per asset. */
  DRAMA_KEY_SCENES_MAX: positiveInt(6),
  /** Verified key actor cards kept per asset (one per role). */
  DRAMA_KEY_ACTORS_MAX: positiveInt(6),
  /** Candidate stills scanned for faces. */
  DRAMA_KEY_ACTORS_STILLS: positiveInt(8),
  /** Minimum model-reported frontal score for a face candidate (0–1). */
  DRAMA_KEY_ACTORS_MIN_FRONTAL: z
    .string()
    .optional()
    .transform((v) => {
      const n = v === undefined || v.trim() === '' ? 0.7 : Number(v);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.7;
    }),
  /** Sweep only leaves disposable dirs older than this (ms). */
  DRAMA_GC_MIN_AGE_MS: positiveInt(60 * 60 * 1000),
});

export type DramaEnv = z.output<typeof dramaEnvSchema>;

let cached: DramaEnv | null = null;

export function loadDramaEnv(
  env: NodeJS.ProcessEnv = process.env,
): DramaEnv {
  const result = dramaEnvSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid drama configuration (.env). Fix:\n${detail}`,
    );
  }
  return result.data;
}

export function getDramaEnv(): DramaEnv {
  if (!cached) cached = loadDramaEnv();
  return cached;
}

/** Tests / scripts only. */
export function resetDramaEnv(): void {
  cached = null;
}

/** Resolved absolute path to the episode_processing tree. */
export function resolveEpisodeProcessingRoot(
  env: DramaEnv = getDramaEnv(),
): string {
  return path.resolve(env.DRAMA_EPISODE_PROCESSING_ROOT);
}
