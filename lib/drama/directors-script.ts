/**
 * Directors script generation (Node + EIS multimodal) — plan/12 P2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DRAMA_LANGUAGES, type DramaLanguage } from '../ingest/drama-options';
import { getDramaEnv } from './env';
import {
  callDramaEisChat,
  imageDataUrlFromJpeg,
  type EisChatContentPart,
  DramaEisChatError,
} from './eis-chat';
import { extractStillAtSec, sampleTimestamps } from './extract-stills';
import {
  renumberScenes,
  splitBilingualDirectorsDoc,
} from './bilingual-split';
import { parseSrt, type SrtCue } from './srt';
import type { StructureInterval } from './structure';
import type { DramaWorkspace } from './workspace';
import { writeDramaJson } from './workspace';

function tc(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const rem = s % 3600;
  const m = Math.floor(rem / 60);
  const ss = rem % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function loadCues(srtPath: string | undefined): SrtCue[] {
  if (!srtPath || !fs.existsSync(srtPath)) return [];
  try {
    return parseSrt(fs.readFileSync(srtPath, 'utf8'));
  } catch {
    return [];
  }
}

function cuesInWindow(cues: SrtCue[], t0: number, t1: number): SrtCue[] {
  const a = t0 * 1000;
  const b = t1 * 1000;
  return cues.filter((c) => c.endMs > a && c.startMs < b).slice(0, 80);
}

type SubtitleEvidence = Partial<Record<DramaLanguage, SrtCue[]>>;

const subtitleLabels: Record<DramaLanguage, string> = {
  zh: 'Chinese',
  en: 'English',
  ko: 'Korean',
  th: 'Thai',
};

function formatSubtitleEvidence(evidence: SubtitleEvidence, limit: number): string {
  return DRAMA_LANGUAGES.filter((lang) => evidence[lang]?.length)
    .map((lang) => {
      const lines = evidence[lang]!
        .slice(0, limit)
        .map((c) => `- [${tc(c.startMs / 1000)}] ${c.text}`)
        .join('\n');
      return `${subtitleLabels[lang]} subtitle cues (timed):\n${lines}`;
    })
    .join('\n\n') || '(no timed subtitle cues available)';
}

function windowPrompt(opts: {
  title: string;
  t0: number;
  t1: number;
  nFrames: number;
  subtitleEvidence: SubtitleEvidence;
}): string {
  const subtitleEvidence = formatSubtitleEvidence(opts.subtitleEvidence, 80);
  return `You are writing a DETAILED bilingual director's script for "${opts.title}".
Window: ${tc(opts.t0)}–${tc(opts.t1)} (${opts.t0}–${opts.t1}s). You are given ${opts.nFrames} stills labeled with timestamps.

Write 1–4 SCENE blocks covering ONLY this window. Use this exact template per scene:

## SCENE <N> · <HH:MM:SS>–<HH:MM:SS>

**SLUGLINE (ZH):** ...
**SLUGLINE (EN):** EXT/INT. LOCATION — DAY/NIGHT — BEAT

**VISUAL / ACTION (detailed)**
- **ZH:** (blocking, costume, camera, props, expression — concrete)
- **EN:** (same level of detail)

**ACTIVITY (ZH):** ...
**ACTIVITY (EN):** ...

**EFFECTS / SFX / MUSIC (ZH):**
- ...
**EFFECTS / SFX / MUSIC (EN):**
- ...

**DIALOGUE (ZH):**
- [HH:MM:SS] line
**DIALOGUE (EN):**
- [HH:MM:SS] line

**DIR. NOTES (ZH):**
- ...
**DIR. NOTES (EN):**
- ...

Rules:
- Be specific from the images (not generic).
- Opening theme / ending credits: say so; don't invent plot dialogue.
- Number scenes locally as 1,2,3… for this window only.
- Keep ZH and EN sections clearly labeled (required for language split).
- Subtitle cues may be in Chinese, English, Korean, or Thai. Use them as source-language evidence; translate dialogue into the ZH and EN output sections only when supported. Do not invent uncertain lines.
- Output markdown only (no JSON wrapper).

${subtitleEvidence}
`;
}

/** Choose [startSec,endSec) coverage windows, capped for cost. */
export function planDirectorWindows(opts: {
  durationMs: number;
  structure?: StructureInterval[];
  windowSec: number;
  maxWindows: number;
}): Array<{ t0: number; t1: number }> {
  const durationSec = Math.max(1, Math.floor(opts.durationMs / 1000));
  const body = opts.structure?.find((s) => s.kind === 'body');
  const rangeStart = body
    ? Math.floor(body.start_ms / 1000)
    : 0;
  const rangeEnd = body
    ? Math.floor(body.end_ms / 1000)
    : durationSec;
  const span = Math.max(1, rangeEnd - rangeStart);
  const windowSec = Math.max(30, opts.windowSec);
  const natural = Math.ceil(span / windowSec);
  const count = Math.min(opts.maxWindows, natural);
  const windows: Array<{ t0: number; t1: number }> = [];
  if (count <= 0) return windows;
  // Prefer early body coverage (consecutive windows from rangeStart)
  for (let i = 0; i < count; i++) {
    const t0 = rangeStart + i * windowSec;
    if (t0 >= rangeEnd) break;
    const t1 = Math.min(rangeEnd, t0 + windowSec);
    if (t1 - t0 < 5) break;
    windows.push({ t0, t1 });
  }
  return windows;
}

export interface DirectorsScriptResult {
  scriptZhPath: string;
  scriptEnPath: string;
  scriptRawPath: string;
  synopsisZh: string;
  synopsisEn: string;
  sceneCount: number;
  /** Successful windows (failures excluded). Was planned count before R3. */
  windowsDone: number;
  /** Planned windows (cost cap). */
  windowsPlanned: number;
  /** Planned span [startSec, endSec) — never a whole-episode claim. */
  coverageStartSec: number;
  coverageEndSec: number;
  /**
   * Successful seconds only (F5): sum of successful window lengths.
   * Failed planned windows are listed in `coverageGaps`, not counted.
   */
  coverageSec: number;
  /** Successful window ranges (F5). */
  coverageRanges: Array<{ t0: number; t1: number }>;
  /** Planned-but-failed ranges (F5) — marked gaps, not coverage. */
  coverageGaps: Array<{ t0: number; t1: number }>;
  usageTotal: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    calls: number;
  };
  audit?: {
    status: 'skipped' | 'ok' | 'failed';
    /** Parsed auditor verdict (only present when the auditor answered). */
    verdict?: 'supported' | 'insufficient' | 'contradicted';
    /**
     * Reviewed span (I5): the verdict covers exactly this evidence —
     * the full synopsis plus a bounded script sample, cue excerpts and
     * stills. Unreviewed script beyond the sample is NOT audited.
     */
    scope?: {
      synopsisChars: number;
      scriptSampleChars: number;
      cues: Partial<Record<DramaLanguage, number>>;
      stills: number;
    };
    detail?: string;
  };
}

async function summarizeScript(opts: {
  title: string;
  bilingualBody: string;
}): Promise<{ zh: string; en: string }> {
  const excerpt = opts.bilingualBody.slice(0, 12_000);
  try {
    const { text } = await callDramaEisChat({
      messages: [
        {
          role: 'user',
          content: `From this bilingual director's script excerpt for "${opts.title}", write:
SYNOPSIS_ZH: <4-6 sentences Chinese, low-spoiler promotional tone>
SYNOPSIS_EN: <4-6 sentences English, same coverage>

Script excerpt:
${excerpt}`,
        },
      ],
      timeoutMs: 90_000,
    });
    const zh =
      text.match(/SYNOPSIS_ZH:\s*([\s\S]*?)(?=SYNOPSIS_EN:|$)/i)?.[1]?.trim() ??
      '';
    const en =
      text.match(/SYNOPSIS_EN:\s*([\s\S]*?)$/i)?.[1]?.trim() ?? '';
    return {
      zh: zh || text.slice(0, 800),
      en: en || text.slice(0, 800),
    };
  } catch {
    return { zh: '', en: '' };
  }
}

export function parseAuditVerdict(
  text: string,
): 'supported' | 'insufficient' | 'contradicted' | undefined {
  const m = text.match(/VERDICT:\s*(supported|insufficient|contradicted)/i);
  return m?.[1]?.toLowerCase() as
    | 'supported'
    | 'insufficient'
    | 'contradicted'
    | undefined;
}

/** Max sampled stills attached to the audit call (visual evidence, F2). */
const AUDIT_STILL_MAX = 8;

async function optionalAudit(opts: {
  sample: string;
  /** Full synopsis under review (I5) — short, always included in full. */
  synopsis: { zh: string; en: string };
  /** Timed source-language subtitle evidence with timestamps. */
  subtitleEvidence: SubtitleEvidence;
  windows: Array<{ t0: number; t1: number }>;
  /** Extracted window stills ({sec, path}); evenly sampled up to a cap. */
  stills: Array<{ sec: number; path: string }>;
}): Promise<DirectorsScriptResult['audit']> {
  const env = getDramaEnv();
  const propose =
    env.DRAMA_EIS_CHAT_INFERENCE_ID.trim() ||
    process.env.SUGGEST_AGENT_CONNECTOR_ID?.trim() ||
    '';
  const audit = env.DRAMA_EIS_AUDIT_INFERENCE_ID.trim();
  if (!audit) {
    return { status: 'skipped', detail: 'DRAMA_EIS_AUDIT_INFERENCE_ID unset' };
  }
  if (audit === propose) {
    return {
      status: 'failed',
      detail: 'audit inference id must differ from propose id',
    };
  }
  const windowRanges = opts.windows
    .map((w) => `${tc(w.t0)}–${tc(w.t1)}`)
    .join(', ');
  const subtitleEvidence = formatSubtitleEvidence(opts.subtitleEvidence, 60);
  // Evenly-spaced visual evidence so the auditor can check action/costume
  // claims, not just dialogue/timing (F2). Missing files are skipped.
  const picked = opts.stills.filter((s) => {
    try {
      return fs.existsSync(s.path);
    } catch {
      return false;
    }
  });
  const step = Math.max(1, Math.ceil(picked.length / AUDIT_STILL_MAX));
  const auditStills = picked.filter((_, i) => i % step === 0).slice(0, AUDIT_STILL_MAX);
  const stillParts: EisChatContentPart[] = [];
  for (const st of auditStills) {
    stillParts.push({ type: 'text', text: `Still [${tc(st.sec)}] (${st.sec}s):` });
    try {
      stillParts.push(imageDataUrlFromJpeg(fs.readFileSync(st.path)));
    } catch {
      /* skip unreadable still */
    }
  }
  // I5: the verdict covers the full synopsis plus this bounded span —
  // recorded on every answered outcome so reviewers know what was checked.
  const scriptSample = opts.sample.slice(0, 4000);
  const scope = {
    synopsisChars: opts.synopsis.zh.length + opts.synopsis.en.length,
    scriptSampleChars: scriptSample.length,
    cues: Object.fromEntries(
      DRAMA_LANGUAGES.filter((lang) => opts.subtitleEvidence[lang]?.length).map(
        (lang) => [lang, opts.subtitleEvidence[lang]!.length],
      ),
    ) as Partial<Record<DramaLanguage, number>>,
    stills: auditStills.length,
  };
  try {
    const { text } = await callDramaEisChat({
      inferenceId: audit,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are an auditor. The SYNOPSIS below must hold against the timed evidence (subtitle cues with timestamps, the sampled window ranges, and ${auditStills.length} timestamped stills the script was written from), and so must the directors-script sample. Check dialogue/timing claims against the cues AND visual/action claims against the stills. Reply with exactly:
VERDICT: supported|insufficient|contradicted
REASON: <short>

SYNOPSIS (must hold in full):
${opts.synopsis.zh || '(none)'}
${opts.synopsis.en || '(none)'}

Sampled windows: ${windowRanges || '(none)'}

Source-language subtitle evidence (timed):
${subtitleEvidence}

Directors-script sample:
${scriptSample}`,
            },
            ...stillParts,
          ],
        },
      ],
      timeoutMs: 60_000,
    });
    const verdict = parseAuditVerdict(text);
    const reason =
      text.match(/REASON:\s*([\s\S]*?)$/im)?.[1]?.trim() ?? '';
    if (!verdict) {
      return {
        status: 'failed',
        scope,
        detail: `unparseable auditor verdict: ${text.slice(0, 200)}`,
      };
    }
    if (verdict !== 'supported') {
      return {
        status: 'failed',
        verdict,
        scope,
        detail: `auditor verdict ${verdict}: ${reason.slice(0, 300)}`,
      };
    }
    return { status: 'ok', verdict, scope, detail: text.slice(0, 500) };
  } catch (err) {
    return {
      status: 'failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function generateDirectorsScript(opts: {
  videoPath: string;
  videoId: string;
  title: string;
  durationMs: number;
  workspace: DramaWorkspace;
  structure?: StructureInterval[];
  subtitlePaths?: string[];
  onProgress?: (msg: string) => void | Promise<void>;
}): Promise<DirectorsScriptResult> {
  const env = getDramaEnv();
  if (
    !env.DRAMA_EIS_CHAT_INFERENCE_ID.trim() &&
    !process.env.SUGGEST_AGENT_CONNECTOR_ID?.trim()
  ) {
    throw new DramaEisChatError(
      'config',
      'Set DRAMA_EIS_CHAT_INFERENCE_ID (EIS chat_completion) for directors_script',
    );
  }

  const scriptsDir = path.join(opts.workspace.rootDir, 'scripts');
  const partsDir = path.join(scriptsDir, 'directors_parts');
  const framesDir = path.join(opts.workspace.rootDir, 'frames');
  fs.mkdirSync(partsDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const subtitleEvidence: SubtitleEvidence = {};
  for (const lang of DRAMA_LANGUAGES) {
    const srt = opts.subtitlePaths?.find((p) => path.basename(p) === `${lang}.srt`);
    if (srt) subtitleEvidence[lang] = loadCues(srt);
  }

  const windows = planDirectorWindows({
    durationMs: opts.durationMs,
    structure: opts.structure,
    windowSec: env.DRAMA_DIRECTORS_WINDOW_SEC,
    maxWindows: env.DRAMA_DIRECTORS_MAX_WINDOWS,
  });
  if (windows.length === 0) {
    throw new Error('No directors windows planned for this duration');
  }

  const usageTotal = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    calls: 0,
  };
  const parts: string[] = [];
  let windowsSucceeded = 0;
  const windowErrors: string[] = [];
  const allStills: Array<{ sec: number; path: string }> = [];
  /** Successful window ranges (F5) — failed windows are gaps, not coverage. */
  const coverageRanges: Array<{ t0: number; t1: number }> = [];
  const coverageGaps: Array<{ t0: number; t1: number }> = [];

  for (let i = 0; i < windows.length; i++) {
    const { t0, t1 } = windows[i];
    await opts.onProgress?.(
      `Enrichment: directors window ${i + 1}/${windows.length} (${tc(t0)}–${tc(t1)})…`,
    );
    const stamps = sampleTimestamps(
      t0,
      t1,
      env.DRAMA_DIRECTORS_FRAMES_PER_WINDOW,
    );
    const stills: Array<{ sec: number; path: string }> = [];
    for (const sec of stamps) {
      const out = path.join(framesDir, `t_${String(sec).padStart(4, '0')}s.jpg`);
      try {
        if (!fs.existsSync(out)) {
          await extractStillAtSec({
            videoPath: opts.videoPath,
            sec,
            outPath: out,
          });
        }
        if (fs.existsSync(out)) stills.push({ sec, path: out });
      } catch {
        /* skip failed still */
      }
    }

    const windowEvidence: SubtitleEvidence = {};
    for (const lang of DRAMA_LANGUAGES) {
      if (subtitleEvidence[lang]) {
        windowEvidence[lang] = cuesInWindow(subtitleEvidence[lang], t0, t1);
      }
    }
    const content: EisChatContentPart[] = [
      {
        type: 'text',
        text: windowPrompt({
          title: opts.title,
          t0,
          t1,
          nFrames: stills.length,
          subtitleEvidence: windowEvidence,
        }),
      },
    ];
    for (const st of stills) {
      content.push({
        type: 'text',
        text: `Still [${tc(st.sec)}] (${st.sec}s):`,
      });
      content.push(imageDataUrlFromJpeg(fs.readFileSync(st.path)));
    }

    const partPath = path.join(
      partsDir,
      `part_${String(t0).padStart(4, '0')}_${String(t1).padStart(4, '0')}.md`,
    );
    try {
      const { text, usage } = await callDramaEisChat({
        messages: [{ role: 'user', content }],
      });
      usageTotal.prompt_tokens += Number(usage.prompt_tokens ?? 0);
      usageTotal.completion_tokens += Number(usage.completion_tokens ?? 0);
      usageTotal.total_tokens += Number(usage.total_tokens ?? 0);
      usageTotal.calls += 1;
      fs.writeFileSync(partPath, `${text.trim()}\n`, 'utf8');
      writeDramaJson(`${partPath}.usage.json`, { window: [t0, t1], usage });
      parts.push(text.trim());
      windowsSucceeded += 1;
      coverageRanges.push({ t0, t1 });
      allStills.push(...stills);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fallback = `\n\n> ERROR generating ${tc(t0)}–${tc(t1)}: ${msg}\n\n`;
      fs.writeFileSync(partPath, fallback, 'utf8');
      // Failed windows stay on disk for diagnosis but never enter the
      // published script/synopsis body.
      windowErrors.push(`${tc(t0)}–${tc(t1)}: ${msg}`);
      coverageGaps.push({ t0, t1 });
    }
  }

  if (windowsSucceeded === 0) {
    throw new Error(
      `directors_script: all ${windows.length} window(s) failed: ${windowErrors.join('; ').slice(0, 500)}`,
    );
  }

  let body = parts.join('\n\n');
  const renumbered = renumberScenes(body);
  body = renumbered.body;
  const { zh, en } = splitBilingualDirectorsDoc(body);

  const scriptRawPath = path.join(scriptsDir, 'directors_script_bilingual_raw.md');
  const scriptZhPath = path.join(scriptsDir, 'directors_script_zh.md');
  const scriptEnPath = path.join(scriptsDir, 'directors_script_en.md');

  const coverageStartSec = windows[0].t0;
  const coverageEndSec = windows[windows.length - 1].t1;
  // F5: only successful windows count as coverage; gaps are named.
  const coverageSec = coverageRanges.reduce(
    (sum, r) => sum + Math.max(0, r.t1 - r.t0),
    0,
  );
  const gapNote =
    coverageGaps.length > 0
      ? ` · gaps ${coverageGaps.map((g) => `${tc(g.t0)}–${tc(g.t1)}`).join(', ')}`
      : '';
  const durationSec = Math.max(1, Math.floor(opts.durationMs / 1000));
  const coverZh = `# 导演分场稿（采样） · ${opts.title}\n\n> Node EIS directors · sampled ${tc(coverageStartSec)}–${tc(coverageEndSec)} (${coverageSec}s of ${durationSec}s successful) · windows ok ${windowsSucceeded}/${windows.length} · scenes≈${renumbered.count}${gapNote}\n\n---\n\n`;
  const coverEn = `# Director's Script (sampled) · ${opts.title}\n\n> Node EIS directors · sampled ${tc(coverageStartSec)}–${tc(coverageEndSec)} (${coverageSec}s of ${durationSec}s successful) · windows ok ${windowsSucceeded}/${windows.length} · scenes≈${renumbered.count}${gapNote}\n\n---\n\n`;

  fs.writeFileSync(scriptRawPath, `${body}\n`, 'utf8');
  fs.writeFileSync(scriptZhPath, coverZh + zh, 'utf8');
  fs.writeFileSync(scriptEnPath, coverEn + en, 'utf8');
  // Explicit publication policy (F5): any run with ≥1 successful window
  // publishes the successful slices with gaps marked; all-error runs
  // throw above and publish nothing. The synopsis always derives from
  // successful slices only.
  writeDramaJson(path.join(scriptsDir, 'directors_usage.json'), {
    usage: usageTotal,
    publication: {
      policy: 'publish-successful-slices-with-gaps',
      windowsSucceeded,
      windowsPlanned: windows.length,
      coverageRanges,
      coverageGaps,
    },
  });

  await opts.onProgress?.('Enrichment: writing synopsis from directors script…');
  const synopsis = await summarizeScript({
    title: opts.title,
    bilingualBody: body,
  });

  const audit = await optionalAudit({
    sample: body,
    synopsis,
    subtitleEvidence,
    windows,
    stills: allStills,
  });
  writeDramaJson(path.join(scriptsDir, 'directors_audit.json'), audit ?? {});
  if (audit?.status === 'failed' && audit.verdict !== undefined) {
    // A negative auditor verdict vetoes publication: the script stays on
    // disk for review, but no synopsis becomes accepted metadata.
    throw new Error(
      `directors_script: auditor veto (${audit.verdict}): ${(audit.detail ?? '').slice(0, 300)}`,
    );
  }

  return {
    scriptZhPath,
    scriptEnPath,
    scriptRawPath,
    synopsisZh: synopsis.zh,
    synopsisEn: synopsis.en,
    sceneCount: renumbered.count,
    windowsDone: windowsSucceeded,
    windowsPlanned: windows.length,
    coverageStartSec,
    coverageEndSec,
    coverageSec,
    coverageRanges,
    coverageGaps,
    usageTotal,
    audit,
  };
}
