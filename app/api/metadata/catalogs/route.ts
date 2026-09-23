import { NextResponse } from 'next/server';
import {
  COUNTRY_OPTIONS,
  PRIMARY_LANGUAGES,
  VIDEO_TYPES,
  countryLabel,
} from '@/lib/metadata/catalogs';
import { loadPeopleCatalog, searchPeople } from '@/lib/metadata/people';

export const runtime = 'nodejs';

/**
 * GET /api/metadata/catalogs
 * Shared catalogs for Library editor (+ future search facets).
 * Query: ?q= (people autocomplete) &locale=en|zh
 */
export async function GET(request: Request) {
  try {
    loadPeopleCatalog();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Person catalog unavailable';
    return NextResponse.json(
      { error: { code: 'CATALOG_FAILED', message } },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'zh' ? 'zh' : 'en';
  const q = url.searchParams.get('q') ?? '';

  return NextResponse.json({
    video_types: [...VIDEO_TYPES],
    primary_languages: [...PRIMARY_LANGUAGES],
    countries: COUNTRY_OPTIONS.map((c) => ({
      code: c.code,
      label: countryLabel(c.code, locale),
    })),
    people: searchPeople(q, locale, q ? 20 : 50),
  });
}
