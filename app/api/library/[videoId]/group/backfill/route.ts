import { NextResponse } from 'next/server';
import { backfillAssetGroup } from '@/lib/es/group-backfill';

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

  let expectedGroup: 'trailer' | 'demo';
  try {
    const body: unknown = await _request.json();
    const value =
      body && typeof body === 'object' && 'expected_group_id' in body
        ? body.expected_group_id
        : null;
    if (value !== 'trailer' && value !== 'demo') throw new Error('invalid');
    expectedGroup = value;
  } catch {
    return NextResponse.json(
      { error: { code: 'GROUP_BACKFILL_INVALID' } },
      { status: 400 },
    );
  }

  try {
    const outcome = await backfillAssetGroup(videoId, expectedGroup);
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
