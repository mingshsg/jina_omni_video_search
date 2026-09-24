import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  addPersonToCatalog,
  displayNameForPerson,
  PersonCatalogError,
} from '@/lib/metadata/people';

export const runtime = 'nodejs';

const bodySchema = z.object({
  en: z.string().trim().min(1).max(200),
  zh: z.string().trim().min(1).max(200).optional(),
  native: z
    .object({
      lang: z.string().trim().min(1).max(16),
      name: z.string().trim().min(1).max(200),
    })
    .optional(),
});

function localeFromRequest(request: Request): string {
  const header = request.headers.get('accept-language') ?? 'en';
  return header.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * POST /api/metadata/catalogs/people
 * Grows the person catalog with one new entry, sourced from a Suggest actor
 * candidate the editor confirmed is not yet on file. Returns the new
 * catalog id so the caller can select it immediately.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'PEOPLE_INVALID', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: {
          code: 'PEOPLE_INVALID',
          message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid request',
        },
      },
      { status: 400 },
    );
  }

  try {
    const { id, entry } = addPersonToCatalog(parsed.data);
    const locale = localeFromRequest(request);
    return NextResponse.json(
      { id, display: displayNameForPerson(id, locale), aliases: entry.aliases },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof PersonCatalogError) {
      return NextResponse.json(
        { error: { code: `PEOPLE_${err.code.toUpperCase()}`, message: err.message } },
        { status: err.code === 'conflict' ? 409 : 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to add person';
    return NextResponse.json(
      { error: { code: 'PEOPLE_FAILED', message } },
      { status: 500 },
    );
  }
}
