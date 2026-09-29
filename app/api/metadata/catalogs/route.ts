import { NextResponse } from 'next/server';
import {
  COUNTRY_OPTIONS,
  PRIMARY_LANGUAGES,
  VIDEO_TYPES,
  countryLabel,
} from '@/lib/metadata/catalogs';
import { buildCatalogsPayload } from '@/lib/metadata/catalogs-payload';
import { listGroupCatalogResult } from '@/lib/metadata/groups';
import { loadPeopleCatalog, searchPeople } from '@/lib/metadata/people';

export const runtime = 'nodejs';

/**
 * GET /api/metadata/catalogs
 * Shared catalogs for Library editor + search facets + ingest.
 * Query: ?q= (people autocomplete) &locale=en|zh
 *
 * Group availability and the pinned catalogs do not depend on the person
 * catalog (todo/39 G3): a `people.json` failure degrades `people` to `[]` and
 * reports `people_status: 'unavailable'` instead of failing the whole
 * response. Group enumeration reports its own completeness
 * (`groups_status` + `groups_truncated`) so a partial/unavailable catalog is
 * distinguishable from a complete one.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'zh' ? 'zh' : 'en';
  const q = url.searchParams.get('q') ?? '';

  const groups = await listGroupCatalogResult(locale);

  const payload = buildCatalogsPayload({
    videoTypes: VIDEO_TYPES,
    primaryLanguages: PRIMARY_LANGUAGES,
    countries: COUNTRY_OPTIONS.map((c) => ({
      code: c.code,
      label: countryLabel(c.code, locale),
    })),
    groups,
    loadPeople: () => {
      loadPeopleCatalog();
      return searchPeople(q, locale, q ? 20 : 50);
    },
  });

  return NextResponse.json(payload);
}
