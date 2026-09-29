import { NextResponse } from 'next/server';
import { backfillAssetGroup } from '@/lib/es/group-backfill';
import { parseFreeformGroupId } from '@/lib/metadata/groups';

export const runtime = 'nodejs';

type Params = { params: { videoId: string } };

/** POST is intentionally scoped to one video and never overwrites a group. */
export async function POST(_request: Request, { params }: Params) {
  const videoId = params.videoId?.trim();
  if (!videoId || videoId.includes('/') || videoId.includes('..')) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }

  let selectedGroup: string;
  let expectedSuggestion: 'trailer' | 'demo' | undefined;
  try {
    const body: unknown = await _request.json();
    if (!body || typeof body !== 'object') throw new Error('invalid');
    if ('group_id' in body && 'expected_group_id' in body) {
      throw new Error('ambiguous');
    }
    if ('group_id' in body && typeof body.group_id === 'string') {
      selectedGroup = parseFreeformGroupId(body.group_id);
    } else if ('expected_group_id' in body) {
      const value = body.expected_group_id;
      if (value !== 'trailer' && value !== 'demo') throw new Error('invalid');
      expectedSuggestion = value;
      selectedGroup = value;
    } else {
      throw new Error('invalid');
    }
  } catch {
    return NextResponse.json(
      { error: { code: 'GROUP_BACKFILL_INVALID' } },
      { status: 400 },
    );
  }

  try {
    const outcome = await backfillAssetGroup(
      videoId,
      selectedGroup,
      expectedSuggestion,
    );
    if (outcome.status === 'updated') {
      return NextResponse.json({ video_id: videoId, group_id: outcome.group_id });
    }
    const statuses = { not_found: 404, already_set: 409, no_match: 422, changed: 409 } as const;
    return NextResponse.json(
      { error: { code: `GROUP_BACKFILL_${outcome.status.toUpperCase()}` } },
      { status: statuses[outcome.status] },
    );
  } catch {
    return NextResponse.json(
      { error: { code: 'GROUP_BACKFILL_FAILED' } },
      { status: 500 },
    );
  }
}
