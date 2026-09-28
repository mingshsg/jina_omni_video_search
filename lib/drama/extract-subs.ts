/**
 * Pull embedded softsubs (if any) and companion sidecar SRT files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from '../video/run-ffmpeg';
import type { DramaLanguage } from '../ingest/drama-options';

/** Look for `<stem>.<lang>.srt` (or `_` / `-` suffix) next to the media file. */
export function findSidecarSrt(
  videoPath: string,
  lang: DramaLanguage,
): string | undefined {
  const dir = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath));
  const candidates = [
    path.join(dir, `${stem}.${lang}.srt`),
    path.join(dir, `${stem}_${lang}.srt`),
    path.join(dir, `${stem}-${lang}.srt`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return undefined;
}

export interface SubtitleStreamInfo {
  /** Position among subtitle streams (for `-map 0:s:<n>`). */
  subIndex: number;
  langTag?: string;
  codec?: string;
  title?: string;
}

/** List embedded subtitle streams with their language tags (R8). */
export async function listSubtitleStreams(
  videoPath: string,
): Promise<SubtitleStreamInfo[]> {
  try {
    const { stdout } = await runFfmpeg('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-select_streams',
      's',
      videoPath,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        codec_name?: string;
        tags?: { language?: string; title?: string };
      }>;
    };
    return (parsed.streams ?? []).map((s, i) => ({
      subIndex: i,
      langTag: s.tags?.language,
      codec: s.codec_name,
      title: s.tags?.title,
    }));
  } catch {
    return [];
  }
}

function subtitleTagMatches(
  tag: string | undefined,
  lang: DramaLanguage,
): boolean {
  if (!tag) return false;
  const t = tag.trim().toLowerCase();
  if (lang === 'zh') {
    return (
      t.startsWith('zh') || t === 'chi' || t === 'zho' || t.includes('chinese')
    );
  }
  if (lang === 'en') {
    return t.startsWith('en') || t === 'eng' || t.includes('english');
  }
  if (lang === 'ko') {
    return t === 'ko' || t.startsWith('ko-') || t.startsWith('ko_') ||
      t === 'kor' || t.includes('korean');
  }
  return t === 'th' || t.startsWith('th-') || t.startsWith('th_') ||
    t === 'tha' || t.includes('thai');
}

/**
 * Extract the embedded subtitle stream whose language tag matches `lang`.
 * Never falls back to an untagged / mismatched stream: assigning the first
 * stream to the first requested language mislabels content (R8). Returns
 * null when no stream matches (caller falls through to ASR or errors).
 */
export async function extractEmbeddedSrtForLanguage(opts: {
  videoPath: string;
  lang: DramaLanguage;
  outSrtPath: string;
}): Promise<{ stream: SubtitleStreamInfo } | null> {
  const streams = await listSubtitleStreams(opts.videoPath);
  const match = streams.find((s) => subtitleTagMatches(s.langTag, opts.lang));
  if (!match) return null;
  try {
    await runFfmpeg('ffmpeg', [
      '-y',
      '-i',
      opts.videoPath,
      '-map',
      `0:s:${match.subIndex}`,
      '-f',
      'srt',
      opts.outSrtPath,
    ]);
    if (fs.existsSync(opts.outSrtPath) && fs.statSync(opts.outSrtPath).size > 0) {
      return { stream: match };
    }
    return null;
  } catch {
    try {
      if (fs.existsSync(opts.outSrtPath)) fs.unlinkSync(opts.outSrtPath);
    } catch {
      /* ignore */
    }
    return null;
  }
}
