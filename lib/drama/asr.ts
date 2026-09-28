/**
 * Optional ASR backends for drama subtitles (Node — no Python required).
 *
 * Priority is decided by the caller (sidecar → embedded → ASR).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getDramaEnv } from './env';
import type { DramaLanguage } from '../ingest/drama-options';
import { serializeSrt, type SrtCue } from './srt';

export type AsrSource = 'openai' | 'whisper_cli';

function langToWhisper(lang: DramaLanguage): string {
  // All supported options are Whisper language codes. Do not silently
  // transcribe Korean or Thai audio as English.
  return lang;
}

/**
 * OpenAI-compatible transcriptions API → SRT cues.
 * Uses DRAMA_ASR_API_KEY / OPENAI_API_KEY and optional DRAMA_ASR_API_URL.
 */
export async function transcribeWithOpenAiCompatible(opts: {
  audioPath: string;
  lang: DramaLanguage;
}): Promise<{ cues: SrtCue[]; source: AsrSource }> {
  const env = getDramaEnv();
  const apiKey =
    env.DRAMA_ASR_API_KEY.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    '';
  if (!apiKey) {
    throw new Error('DRAMA_ASR_API_KEY (or OPENAI_API_KEY) is not set');
  }
  const url =
    env.DRAMA_ASR_API_URL.trim() ||
    'https://api.openai.com/v1/audio/transcriptions';
  const form = new FormData();
  const bytes = fs.readFileSync(opts.audioPath);
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }),
    path.basename(opts.audioPath),
  );
  form.append('model', env.DRAMA_ASR_MODEL.trim() || 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('language', langToWhisper(opts.lang));
  if (opts.lang === 'en') {
    form.append('prompt', 'Transcribe dialogue and notable sound effects.');
  } else if (opts.lang === 'zh') {
    form.append(
      'prompt',
      '转写对白与明显音效；非语言声音可用方括号标注。',
    );
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `ASR HTTP ${res.status}: ${body.slice(0, 300) || res.statusText}`,
    );
  }
  const json = (await res.json()) as {
    segments?: Array<{ start?: number; end?: number; text?: string }>;
    text?: string;
  };
  const cues: SrtCue[] = [];
  if (Array.isArray(json.segments) && json.segments.length > 0) {
    let i = 1;
    for (const seg of json.segments) {
      const text = String(seg.text ?? '').trim();
      if (!text) continue;
      const startMs = Math.round(Number(seg.start ?? 0) * 1000);
      const endMs = Math.round(Number(seg.end ?? 0) * 1000);
      if (!(endMs > startMs)) continue;
      cues.push({ index: i++, startMs, endMs, text });
    }
  } else if (json.text?.trim()) {
    // R8: never manufacture a precise timestamp for untimed text — a
    // 0–1000ms cue would misdirect search hits to the start of the video
    // for dialogue that could occur anywhere. Refuse and let the caller
    // surface a clear error (or add an explicit alignment stage later).
    throw new Error(
      'ASR returned text without timed segments; cannot build timed subtitles from it',
    );
  }
  if (cues.length === 0) {
    throw new Error('ASR returned no segments');
  }
  return { cues, source: 'openai' };
}

/** Run local whisper CLI if DRAMA_WHISPER_BIN is set. */
export async function transcribeWithWhisperCli(opts: {
  audioPath: string;
  lang: DramaLanguage;
  outDir: string;
}): Promise<{ cues: SrtCue[]; source: AsrSource; srtPath: string }> {
  const env = getDramaEnv();
  const bin = env.DRAMA_WHISPER_BIN.trim();
  if (!bin) {
    throw new Error('DRAMA_WHISPER_BIN is not set');
  }
  const stem = path.basename(opts.audioPath, path.extname(opts.audioPath));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      bin,
      [
        opts.audioPath,
        '--language',
        langToWhisper(opts.lang),
        '--task',
        'transcribe',
        '--output_format',
        'srt',
        '--output_dir',
        opts.outDir,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `whisper CLI exited ${code}: ${stderr.slice(-500) || 'no stderr'}`,
          ),
        );
    });
  });
  const srtPath = path.join(opts.outDir, `${stem}.srt`);
  if (!fs.existsSync(srtPath)) {
    throw new Error(`whisper CLI did not write ${srtPath}`);
  }
  const { parseSrt } = await import('./srt');
  const cues = parseSrt(fs.readFileSync(srtPath, 'utf8'));
  if (cues.length === 0) {
    throw new Error('whisper CLI SRT was empty');
  }
  return { cues, source: 'whisper_cli', srtPath };
}

export function writeCuesToSrt(cues: SrtCue[], outPath: string): void {
  fs.writeFileSync(outPath, serializeSrt(cues), 'utf8');
}
