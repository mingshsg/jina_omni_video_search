import { NextResponse } from 'next/server';
import type { IngestJob } from '@/lib/ingest/job-store';
import { toProgressEvent } from '@/lib/ingest/job-store';

/** JSON body returned after ingest / confirm / retry accept. */
export function ingestAcceptResponse(job: IngestJob) {
  const snap = toProgressEvent(job);
  return {
    job_id: job.id,
    video_id: job.videoId,
    status: job.status,
    mode: job.mode,
    variant_id: job.variantId,
    workload: job.workload,
    probe: {
      duration_ms: job.probe.duration_ms,
      width: job.probe.width,
      height: job.probe.height,
      has_audio: job.probe.has_audio,
    },
    provenance: job.provenance,
    stage: snap.stage,
  };
}

export function jsonOk(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
