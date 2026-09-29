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
 *
 * todo/40 R4: the failure field is a **fixed public code** rather than the raw
 * exception text. `loadPeople`'s throw is handed to an optional `log` callback
 * (sanitized for a redacted credential) so diagnostics stay server-side and
 * never reach an API response (hard invariant 4).
 */
import {
  GROUP_CATALOG_UNAVAILABLE,
  PEOPLE_CATALOG_UNAVAILABLE,
  sanitizeCatalogError,
} from './catalog-errors';
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
    /** Sanitized detail for server-side logging only — never returned. */
    error?: string;
  };
  loadPeople: () => PersonSummary[];
  /**
   * Optional server-side log sink for a person-catalog failure. Receives a
   * credential-redacted message; the response only ever carries the fixed
   * {@link PEOPLE_CATALOG_UNAVAILABLE} code (todo/40 R4).
   */
  log?: (message: string) => void;
}): CatalogsPayload {
  let people: PersonSummary[] = [];
  let peopleFailed = false;
  try {
    people = params.loadPeople();
  } catch (err) {
    peopleFailed = true;
    params.log?.(`person catalog load failed: ${sanitizeCatalogError(err)}`);
  }

  return {
    video_types: [...params.videoTypes],
    primary_languages: [...params.primaryLanguages],
    countries: params.countries,
    groups: params.groups.entries,
    groups_status: params.groups.status,
    groups_total: params.groups.total_groups,
    groups_truncated: params.groups.truncated,
    // Fixed code only; the raw group-enumeration message is logged by
    // `listGroupCatalogResult`'s caller and never copied here.
    ...(params.groups.status === 'unavailable'
      ? { groups_error: GROUP_CATALOG_UNAVAILABLE }
      : {}),
    people,
    people_status: peopleFailed ? 'unavailable' : 'ok',
    ...(peopleFailed ? { people_error: PEOPLE_CATALOG_UNAVAILABLE } : {}),
  };
}
