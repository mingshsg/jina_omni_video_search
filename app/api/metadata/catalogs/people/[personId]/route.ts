import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  KNOWN_AS_MAX,
  KNOWN_AS_NAME_MAX_LEN,
  PersonCatalogError,
  displayNameForPerson,
  setPersonAliases,
} from '@/lib/metadata/people';

export const runtime = 'nodejs';

type Params = { params: { personId: string } };

// Bounds are imported, not restated (todo/32 R6): this schema previously
// said `.max(50)` while `setPersonAliases` enforced 30, so the API
// advertised a limit the system did not honor.
const bodySchema = z
  .object({
    aliases: z
      .array(z.string().trim().min(1).max(KNOWN_AS_NAME_MAX_LEN))
      .min(1)
      .max(KNOWN_AS_MAX),
  })
  .strict();

function parsePersonId(raw: string | undefined): string | null {
  const id = decodeURIComponent(raw ?? '').trim();
  if (!id || !id.startsWith('person:') || id.includes('/') || id.includes('..')) {
    return null;
  }
  return id;
}

function localeFromRequest(request: Request): string {
  const header = request.headers.get('accept-language') ?? 'en';
  return header.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * PATCH /api/metadata/catalogs/people/{personId}
 * Replaces a person's full "known as" list (their `aliases` array) — the
 * only write path for growing a person's known names after creation. See
 * `setPersonAliases` for the collision-rejection behavior this adds over
 * the historical (silent-overwrite) alias index.
 */
export async function PATCH(request: Request, { params }: Params) {
  const personId = parsePersonId(params.personId);
  if (!personId) {
    return NextResponse.json(
      { error: { code: 'PEOPLE_INVALID', message: 'Invalid person id' } },
      { status: 400 },
    );
  }

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
    const { id, entry } = setPersonAliases(personId, parsed.data.aliases);
    const locale = localeFromRequest(request);
    return NextResponse.json({
      id,
      display: displayNameForPerson(id, locale),
      aliases: entry.aliases,
    });
  } catch (err) {
    if (err instanceof PersonCatalogError) {
      const status =
        err.code === 'conflict' ? 409 : err.message.startsWith('Unknown person') ? 404 : 400;
      return NextResponse.json(
        { error: { code: `PEOPLE_${err.code.toUpperCase()}`, message: err.message } },
        { status },
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to update known names';
    return NextResponse.json(
      { error: { code: 'PEOPLE_FAILED', message } },
      { status: 500 },
    );
  }
}
