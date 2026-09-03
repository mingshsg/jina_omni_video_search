import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { listAssets } from '@/lib/es/list-assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/library — indexed videos + variants for the library UI. */
export async function GET() {
  try {
    getConfig();
    const assets = await listAssets(200);
    const variantIds = Array.from(
      new Set(
        assets.flatMap((a) =>
          a.variants.filter((v) => v.status === 'ready').map((v) => v.variant_id),
        ),
      ),
    );
    return NextResponse.json({ assets, variant_ids: variantIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Library list failed';
    const safe = message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]');
    return NextResponse.json(
      { error: { code: 'LIBRARY_FAILED', message: safe } },
      { status: 500 },
    );
  }
}
