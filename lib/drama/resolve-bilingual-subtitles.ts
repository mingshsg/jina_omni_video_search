/** Resolve EN/ZH originals first, then translate only a missing language. */
import path from 'node:path';
import type { DramaSubtitleSource } from '../ingest/drama-options';
import { writeCuesToSrt } from './asr';
import {
  NoSubtitlesError,
  resolveSubtitlesForLanguage,
  type ResolvedSubtitles,
} from './resolve-subtitles';
import { translateSubtitleCues } from './translate-subtitles';

export async function resolveEnglishChineseSubtitles(opts: {
  videoPath: string;
  subtitlesDir: string;
  audioDir: string;
  subtitleSource?: DramaSubtitleSource;
  sourceLanguage?: 'en' | 'zh';
}): Promise<{
  resolved: Partial<Record<'en' | 'zh', ResolvedSubtitles>>;
  errors: Partial<Record<'en' | 'zh', Error>>;
}> {
  const found: Partial<Record<'en' | 'zh', ResolvedSubtitles>> = {};
  const errors: Partial<Record<'en' | 'zh', Error>> = {};
  for (const lang of ['en', 'zh'] as const) {
    try {
      found[lang] = await resolveSubtitlesForLanguage({
        ...opts,
        lang,
        allowConfiguredAsr: false,
      });
    } catch (err) {
      if (!(err instanceof NoSubtitlesError)) {
        errors[lang] = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  if (!found.en && !found.zh) {
    if (opts.sourceLanguage && opts.subtitleSource !== 'existing_only') {
      try {
        found[opts.sourceLanguage] = await resolveSubtitlesForLanguage({
          ...opts,
          lang: opts.sourceLanguage,
        });
      } catch (err) {
        errors[opts.sourceLanguage] = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (!found.en && !found.zh) {
      const missing = new Error(
        opts.subtitleSource === 'existing_only'
          ? 'No timed English or Chinese sidecar or embedded subtitle was found. Existing-only skips host transcripts and ASR; retry with Auto and the spoken language, or supply a matching timed subtitle file.'
          : 'No timed English or Chinese source subtitle was found. Supply a matching sidecar, embedded subtitle, or host transcript; configured ASR needs an explicit spoken language.',
      );
      return { resolved: found, errors: { en: errors.en ?? missing, zh: errors.zh ?? missing } };
    }
  }
  if (found.en && found.zh) return { resolved: found, errors };

  const from = found.en ? 'en' : 'zh';
  const to = from === 'en' ? 'zh' : 'en';
  const source = found[from]!;
  if (!errors[to]) {
    try {
      const cues = await translateSubtitleCues({ cues: source.cues, from, to });
      const srtPath = path.join(opts.subtitlesDir, `${to}.srt`);
      writeCuesToSrt(cues, srtPath);
      found[to] = { lang: to, srtPath, cues, origin: `translated_${from}` };
    } catch (err) {
      errors[to] = err instanceof Error ? err : new Error(String(err));
    }
  }
  return { resolved: found, errors };
}
