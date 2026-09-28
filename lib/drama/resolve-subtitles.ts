/**
 * Resolve SRT for one language: sidecar → embedded → optional ASR.
 * Per-run policy (P4) controls which sources are allowed:
 * - `existing_only`: sidecar → embedded only; never ASR.
 * - `force_asr`: skip sidecar/embedded; ASR only.
 * - `auto` (default): sidecar → embedded → ASR.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  DramaLanguage,
  DramaSubtitleSource,
} from '../ingest/drama-options';
import { getDramaEnv } from './env';
import { extractDramaAudio } from './extract-audio';
import { extractEmbeddedSrtForLanguage, findSidecarSrt } from './extract-subs';
import {
  transcribeWithOpenAiCompatible,
  transcribeWithWhisperCli,
  writeCuesToSrt,
} from './asr';
import { parseSrt, type SrtCue } from './srt';

export type SubtitleOrigin =
  | 'sidecar'
  | 'embedded'
  | 'openai'
  | 'whisper_cli';

export interface ResolvedSubtitles {
  lang: DramaLanguage;
  srtPath: string;
  cues: SrtCue[];
  origin: SubtitleOrigin;
}

async function tryAsr(opts: {
  videoPath: string;
  lang: DramaLanguage;
  audioDir: string;
  outSrtPath: string;
}): Promise<ResolvedSubtitles | null> {
  const env = getDramaEnv();
  const provider = env.DRAMA_ASR_PROVIDER;
  if (provider === 'off') return null;

  const audioPath = path.join(opts.audioDir, `asr_${opts.lang}.mp3`);
  if (!fs.existsSync(audioPath)) {
    await extractDramaAudio({
      videoPath: opts.videoPath,
      outMp3Path: audioPath,
    });
  }

  const tryOpenAi =
    provider === 'openai' ||
    (provider === 'auto' &&
      Boolean(
        env.DRAMA_ASR_API_KEY.trim() || process.env.OPENAI_API_KEY?.trim(),
      ));
  const tryCli =
    provider === 'whisper_cli' ||
    (provider === 'auto' && Boolean(env.DRAMA_WHISPER_BIN.trim()));

  if (tryOpenAi) {
    const { cues, source } = await transcribeWithOpenAiCompatible({
      audioPath,
      lang: opts.lang,
    });
    writeCuesToSrt(cues, opts.outSrtPath);
    return {
      lang: opts.lang,
      srtPath: opts.outSrtPath,
      cues,
      origin: source,
    };
  }

  if (tryCli) {
    const { cues, source, srtPath } = await transcribeWithWhisperCli({
      audioPath,
      lang: opts.lang,
      outDir: path.dirname(opts.outSrtPath),
    });
    if (srtPath !== opts.outSrtPath) {
      fs.copyFileSync(srtPath, opts.outSrtPath);
    }
    return {
      lang: opts.lang,
      srtPath: opts.outSrtPath,
      cues,
      origin: source,
    };
  }

  return null;
}

export async function resolveSubtitlesForLanguage(opts: {
  videoPath: string;
  lang: DramaLanguage;
  subtitlesDir: string;
  audioDir: string;
  /** Kept for callers that probe embedded availability per language. */
  allowEmbedded?: boolean;
  /** Per-run subtitle policy (P4); `auto` when omitted. */
  subtitleSource?: DramaSubtitleSource;
}): Promise<ResolvedSubtitles> {
  const outSrtPath = path.join(opts.subtitlesDir, `${opts.lang}.srt`);
  const source = opts.subtitleSource ?? 'auto';

  if (source !== 'force_asr') {
    const sidecar = findSidecarSrt(opts.videoPath, opts.lang);
    if (sidecar) {
      fs.copyFileSync(sidecar, outSrtPath);
      const cues = parseSrt(fs.readFileSync(outSrtPath, 'utf8'));
      if (cues.length > 0) {
        return {
          lang: opts.lang,
          srtPath: outSrtPath,
          cues,
          origin: 'sidecar',
        };
      }
    }

    if (opts.allowEmbedded !== false) {
      // R8: only a stream whose language tag matches `lang` may be used.
      // An untagged/mismatched first stream is never assigned to the
      // requested language — fall through to ASR or the error below.
      const embedded = await extractEmbeddedSrtForLanguage({
        videoPath: opts.videoPath,
        lang: opts.lang,
        outSrtPath,
      });
      if (embedded) {
        const cues = parseSrt(fs.readFileSync(outSrtPath, 'utf8'));
        if (cues.length > 0) {
          return {
            lang: opts.lang,
            srtPath: outSrtPath,
            cues,
            origin: 'embedded',
          };
        }
      }
    }
  }

  if (source !== 'existing_only') {
    const asr = await tryAsr({
      videoPath: opts.videoPath,
      lang: opts.lang,
      audioDir: opts.audioDir,
      outSrtPath,
    });
    if (asr) return asr;
  }

  throw new Error(
    source === 'existing_only'
      ? `No subtitles for ${opts.lang}: no matching sidecar or embedded stream (existing_only — ASR skipped)`
      : source === 'force_asr'
        ? `No subtitles for ${opts.lang}: ASR is not configured or failed (force_asr — sidecar/embedded skipped; set DRAMA_ASR_API_KEY or DRAMA_WHISPER_BIN)`
        : `No subtitles for ${opts.lang}: no sidecar/embedded stream, and ASR is not configured (set DRAMA_ASR_API_KEY or DRAMA_WHISPER_BIN)`,
  );
}
