/**
 * P3 key_scenes: representative scene stills + short summaries (plan/12).
 *
 * Scene candidates come from the directors script (`## SCENE N · HH:MM:SS–
 * HH:MM:SS` headers) when one exists on disk; otherwise the body range from
 * `meta.drama.structure` is split into uniform windows (still + time range,
 * no summary). Thumbs land under the drama run workspace and are served via
 * the /api/drama-media route — never embedded in ES _source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDramaEnv } from './env';
import { extractStillAtSec } from './extract-stills';
import type { StructureInterval } from './structure';
import type { DramaWorkspace } from './workspace';
import { writeDramaJson } from './workspace';

export interface KeyScene {
  start_ms: number;
  end_ms: number;
  summary_zh?: string;
  summary_en?: string;
  thumb_path?: string;
}

export interface SceneCandidate {
  index: number;
  startSec: number;
  endSec: number;
  summaryZh?: string;
  summaryEn?: string;
}

const SCENE_HEADER_RE = /^##\s+SCENE\s+[\d.]+/i;

/** Parse `HH:MM:SS` (or `MM:SS`, bare seconds) → seconds. */
function parseTimeToSec(raw: string): number | null {
  const s = raw.trim();
  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const sec = Number(hms[3]);
    if (m > 59 || sec > 59) return null;
    return h * 3600 + m * 60 + sec;
  }
  const ms = s.match(/^(\d{1,2}):(\d{2})$/);
  if (ms) {
    const m = Number(ms[1]);
    const sec = Number(ms[2]);
    if (sec > 59) return null;
    return m * 60 + sec;
  }
  const bare = Number(s);
  if (Number.isFinite(bare) && bare >= 0) return bare;
  return null;
}

function parseHeaderRange(header: string): {
  startSec: number | null;
  endSec: number | null;
} {
  const m = header.match(
    /(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d+(?:\.\d+)?)\s*[-–—~→]\s*(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\d+(?:\.\d+)?)/,
  );
  if (!m) return { startSec: null, endSec: null };
  return {
    startSec: parseTimeToSec(m[1]),
    endSec: parseTimeToSec(m[2]),
  };
}

/** Extract summary lines from the ZH/EN labeled director block. */
function extractSummary(block: string): { zh?: string; en?: string } {
  const grab = (label: RegExp): string | undefined => {
    for (const line of block.split(/\r?\n/)) {
      const s = line.trim();
      const m = s.match(label);
      if (m) {
        const text = s.replace(label, '').replace(/\*\*/g, '').trim();
        if (text) return text;
      }
    }
    return undefined;
  };
  return {
    zh: grab(/^\*\*SLUGLINE \(ZH\):\*\*/i),
    en: grab(/^\*\*SLUGLINE \(EN\):\*\*/i),
  };
}

/**
 * Parse scene candidates from a bilingual directors script body.
 * Falls back to uniform windows over the body range when no SCENE blocks
 * carry parseable time ranges. The `source` tells callers whether scenes
 * were actually selected (`script`) or are still-only placeholders
 * (`uniform-fallback`, no summaries — F6).
 */
export function parseSceneCandidates(opts: {
  rawScript?: string;
  structure?: StructureInterval[];
  durationMs: number;
  maxScenes: number;
}): {
  candidates: SceneCandidate[];
  source: 'script' | 'uniform-fallback' | 'none';
} {
  const out: SceneCandidate[] = [];

  if (opts.rawScript) {
    const blocks = opts.rawScript
      .split(/(?=^##\s+SCENE\s+)/m)
      .map((b) => b.trim())
      .filter(Boolean);
    for (const block of blocks) {
      if (!SCENE_HEADER_RE.test(block)) continue;
      const header = block.split(/\r?\n/)[0] ?? '';
      const numMatch = header.match(/^##\s+SCENE\s+([\d.]+)/i);
      const { startSec, endSec } = parseHeaderRange(header);
      if (startSec === null || endSec === null) continue;
      if (!(endSec > startSec)) continue;
      if (endSec - startSec < 3) continue; // too short to thumbnail
      const summary = extractSummary(block);
      out.push({
        index: numMatch ? Number(numMatch[1]) : out.length + 1,
        startSec,
        endSec,
        summaryZh: summary.zh,
        summaryEn: summary.en,
      });
    }
  }

  // Sort by index (script order), dedupe overlapping, cap.
  if (out.length > 0) {
    out.sort((a, b) => a.index - b.index);
    return { candidates: out.slice(0, opts.maxScenes), source: 'script' };
  }

  // Fallback: uniform windows across the body range.
  const body = opts.structure?.find((s) => s.kind === 'body');
  const durationSec = Math.max(1, Math.floor(opts.durationMs / 1000));
  const a = body ? Math.floor(body.start_ms / 1000) : 0;
  const b = body ? Math.min(Math.floor(body.end_ms / 1000), durationSec) : durationSec;
  const span = Math.max(1, b - a);
  const count = Math.min(opts.maxScenes, Math.max(1, Math.floor(span / 30)));
  for (let i = 0; i < count; i++) {
    const startSec = a + Math.floor((span * i) / count);
    const endSec = a + Math.floor((span * (i + 1)) / count);
    if (endSec - startSec < 3) continue;
    out.push({ index: i + 1, startSec, endSec });
  }
  return { candidates: out, source: out.length > 0 ? 'uniform-fallback' : 'none' };
}

export interface KeyScenesResult {
  scenes: KeyScene[];
  thumbsDir: string;
  scenesPath: string;
  /** F6: how scenes were chosen — fallback scenes carry no summaries. */
  selection: 'script' | 'uniform-fallback';
}

/**
 * Extract key scene stills + summaries into the drama workspace.
 * Never touches chunk vectors or asset editorial fields.
 */
export async function extractKeyScenes(opts: {
  videoPath: string;
  workspace: DramaWorkspace;
  rawScript?: string;
  structure?: StructureInterval[];
  durationMs: number;
  onProgress?: (msg: string) => void | Promise<void>;
}): Promise<KeyScenesResult> {
  const env = getDramaEnv();
  const { candidates, source } = parseSceneCandidates({
    rawScript: opts.rawScript,
    structure: opts.structure,
    durationMs: opts.durationMs,
    maxScenes: env.DRAMA_KEY_SCENES_MAX,
  });
  if (source === 'none' || candidates.length === 0) {
    throw new Error('No key scene candidates (no SCENE headers and no body range)');
  }

  const thumbsDir = path.join(opts.workspace.rootDir, 'scenes');
  fs.mkdirSync(thumbsDir, { recursive: true });
  const scenes: KeyScene[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    await opts.onProgress?.(
      `Drama: key scene ${i + 1}/${candidates.length} (${c.startSec}s–${c.endSec}s)…`,
    );
    const midSec = Math.floor((c.startSec + c.endSec) / 2);
    const outPath = path.join(
      thumbsDir,
      `scene_${String(c.index).padStart(3, '0')}_${c.startSec}s.jpg`,
    );
    try {
      if (!fs.existsSync(outPath)) {
        await extractStillAtSec({
          videoPath: opts.videoPath,
          sec: midSec,
          outPath,
          maxLongEdge: 640,
        });
      }
      if (!fs.existsSync(outPath)) continue;
      scenes.push({
        start_ms: Math.round(c.startSec * 1000),
        end_ms: Math.round(c.endSec * 1000),
        summary_zh: c.summaryZh,
        summary_en: c.summaryEn,
        thumb_path: path.relative(opts.workspace.rootDir, outPath),
      });
    } catch {
      /* skip still failure, keep going */
    }
  }

  const scenesPath = path.join(opts.workspace.rootDir, 'key_scenes.json');
  // F6: qualify the fallback — uniform windows are still-only placeholders,
  // not selected key scenes.
  writeDramaJson(scenesPath, { scenes, selection: source });
  // F6: no surviving stills means no accepted key content — fail loudly.
  if (scenes.length === 0) {
    throw new Error('key_scenes: all still extractions failed (no scene artifacts)');
  }
  return { scenes, thumbsDir, scenesPath, selection: source };
}
