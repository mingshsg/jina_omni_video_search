/**
 * Pure response builder for `GET /api/metadata/catalogs` (todo/39 G3).
 *
 * Decoupling rules, testable without Next or Elasticsearch:
 * - A person-catalog failure degrades **only** `people` (→ `[]`,
 *   `people_status: 'unavailable'`) and never blocks the pinned catalogs or
 *   the group enumeration.
 * - Group enumeration reports its own `groups_status` / `groups_truncated`
 *   so a partial or unavailable group catalog is distinguishable from a
 *   complete one.
 */
import type { PersonSummary } from './people';

export type CatalogsPayload = {
  video_types: string[];
  primary_languages: string[];
  countries: Array<{ code: string; label: string }>;
  groups: Array<{ id: string; label: string }>;
  groups_status: 'ok' | 'partial' | 'unavailable';
  groups_total: number;
  groups_truncated: boolean;
  groups_error?: string;
  people: PersonSummary[];
  people_status: 'ok' | 'unavailable';
  people_error?: string;
};

export function buildCatalogsPayload(params: {
  videoTypes: readonly string[];
  primaryLanguages: readonly string[];
  countries: Array<{ code: string; label: string }>;
  groups: {
    entries: Array<{ id: string; label: string }>;
    status: 'ok' | 'partial' | 'unavailable';
    total_groups: number;
    truncated: boolean;
    error?: string;
  };
  loadPeople: () => PersonSummary[];
}): CatalogsPayload {
  let people: PersonSummary[] = [];
  let peopleError: string | undefined;
  try {
    people = params.loadPeople();
  } catch (err) {
    peopleError =
      err instanceof Error ? err.message : 'Person catalog unavailable';
  }

  return {
    video_types: [...params.videoTypes],
    primary_languages: [...params.primaryLanguages],
    countries: params.countries,
    groups: params.groups.entries,
    groups_status: params.groups.status,
    groups_total: params.groups.total_groups,
    groups_truncated: params.groups.truncated,
    ...(params.groups.error ? { groups_error: params.groups.error } : {}),
    people,
    people_status: peopleError ? 'unavailable' : 'ok',
    ...(peopleError ? { people_error: peopleError } : {}),
  };
}
