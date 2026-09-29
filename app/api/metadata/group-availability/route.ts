import { NextResponse } from 'next/server';
import { listGroupAvailability } from '@/lib/metadata/group-availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/metadata/group-availability
 * Server-backed group → ready-variant availability for the search Group
 * control (todo/39 G1). Not limited by `/api/library`'s newest 200 assets.
 *
 * Query:
 * - `locale=en|zh`
 * - `include=<groupId>` (repeatable) — ids that must stay visible even when
 *   the terms aggregation was truncated (selected groups).
 * - `q=<exact group name>` — exact lookup so a group outside the top-N stays
 *   selectable (todo/39 G5).
 *
 * Always 200 with an explicit `status`: `ok` | `partial` (truncated) |
 * `unavailable` (enumeration failed; `groups` holds starter suggestions and
 * the client can retry). Never leaks provider credentials.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'zh' ? 'zh' : 'en';
  const q = url.searchParams.get('q') ?? '';
  const includeIds = url.searchParams.getAll('include');

  const result = await listGroupAvailability({ locale, includeIds, q });
  return NextResponse.json(result);
}
