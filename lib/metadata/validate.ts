import { z } from 'zod';
import {
  COUNTRY_CODE_SET,
  META_BOUNDS,
  VIDEO_TYPE_SET,
  canonicalizePrimaryLanguage,
} from './catalogs';
import { expandActorIds, getPerson } from './people';

export type MetaFieldSource = 'manual' | 'suggestion';
export type MetaProvenanceProvider =
  | 'local_title'
  | 'media_tag'
  | 'caller_hint'
  | 'external_web';

export interface MetaFieldReview {
  source: MetaFieldSource;
  confirmed: boolean;
  confidence?: number;
  /** Bounded free-text evidence (suggestion rationale / caveat). */
  evidence?: string;
  provider?: MetaProvenanceProvider;
  source_url?: string;
  retrieved_at?: string;
  request_id?: string;
}

export type MetaReviewMap = {
  description?: MetaFieldReview;
  abstract?: MetaFieldReview;
  year?: MetaFieldReview;
  actors?: MetaFieldReview;
  video_type?: MetaFieldReview;
  primary_language?: MetaFieldReview;
  country?: MetaFieldReview;
  tags?: MetaFieldReview;
};

/** Stored / returned editorial metadata (wire + index shape). */
export interface AssetMeta {
  description?: string;
  abstract?: string;
  year?: number;
  /** Display names — server-derived; never accepted from client on write. */
  actors?: string[];
  actor_ids?: string[];
  /** Index-only denorm — never on wire from client. */
  actor_aliases?: string[];
  actor_keys?: string[];
  video_type?: string;
  primary_language?: string;
  country?: string;
  tags?: string[];
  tags_key?: string[];
  review?: MetaReviewMap;
  revision: number;
  updated_at: string;
  /** Index-only BM25 bag — never accepted from client. */
  search_text?: string;
}

export interface AssetMetaEditorDto {
  video_id: string;
  title: string;
  meta: {
    description?: string;
    abstract?: string;
    year?: number;
    actors?: string[];
    actor_ids?: string[];
    video_type?: string;
    primary_language?: string;
    country?: string;
    tags?: string[];
    review?: MetaReviewMap;
  };
  meta_revision: number;
}

export class MetaValidationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = 'MetaValidationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Tag / filter key: NFKC + lowercase + trim/collapse spaces. */
export function normalizeTagKey(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function optionalTrimmedString(max: number) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const t = v.trim();
      if (!t) return null;
      if (t.length > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `exceeds ${max} characters`,
        });
        return z.NEVER;
      }
      return t;
    });
}

const reviewSchema = z
  .object({
    source: z.enum(['manual', 'suggestion']),
    confirmed: z.boolean(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.string().max(500).optional(),
    provider: z
      .enum(['local_title', 'media_tag', 'caller_hint', 'external_web'])
      .optional(),
    source_url: z.string().url().startsWith('https://').max(2048).optional(),
    retrieved_at: z.string().datetime().optional(),
    request_id: z.string().uuid().optional(),
  })
  .strict();

const EVIDENCE_MAX = 500;

/**
 * PATCH body schema. Omitted = leave unchanged; null / empty = clear.
 * Client may send actor_ids only (not actors / aliases / keys / search_text).
 */
const fieldSourceSchema = z.enum(['manual', 'suggestion']);

const fieldProvenanceSchema = z
  .object({
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.string().max(EVIDENCE_MAX).optional(),
    provider: z
      .enum(['local_title', 'media_tag', 'caller_hint', 'external_web'])
      .optional(),
    source_url: z.string().url().startsWith('https://').max(2048).optional(),
    retrieved_at: z.string().datetime().optional(),
    request_id: z.string().uuid().optional(),
  })
  .strict();

export const metaPatchBodySchema = z
  .object({
    expected_revision: z.number().int().min(0),
    description: optionalTrimmedString(META_BOUNDS.descriptionMax),
    abstract: optionalTrimmedString(META_BOUNDS.abstractMax),
    year: z
      .union([
        z
          .number()
          .int()
          .min(META_BOUNDS.yearMin)
          .max(META_BOUNDS.yearMax),
        z.null(),
      ])
      .optional(),
    actor_ids: z
      .union([
        z
          .array(z.string().min(1).max(META_BOUNDS.actorIdMaxLen))
          .max(META_BOUNDS.actorsMax),
        z.null(),
      ])
      .optional(),
    video_type: z.union([z.string(), z.null()]).optional(),
    primary_language: z.union([z.string(), z.null()]).optional(),
    country: z.union([z.string(), z.null()]).optional(),
    tags: z
      .union([
        z
          .array(z.string().min(1).max(META_BOUNDS.tagMaxLen))
          .max(META_BOUNDS.tagsMax),
        z.null(),
      ])
      .optional(),
    /** Optional per-field provenance when saving accepted suggestions. */
    field_sources: z
      .object({
        description: fieldSourceSchema.optional(),
        abstract: fieldSourceSchema.optional(),
        year: fieldSourceSchema.optional(),
        actors: fieldSourceSchema.optional(),
        video_type: fieldSourceSchema.optional(),
        primary_language: fieldSourceSchema.optional(),
        country: fieldSourceSchema.optional(),
        tags: fieldSourceSchema.optional(),
      })
      .strict()
      .optional(),
    /** Optional confidence/evidence for fields marked as suggestions. */
    field_provenance: z
      .object({
        description: fieldProvenanceSchema.optional(),
        abstract: fieldProvenanceSchema.optional(),
        year: fieldProvenanceSchema.optional(),
        actors: fieldProvenanceSchema.optional(),
        video_type: fieldProvenanceSchema.optional(),
        primary_language: fieldProvenanceSchema.optional(),
        country: fieldProvenanceSchema.optional(),
        tags: fieldProvenanceSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type MetaPatchBody = z.infer<typeof metaPatchBodySchema>;

/** Fields the script will apply after server-side derivation. */
export interface MetaPatchApply {
  expected_revision: number;
  /** Present keys are set; value `null` clears. */
  fields: Record<string, unknown>;
  review?: MetaReviewMap;
}

const EDITABLE_KEYS = [
  'description',
  'abstract',
  'year',
  'actor_ids',
  'video_type',
  'primary_language',
  'country',
  'tags',
] as const;

export function parseMetaPatchBody(
  raw: unknown,
  locale = 'en',
): MetaPatchApply {
  const parsed = metaPatchBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new MetaValidationError(
      'META_INVALID',
      parsed.error.issues[0]?.message ?? 'Invalid metadata patch',
      400,
      parsed.error.flatten(),
    );
  }
  const body = parsed.data;
  const touched = EDITABLE_KEYS.some((k) => body[k] !== undefined);
  if (!touched) {
    throw new MetaValidationError(
      'META_INVALID',
      'At least one editable field is required',
    );
  }

  const fields: Record<string, unknown> = {};
  const review: MetaReviewMap = {};
  const sources = body.field_sources ?? {};
  const provenance = body.field_provenance ?? {};

  const reviewEntry = (
    field: keyof NonNullable<MetaPatchBody['field_sources']>,
  ): MetaFieldReview => {
    const prov = provenance[field];
    const evidence =
      typeof prov?.evidence === 'string'
        ? prov.evidence.trim().slice(0, EVIDENCE_MAX)
        : undefined;
    return {
      source: sources[field] === 'suggestion' ? 'suggestion' : 'manual',
      confirmed: true,
      ...(prov?.confidence != null ? { confidence: prov.confidence } : {}),
      ...(evidence ? { evidence } : {}),
      ...(prov?.provider ? { provider: prov.provider } : {}),
      ...(prov?.source_url ? { source_url: prov.source_url } : {}),
      ...(prov?.retrieved_at ? { retrieved_at: prov.retrieved_at } : {}),
      ...(prov?.request_id ? { request_id: prov.request_id } : {}),
    };
  };

  if (body.description !== undefined) {
    fields.description = body.description;
    if (body.description !== null) {
      review.description = reviewEntry('description');
    }
  }
  if (body.abstract !== undefined) {
    fields.abstract = body.abstract;
    if (body.abstract !== null) {
      review.abstract = reviewEntry('abstract');
    }
  }
  if (body.year !== undefined) {
    fields.year = body.year;
    if (body.year !== null) {
      review.year = reviewEntry('year');
    }
  }

  if (body.actor_ids !== undefined) {
    if (body.actor_ids === null || body.actor_ids.length === 0) {
      fields.actor_ids = null;
      fields.actors = null;
      fields.actor_aliases = null;
      fields.actor_keys = null;
    } else {
      const unique = [...new Set(body.actor_ids.map((id) => id.trim()))];
      for (const id of unique) {
        if (!getPerson(id)) {
          throw new MetaValidationError(
            'META_UNKNOWN_ACTOR_ID',
            `Unknown actor id: ${id}`,
            400,
            { actor_id: id },
          );
        }
      }
      const expanded = expandActorIds(unique, locale);
      fields.actor_ids = unique;
      fields.actors = expanded.actors;
      fields.actor_aliases = expanded.actor_aliases;
      fields.actor_keys = expanded.actor_keys;
      review.actors = reviewEntry('actors');
    }
  }

  if (body.video_type !== undefined) {
    if (body.video_type === null || !body.video_type.trim()) {
      fields.video_type = null;
    } else {
      const v = body.video_type.trim();
      if (!VIDEO_TYPE_SET.has(v)) {
        throw new MetaValidationError(
          'META_INVALID_VIDEO_TYPE',
          `Unknown video_type: ${v}`,
        );
      }
      fields.video_type = v;
      review.video_type = reviewEntry('video_type');
    }
  }

  if (body.primary_language !== undefined) {
    if (body.primary_language === null || !body.primary_language.trim()) {
      fields.primary_language = null;
    } else {
      const canonical = canonicalizePrimaryLanguage(body.primary_language);
      if (!canonical) {
        throw new MetaValidationError(
          'META_INVALID_LANGUAGE',
          `Unsupported language: ${body.primary_language.trim()}`,
        );
      }
      fields.primary_language = canonical;
      review.primary_language = reviewEntry('primary_language');
    }
  }

  if (body.country !== undefined) {
    if (body.country === null || !body.country.trim()) {
      fields.country = null;
    } else {
      const v = body.country.trim().toUpperCase();
      if (!COUNTRY_CODE_SET.has(v)) {
        throw new MetaValidationError(
          'META_INVALID_COUNTRY',
          `Country/region not in catalog: ${v}`,
        );
      }
      fields.country = v;
      review.country = reviewEntry('country');
    }
  }

  if (body.tags !== undefined) {
    if (body.tags === null) {
      fields.tags = null;
      fields.tags_key = null;
    } else {
      // Normalize before emptiness check — whitespace-only tags clear, not
      // save an empty confirmed review entry (Phase 1 review P2).
      const display = body.tags
        .map((t) => t.normalize('NFKC').trim())
        .filter(Boolean);
      if (display.length === 0) {
        fields.tags = null;
        fields.tags_key = null;
      } else {
        if (display.some((t) => t.length > META_BOUNDS.tagMaxLen)) {
          throw new MetaValidationError(
            'META_INVALID',
            `Tag exceeds ${META_BOUNDS.tagMaxLen} characters`,
          );
        }
        const keys = [...new Set(display.map(normalizeTagKey))].filter(Boolean);
        fields.tags = display;
        fields.tags_key = keys;
        review.tags = reviewEntry('tags');
      }
    }
  }

  return {
    expected_revision: body.expected_revision,
    fields,
    review: Object.keys(review).length > 0 ? review : undefined,
  };
}

export function toEditorDto(
  videoId: string,
  title: string,
  meta: AssetMeta | undefined | null,
): AssetMetaEditorDto {
  const revision = meta?.revision ?? 0;
  return {
    video_id: videoId,
    title,
    meta_revision: revision,
    meta: {
      description: meta?.description,
      abstract: meta?.abstract,
      year: meta?.year,
      actors: meta?.actors,
      actor_ids: meta?.actor_ids,
      video_type: meta?.video_type,
      primary_language: meta?.primary_language,
      country: meta?.country,
      tags: meta?.tags,
      review: meta?.review,
    },
  };
}

/** Re-export review schema for suggest (Phase 4). */
export { reviewSchema };
