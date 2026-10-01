/**
 * P3 key_actors: frontal face *candidates* (plan/12).
 *
 * Honesty note (R6): this Node path does NOT implement the upstream
 * episode_processing face gates — no OpenCV face crop (whole stills are
 * sent), no role-window / costume / nearby-frame refinement / lookalike
 * audit. Cards therefore carry `verified: false` and are character-name
 * candidates (`role_zh`), never resolved performer `person_id`. Do not
 * publish them as upstream-equivalent verified actor cards until those
 * gates land and are checked against labeled frames.
 *
 * Pipeline:
 *   1. Role candidates come from the directors script SLUGLINE (ZH) blocks
 *      (characters explicitly in scenes), not from a hard-coded cast table.
 *   2. PROPOSE — extract stills across the body range (sampled), send each to
 *      an EIS multimodal chat model to identify the role + face quality
 *      (frontal, eyes open, costume sane). The proposed role MUST be one of
 *      the script candidates (whitelist); anything else is discarded.
 *   3. VERIFY — an independent audit model (must differ from propose) yes/no
 *      on the same still.
 *   4. COMMIT — cards passing propose + whitelist + frontal/eyes gates +
 *      verify are returned as *candidates* (`verified: false`, needs review).
 *
 * Thumbs are written under the drama workspace `faces/` and served via
 * /api/drama-media — never embedded in ES _source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDramaEnv } from './env';
import {
  callDramaEisChat,
  imageDataUrlFromJpeg,
  DramaEisChatError,
} from './eis-chat';
import { extractStillAtSec, sampleTimestamps } from './extract-stills';
import { extractJsonObject } from './json-extract';
import type { StructureInterval } from './structure';
import type { DramaWorkspace } from './workspace';
import { writeDramaJson } from './workspace';

export interface KeyActor {
  role_zh: string;
  role_en?: string;
  person_id?: string;
  thumb_path?: string;
  /**
   * Always false on this Node path: upstream face gates (crop,
   * role-window, costume, refinement, lookalike) are unimplemented, so no
   * card may claim upstream-equivalent verification (R6). `role_zh` is a
   * character name, never a resolved performer — `person_id` stays unset.
   */
  verified: boolean;
  t_ms?: number;
}

export interface ActorProposal {
  roleZh: string;
  roleEn?: string;
  sec: number;
  outPath: string;
  /** Model-reported frontal score (0–1); proposal gate only. */
  frontal: number;
  eyesOpen: boolean;
  reason?: string;
}

export interface ActorVerifyResult {
  roleZh: string;
  sec: number;
  outPath: string;
  ok: boolean;
  reason?: string;
}

/**
 * Extract role names from the directors script SLUGLINE (ZH) blocks.
 * Characters typically appear in a parenthetical — （甄嬛、雍正） or (Zhen
 * Huan, Yongzheng) — at the end of a location-first slugline. Falls back to
 * CJK tokens when no parenthetical is present, excluding common location /
 * time words. Returns unique roles in script order, capped.
 */
const SKIP_CJK = new Set([
  '内景',
  '外景',
  '日',
  '夜',
  '白天',
  '晚上',
  '镜头',
  '全景',
  '近景',
  '特写',
  '宫殿',
  '花园',
  '御花园',
  '房间',
  '室内',
  '室外',
  '场景',
  '长廊',
  '门口',
  '院子',
]);

function parseParenthetical(text: string): string[] {
  const m = text.match(/[（(]([^）)]*)[）)]/);
  if (!m) return [];
  const inner = m[1];
  return inner
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter((s) => /^[\u4e00-\u9fa5]{2,4}$/.test(s));
}

export function extractCastRoles(rawScript?: string, cap = 8): string[] {
  if (!rawScript) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of rawScript.split(/\r?\n/)) {
    const s = line.trim();
    const m = s.match(/^\*\*SLUGLINE \(ZH\):\*\*\s*(.*)$/i);
    if (!m) continue;
    const text = m[1].replace(/\*\*/g, '').trim();
    if (!text) continue;

    const roles = parseParenthetical(text);
    if (roles.length === 0) {
      // Fallback: CJK tokens that are not location/time words.
      for (const tok of text.match(/[\u4e00-\u9fa5]{2,4}/g) ?? []) {
        if (!SKIP_CJK.has(tok)) roles.push(tok);
      }
    }

    for (const role of roles) {
      if (!seen.has(role)) {
        seen.add(role);
        out.push(role);
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

/**
 * PROPOSE — send a face crop to the propose model and ask for a role + quality
 * verdict. Returns null when the model says "not a usable face".
 */
export async function proposeFace(opts: {
  roleCandidates: string[];
  sec: number;
  imageBytes: Buffer;
  title: string;
}): Promise<ActorProposal | null> {
  const env = getDramaEnv();
  const content = [
    {
      type: 'text' as const,
      text: `You are a casting assistant for "${opts.title}".
This is a single frame at ${opts.sec}s. Candidate roles present in this episode: ${opts.roleCandidates.join(' / ') || '(none listed)'}.

Return ONLY a JSON object:
{
  "role_zh": "exact candidate role this face belongs to, or null if it is not clearly any of them",
  "role_en": "optional English role name",
  "frontal": 0.0,
  "eyes_open": true,
  "face_present": true,
  "reason": "one short sentence"
}
Rules:
- face_present must be true for a usable frontal face.
- frontal 0..1 (>= 0.70 means good frontal).
- eyes_open false when eyes closed / blocked / averted.
- If the crop is a costume shot, group shot with no dominant face, or a
  partial/occluded face → face_present false, role_zh null.
- Never guess a role you are not confident about.`,
    },
    imageDataUrlFromJpeg(opts.imageBytes),
  ];

  const { text } = await callDramaEisChat({
    messages: [{ role: 'user', content }],
  });
  const parsed = extractJsonObject<{
    role_zh?: unknown;
    role_en?: unknown;
    frontal?: unknown;
    eyes_open?: unknown;
    face_present?: unknown;
    reason?: unknown;
  }>(text);
  if (!parsed) return null;

  const roleZh =
    typeof parsed.role_zh === 'string' && parsed.role_zh.trim()
      ? parsed.role_zh.trim()
      : null;
  if (!roleZh || parsed.face_present !== true) return null;
  // Role whitelist (R6): the model must pick exactly one of the script
  // candidates. Anything else — invented role, near-miss alias — is
  // discarded here, before any audit call is burned.
  if (!opts.roleCandidates.includes(roleZh)) return null;

  const frontal =
    typeof parsed.frontal === 'number' ? parsed.frontal : Number(parsed.frontal ?? 0);
  const eyesOpen = parsed.eyes_open === true;
  return {
    roleZh,
    roleEn: typeof parsed.role_en === 'string' ? parsed.role_en : undefined,
    sec: opts.sec,
    outPath: '', // filled by caller
    frontal: Number.isFinite(frontal) ? Math.min(1, Math.max(0, frontal)) : 0,
    eyesOpen,
    reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
  };
}

/**
 * VERIFY — independent model must say yes. Returns ok + reason.
 */
export async function verifyFace(opts: {
  roleZh: string;
  sec: number;
  imageBytes: Buffer;
  title: string;
  proposed: ActorProposal;
}): Promise<ActorVerifyResult> {
  const env = getDramaEnv();
  const content = [
    {
      type: 'text' as const,
      text: `You are an independent auditor for "${opts.title}".
A first model claimed this frame (${opts.sec}s) shows the role "${opts.roleZh}" with frontal=${opts.proposed.frontal.toFixed(2)}, eyes_open=${opts.proposed.eyesOpen ? 'yes' : 'no'}.

Reply ONLY with JSON:
{
  "ok": true,
  "reason": "one short sentence"
}
ok=true only if: the dominant face clearly matches ${opts.roleZh}, is frontal, eyes open, and the crop is good enough to publish as a key-actor thumbnail. Reject costume-only shots, closed eyes, heavy motion blur, or a different person.`,
    },
    imageDataUrlFromJpeg(opts.imageBytes),
  ];

  const { text } = await callDramaEisChat({
    inferenceId: env.DRAMA_EIS_AUDIT_INFERENCE_ID.trim() || undefined,
    messages: [{ role: 'user', content }],
  });
  const parsed = extractJsonObject<{ ok?: unknown; reason?: unknown }>(text);
  return {
    roleZh: opts.roleZh,
    sec: opts.sec,
    outPath: '',
    ok: parsed?.ok === true,
    reason:
      typeof parsed?.reason === 'string' ? parsed.reason : text.slice(0, 200),
  };
}

export interface KeyActorsResult {
  actors: KeyActor[];
  facesDir: string;
  proposalsPath: string;
  verifyPath: string;
}

/**
 * Full P3 key_actors run: sample stills across the body range, propose,
 * verify with an independent model, return review-state candidates only
 * (`verified: false`; R6).
 *
 * Requires both DRAMA_EIS_CHAT_INFERENCE_ID (propose) and
 * DRAMA_EIS_AUDIT_INFERENCE_ID (verify, different id) to be set; otherwise it
 * throws a config error (the runner records it as a module failure).
 */
export async function generateKeyActors(opts: {
  videoPath: string;
  title: string;
  workspace: DramaWorkspace;
  rawScript?: string;
  structure?: StructureInterval[];
  durationMs: number;
  onProgress?: (msg: string) => void | Promise<void>;
}): Promise<KeyActorsResult> {
  const env = getDramaEnv();
  const propose = env.DRAMA_EIS_CHAT_INFERENCE_ID.trim();
  const audit = env.DRAMA_EIS_AUDIT_INFERENCE_ID.trim();
  if (!propose) {
    throw new DramaEisChatError(
      'config',
      'Set DRAMA_EIS_CHAT_INFERENCE_ID for key_actors propose',
    );
  }
  if (!audit) {
    throw new DramaEisChatError(
      'config',
      'Set DRAMA_EIS_AUDIT_INFERENCE_ID (different from propose) for key_actors verify',
    );
  }
  if (audit === propose) {
    throw new DramaEisChatError(
      'config',
      'key_actors audit inference id must differ from propose id',
    );
  }

  const roles = extractCastRoles(opts.rawScript, env.DRAMA_KEY_ACTORS_MAX * 2);
  if (roles.length === 0) {
    throw new Error('No cast roles found in directors script SLUGLINE (ZH) blocks');
  }

  const body = opts.structure?.find((s) => s.kind === 'body');
  const durationSec = Math.max(1, Math.floor(opts.durationMs / 1000));
  const a = body ? Math.floor(body.start_ms / 1000) : 0;
  const b = body
    ? Math.min(Math.floor(body.end_ms / 1000), durationSec)
    : durationSec;
  const stamps = sampleTimestamps(a, b, env.DRAMA_KEY_ACTORS_STILLS);

  const facesDir = path.join(opts.workspace.rootDir, 'faces');
  fs.mkdirSync(facesDir, { recursive: true });
  const proposals: ActorProposal[] = [];
  const verifyResults: ActorVerifyResult[] = [];

  // One card per role — the first verified pass wins.
  const claimed = new Map<string, KeyActor>();
  const minFrontal = env.DRAMA_KEY_ACTORS_MIN_FRONTAL;

  for (let i = 0; i < stamps.length; i++) {
    const sec = stamps[i];
    await opts.onProgress?.(
      `Enrichment: key actors still ${i + 1}/${stamps.length} (${sec}s)…`,
    );
    const outPath = path.join(
      facesDir,
      `cand_${String(sec).padStart(5, '0')}s.jpg`,
    );
    try {
      if (!fs.existsSync(outPath)) {
        await extractStillAtSec({
          videoPath: opts.videoPath,
          sec,
          outPath,
          maxLongEdge: 320,
        });
      }
      if (!fs.existsSync(outPath)) continue;
      const bytes = fs.readFileSync(outPath);

      const proposal = await proposeFace({
        roleCandidates: roles,
        sec,
        imageBytes: bytes,
        title: opts.title,
      });
      if (!proposal) {
        proposals.push({
          roleZh: '',
          sec,
          outPath,
          frontal: 0,
          eyesOpen: false,
          reason: 'propose: no usable face',
        });
        continue;
      }
      proposal.outPath = outPath;
      proposals.push(proposal);

      // Hard gates before burning an audit call.
      if (proposal.frontal < minFrontal || !proposal.eyesOpen) {
        verifyResults.push({
          roleZh: proposal.roleZh,
          sec,
          outPath,
          ok: false,
          reason: `P1 gate fail: frontal=${proposal.frontal.toFixed(2)}, eyes_open=${proposal.eyesOpen}`,
        });
        continue;
      }
      if (claimed.has(proposal.roleZh)) {
        verifyResults.push({
          roleZh: proposal.roleZh,
          sec,
          outPath,
          ok: false,
          reason: 'role already verified',
        });
        continue;
      }

      const verify = await verifyFace({
        roleZh: proposal.roleZh,
        sec,
        imageBytes: bytes,
        title: opts.title,
        proposed: proposal,
      });
      verify.outPath = outPath;
      verifyResults.push(verify);
      if (!verify.ok) continue;

      // Publish candidate card — relative thumb_path under run root.
      // verified stays false (R6): upstream gates unimplemented; this is a
      // character-name candidate for review, not a verified performer card.
      const thumbRel = path.relative(opts.workspace.rootDir, outPath);
      claimed.set(proposal.roleZh, {
        role_zh: proposal.roleZh,
        role_en: proposal.roleEn,
        thumb_path: thumbRel,
        verified: false,
        t_ms: Math.round(sec * 1000),
      });
      await opts.onProgress?.(
        `Enrichment: key actor candidate "${proposal.roleZh}" @ ${sec}s (needs review)`,
      );
      if (claimed.size >= env.DRAMA_KEY_ACTORS_MAX) break;
    } catch (err) {
      verifyResults.push({
        roleZh: '',
        sec,
        outPath,
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const actors = [...claimed.values()];
  const proposalsPath = path.join(facesDir, 'proposals.json');
  const verifyPath = path.join(facesDir, 'verify_log.json');
  writeDramaJson(proposalsPath, proposals);
  writeDramaJson(verifyPath, verifyResults);

  // F6: an empty result is not accepted key content — fail the module so
  // the run reports partial/failed instead of a hollow success.
  if (actors.length === 0) {
    throw new Error(
      'key_actors: no reviewable face candidates (all proposals failed role/frontal/eyes gates or verify)',
    );
  }

  return { actors, facesDir, proposalsPath, verifyPath };
}
