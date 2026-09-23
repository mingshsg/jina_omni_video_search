/**
 * Pure UI → API filter mapping (no React). Shared by SearchFacets and tests.
 */
export type SearchFacetState = {
  year_from: string;
  year_to: string;
  country: string;
  video_type: string;
  primary_language: string;
  actor_ids: Array<{ label: string; value?: string | number | string[] | null }>;
  tags: string;
};

export const EMPTY_FACETS: SearchFacetState = {
  year_from: '',
  year_to: '',
  country: '',
  video_type: '',
  primary_language: '',
  actor_ids: [],
  tags: '',
};

export type FacetsToApiResult =
  | { ok: true; filters?: Record<string, unknown> }
  | { ok: false; error: string };

/** Build API `filters` object from UI state; never silently drop a field. */
export function facetsToApiFilters(
  facets: SearchFacetState,
  messages?: {
    yearInvalid?: string;
    yearReversed?: string;
  },
): FacetsToApiResult {
  const out: Record<string, unknown> = {};
  const yearInvalid =
    messages?.yearInvalid ?? 'Year must be a whole number (e.g. 1960)';
  const yearReversed =
    messages?.yearReversed ?? 'Year from must be less than or equal to year to';

  let yearFrom: number | undefined;
  let yearTo: number | undefined;

  if (facets.year_from.trim()) {
    const n = Number(facets.year_from.trim());
    if (!Number.isInteger(n)) {
      return { ok: false, error: yearInvalid };
    }
    yearFrom = n;
    out.year_from = n;
  }
  if (facets.year_to.trim()) {
    const n = Number(facets.year_to.trim());
    if (!Number.isInteger(n)) {
      return { ok: false, error: yearInvalid };
    }
    yearTo = n;
    out.year_to = n;
  }
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    return { ok: false, error: yearReversed };
  }

  if (facets.country) out.country = [facets.country];
  if (facets.video_type) out.video_type = [facets.video_type];
  if (facets.primary_language) out.primary_language = [facets.primary_language];
  if (facets.actor_ids.length) {
    out.actor_ids = facets.actor_ids.map((o) => String(o.value));
  }
  const tags = facets.tags
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (tags.length) out.tags = tags;
  return {
    ok: true,
    filters: Object.keys(out).length > 0 ? out : undefined,
  };
}
