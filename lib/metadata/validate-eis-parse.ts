/**
 * Validate and normalize LLM parse JSON against pinned catalogs (Rule 2).
 */
import {
  COUNTRY_CODE_SET,
  META_BOUNDS,
  VIDEO_TYPE_SET,
  type CountryCode,
  type VideoType,
} from './catalogs';
import { getPerson } from './people';
import type {
  ParseRejection,
  ParsedQueryExtraction,
} from './query-parse';

export interface EisParsePayload {
  vector_query?: string | null;
  free_text?: string | null;
  actor_ids?: Array<string | null> | null;
  year_from?: number | null;
  year_to?: number | null;
  country?: Array<string | null> | null;
  video_type?: Array<string | null> | null;
}

export type EisClearableField =
  | keyof ParsedQueryExtraction
  | 'vector_query'
  | 'free_text';

export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  // Strip common markdown fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('no_json_object');
  }
  return JSON.parse(body.slice(start, end + 1));
}

export function validateEisParsePayload(
  raw: unknown,
  opts?: { allowedActorIds?: ReadonlySet<string> },
): {
  extracted: ParsedQueryExtraction;
  /** Fields EIS explicitly set to null/empty — must clear dictionary guesses. */
  cleared: Set<EisClearableField>;
  vector_query: string | null;
  free_text: string | null;
  rejected: ParseRejection[];
  confidence: Record<string, number>;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('payload_not_object');
  }
  const obj = raw as EisParsePayload;
  const rejected: ParseRejection[] = [];
  const extracted: ParsedQueryExtraction = {};
  const cleared = new Set<EisClearableField>();
  const confidence: Record<string, number> = {};
  const allowedActors = opts?.allowedActorIds;

  if ('actor_ids' in obj) {
    if (obj.actor_ids == null) {
      cleared.add('actor_ids');
    } else if (Array.isArray(obj.actor_ids)) {
      const ids: string[] = [];
      for (const id of obj.actor_ids) {
        if (id == null || id === '') continue;
        const s = String(id).trim();
        if (!getPerson(s)) {
          rejected.push({
            field: 'actor_ids',
            value: s,
            reason: 'not in catalog',
          });
          continue;
        }
        if (allowedActors && !allowedActors.has(s)) {
          rejected.push({
            field: 'actor_ids',
            value: s,
            reason: 'not in candidate set',
          });
          continue;
        }
        ids.push(s);
      }
      if (ids.length > 0) {
        extracted.actor_ids = [...new Set(ids)];
        confidence.actor_ids = 0.7;
      } else {
        // Explicit empty array (or all rejected) → clear dictionary actors.
        cleared.add('actor_ids');
      }
    }
  }

  if ('country' in obj) {
    if (obj.country == null) {
      cleared.add('country');
    } else if (Array.isArray(obj.country)) {
      const codes: CountryCode[] = [];
      for (const c of obj.country) {
        if (c == null || c === '') continue;
        const code = String(c).trim().toUpperCase();
        if (!COUNTRY_CODE_SET.has(code)) {
          rejected.push({
            field: 'country',
            value: String(c),
            reason: 'not in catalog',
          });
          continue;
        }
        codes.push(code as CountryCode);
      }
      if (codes.length > 0) {
        extracted.country = [...new Set(codes)];
        confidence.country = 0.65;
      } else {
        cleared.add('country');
      }
    }
  }

  if ('video_type' in obj) {
    if (obj.video_type == null) {
      cleared.add('video_type');
    } else if (Array.isArray(obj.video_type)) {
      const types: VideoType[] = [];
      for (const t of obj.video_type) {
        if (t == null || t === '') continue;
        const v = String(t).trim().toLowerCase();
        if (!VIDEO_TYPE_SET.has(v)) {
          rejected.push({
            field: 'video_type',
            value: String(t),
            reason: 'not in catalog',
          });
          continue;
        }
        types.push(v as VideoType);
      }
      if (types.length > 0) {
        extracted.video_type = [...new Set(types)];
        confidence.video_type = 0.65;
      } else {
        cleared.add('video_type');
      }
    }
  }

  if ('year_from' in obj) {
    if (obj.year_from == null) {
      cleared.add('year_from');
    } else if (
      typeof obj.year_from === 'number' &&
      Number.isFinite(obj.year_from)
    ) {
      const yearFrom = Math.trunc(obj.year_from);
      if (yearFrom < META_BOUNDS.yearMin || yearFrom > META_BOUNDS.yearMax) {
        rejected.push({
          field: 'year_from',
          value: String(yearFrom),
          reason: 'out of range',
        });
      } else {
        extracted.year_from = yearFrom;
        confidence.year = 0.7;
      }
    }
  }
  if ('year_to' in obj) {
    if (obj.year_to == null) {
      cleared.add('year_to');
    } else if (
      typeof obj.year_to === 'number' &&
      Number.isFinite(obj.year_to)
    ) {
      const yearTo = Math.trunc(obj.year_to);
      if (yearTo < META_BOUNDS.yearMin || yearTo > META_BOUNDS.yearMax) {
        rejected.push({
          field: 'year_to',
          value: String(yearTo),
          reason: 'out of range',
        });
      } else {
        extracted.year_to = yearTo;
        confidence.year = 0.7;
      }
    }
  }
  if (
    extracted.year_from != null &&
    extracted.year_to != null &&
    extracted.year_from > extracted.year_to
  ) {
    rejected.push({
      field: 'year',
      value: `${extracted.year_from}-${extracted.year_to}`,
      reason: 'reversed range',
    });
    delete extracted.year_from;
    delete extracted.year_to;
    cleared.add('year_from');
    cleared.add('year_to');
  }

  let vector_query: string | null = null;
  if ('vector_query' in obj) {
    if (obj.vector_query == null) {
      cleared.add('vector_query');
      vector_query = null;
    } else if (typeof obj.vector_query === 'string') {
      vector_query = obj.vector_query.trim();
      if (!vector_query) cleared.add('vector_query');
    }
  }

  let free_text: string | null = null;
  if ('free_text' in obj) {
    if (obj.free_text == null) {
      cleared.add('free_text');
      free_text = null;
    } else if (typeof obj.free_text === 'string') {
      free_text = obj.free_text.trim();
      if (!free_text) cleared.add('free_text');
    }
  }

  return {
    extracted,
    cleared,
    vector_query,
    free_text,
    rejected,
    confidence,
  };
}
