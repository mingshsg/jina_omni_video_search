/**
 * Propose drama structure intervals (片头/片尾/body, optional intro/recap).
 * Uses ffmpeg blackdetect when available; falls back to duration heuristics.
 */
import { runFfmpeg } from '../video/run-ffmpeg';

export type StructureKind =
  | 'opening_credits'
  | 'ending_credits'
  | 'recap'
  | 'intro'
  | 'body'
  | 'unknown';

export interface StructureInterval {
  kind: StructureKind;
  start_ms: number;
  end_ms: number;
  confidence: number;
  source: 'ffmpeg_blackdetect' | 'heuristic';
}

interface BlackSegment {
  startSec: number;
  endSec: number;
}

function parseBlackdetect(stderr: string): BlackSegment[] {
  const out: BlackSegment[] = [];
  const re =
    /black_start:([\d.]+)\s+black_end:([\d.]+)(?:\s+black_duration:([\d.]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const startSec = Number(m[1]);
    const endSec = Number(m[2]);
    if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
      out.push({ startSec, endSec });
    }
  }
  return out;
}

async function detectBlackSegments(
  videoPath: string,
  analyzeSeconds: number,
): Promise<BlackSegment[]> {
  try {
    const { stderr } = await runFfmpeg('ffmpeg', [
      '-hide_banner',
      '-i',
      videoPath,
      '-t',
      String(Math.max(1, Math.floor(analyzeSeconds))),
      '-vf',
      'blackdetect=d=0.4:pix_th=0.12',
      '-an',
      '-f',
      'null',
      '-',
    ]);
    return parseBlackdetect(stderr);
  } catch (err) {
    // ffmpeg writes blackdetect to stderr even on "failure" paths; try parse
    const msg = err instanceof Error ? err.message : String(err);
    return parseBlackdetect(msg);
  }
}

async function detectTrailingBlack(
  videoPath: string,
  durationMs: number,
  windowSec: number,
): Promise<BlackSegment[]> {
  const durationSec = durationMs / 1000;
  const start = Math.max(0, durationSec - windowSec);
  try {
    const { stderr } = await runFfmpeg('ffmpeg', [
      '-hide_banner',
      '-ss',
      String(start.toFixed(3)),
      '-i',
      videoPath,
      '-vf',
      'blackdetect=d=0.4:pix_th=0.12',
      '-an',
      '-f',
      'null',
      '-',
    ]);
    return parseBlackdetect(stderr).map((s) => ({
      startSec: s.startSec + start,
      endSec: s.endSec + start,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return parseBlackdetect(msg).map((s) => ({
      startSec: s.startSec + start,
      endSec: s.endSec + start,
    }));
  }
}

/**
 * Build half-open [start_ms, end_ms) structure coverage for the full duration.
 */
export async function proposeStructure(opts: {
  videoPath: string;
  durationMs: number;
}): Promise<StructureInterval[]> {
  const durationMs = Math.max(0, Math.floor(opts.durationMs));
  if (durationMs <= 0) {
    return [
      {
        kind: 'unknown',
        start_ms: 0,
        end_ms: 0,
        confidence: 0,
        source: 'heuristic',
      },
    ];
  }

  const headWindowSec = Math.min(300, durationMs / 1000);
  const tailWindowSec = Math.min(300, durationMs / 1000);
  const headBlack = await detectBlackSegments(opts.videoPath, headWindowSec);
  const tailBlack = await detectTrailingBlack(
    opts.videoPath,
    durationMs,
    tailWindowSec,
  );

  let openEndMs: number;
  let openConf: number;
  let openSource: StructureInterval['source'];
  const earlyBlack = headBlack.find(
    (b) => b.startSec < 45 && b.endSec - b.startSec >= 0.8,
  );
  if (earlyBlack) {
    openEndMs = Math.min(
      durationMs,
      Math.round(earlyBlack.endSec * 1000),
    );
    // Opening often ends shortly after first black bumper
    openEndMs = Math.min(durationMs, Math.max(openEndMs, 15_000));
    openConf = 0.65;
    openSource = 'ffmpeg_blackdetect';
  } else {
    // Classic TV bumper guess: 60–90s
    openEndMs = Math.min(durationMs, durationMs < 180_000 ? 30_000 : 75_000);
    openConf = 0.35;
    openSource = 'heuristic';
  }

  let endStartMs: number;
  let endConf: number;
  let endSource: StructureInterval['source'];
  const lateBlack = [...tailBlack]
    .reverse()
    .find((b) => b.endSec * 1000 > durationMs - 180_000);
  if (lateBlack && lateBlack.startSec * 1000 < durationMs - 5_000) {
    endStartMs = Math.max(
      openEndMs,
      Math.round(lateBlack.startSec * 1000),
    );
    endConf = 0.65;
    endSource = 'ffmpeg_blackdetect';
  } else {
    const guess = durationMs < 180_000 ? 20_000 : 90_000;
    endStartMs = Math.max(openEndMs, durationMs - guess);
    endConf = 0.35;
    endSource = 'heuristic';
  }

  const intervals: StructureInterval[] = [];
  if (openEndMs > 0) {
    intervals.push({
      kind: 'opening_credits',
      start_ms: 0,
      end_ms: openEndMs,
      confidence: openConf,
      source: openSource,
    });
  }

  // Optional short intro after opening when episode is long
  let bodyStart = openEndMs;
  if (durationMs >= 20 * 60_000 && openEndMs + 45_000 < endStartMs) {
    const introEnd = openEndMs + 30_000;
    intervals.push({
      kind: 'intro',
      start_ms: openEndMs,
      end_ms: introEnd,
      confidence: 0.3,
      source: 'heuristic',
    });
    bodyStart = introEnd;
  }

  if (bodyStart < endStartMs) {
    intervals.push({
      kind: 'body',
      start_ms: bodyStart,
      end_ms: endStartMs,
      confidence: 0.5,
      source: openSource === 'heuristic' && endSource === 'heuristic'
        ? 'heuristic'
        : 'ffmpeg_blackdetect',
    });
  }

  if (endStartMs < durationMs) {
    intervals.push({
      kind: 'ending_credits',
      start_ms: endStartMs,
      end_ms: durationMs,
      confidence: endConf,
      source: endSource,
    });
  }

  return intervals;
}

/** Pure helper for unit tests — duration-only fallback. */
export function heuristicStructureOnly(durationMs: number): StructureInterval[] {
  const d = Math.max(0, Math.floor(durationMs));
  if (d <= 0) return [];
  const openEnd = Math.min(d, d < 180_000 ? 30_000 : 75_000);
  const endStart = Math.max(openEnd, d - (d < 180_000 ? 20_000 : 90_000));
  return [
    {
      kind: 'opening_credits',
      start_ms: 0,
      end_ms: openEnd,
      confidence: 0.35,
      source: 'heuristic',
    },
    {
      kind: 'body',
      start_ms: openEnd,
      end_ms: endStart,
      confidence: 0.5,
      source: 'heuristic',
    },
    {
      kind: 'ending_credits',
      start_ms: endStart,
      end_ms: d,
      confidence: 0.35,
      source: 'heuristic',
    },
  ];
}
