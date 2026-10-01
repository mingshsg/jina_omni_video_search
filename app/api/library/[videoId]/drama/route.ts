import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConfig } from '@/lib/config';
import { resolveDramaOptions } from '@/lib/ingest/drama-request';
import { IngestError } from '@/lib/ingest/errors';
import { ExistingDramaStartError, startExistingDrama } from '@/lib/drama/start-existing';

export const runtime = 'nodejs';

const requestSchema = z.object({
  languages: z.array(z.string()),
  modules: z.array(z.string()),
  // P4: per-run subtitle policy; validated here (cheap) and re-validated in
  // resolveDramaOptions (source of truth for IngestError semantics).
  subtitle_source: z.enum(['auto', 'existing_only', 'force_asr']).optional(),
  source_language: z.enum(['en', 'zh']).optional(),
  // P4: director coverage — only `sampled` is offered; anything else (e.g.
  // `full`) must be rejected.
  director_coverage: z.enum(['sampled']).optional(),
});

export async function POST(request: Request, { params }: { params: { videoId: string } }) {
  const videoId = decodeURIComponent(params.videoId ?? '').trim();
  if (!videoId || videoId.includes('/') || videoId.includes('..')) {
    return NextResponse.json(
      { error: { code: 'LIBRARY_INVALID', message: 'Invalid video id' } },
      { status: 400 },
    );
  }
  try {
    getConfig();
    const raw: unknown = await request.json();
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INGEST_DRAMA_INVALID', message: 'Invalid drama options' } },
        { status: 400 },
      );
    }
    const options = resolveDramaOptions({ enabled: true, ...parsed.data });
    if (!options) throw new Error('Drama options unexpectedly disabled');
    const started = await startExistingDrama(videoId, options);
    // P4: echo the resolved per-run policy in the 202 body alongside the
    // job/video/run identity (run_id is assigned by the handoff marker).
    return NextResponse.json(
      {
        ...started,
        status: 'pending',
        subtitle_source: options.subtitleSource,
        source_language: options.sourceLanguage,
        director_coverage: options.directorCoverage,
      },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof ExistingDramaStartError || err instanceof IngestError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err instanceof ExistingDramaStartError ? err.status : 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Could not start drama enrichment';
    return NextResponse.json(
      { error: { code: 'DRAMA_START_FAILED', message: message.replace(/ApiKey\s+\S+/gi, 'ApiKey [redacted]') } },
      { status: 500 },
    );
  }
}
