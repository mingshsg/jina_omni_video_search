import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { copyRetryHostSubtitles, type DramaWorkspace } from './workspace';
it('copies host transcripts into a new generation without overwriting prior artifacts', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jve-host-retry-'));
  const old = path.join(base, 'oldrun', 'subtitles');
  const newRoot = path.join(base, 'newrun'); const subtitlesDir = path.join(newRoot, 'subtitles');
  fs.mkdirSync(old, { recursive: true }); fs.mkdirSync(subtitlesDir, { recursive: true });
  fs.writeFileSync(path.join(old, 'host_en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
  fs.writeFileSync(path.join(old, 'en.srt'), 'old published output');
  const ws: DramaWorkspace = { runId: 'newrun', rootDir: newRoot, subtitlesDir, audioDir: '', metaPath: '', structurePath: '' };
  copyRetryHostSubtitles('oldrun', ws);
  expect(fs.readFileSync(path.join(subtitlesDir, 'host_en.srt'), 'utf8')).toContain('Hello');
  expect(fs.readFileSync(path.join(old, 'en.srt'), 'utf8')).toBe('old published output');
  expect(fs.existsSync(path.join(subtitlesDir, 'en.srt'))).toBe(false);
  expect(() => copyRetryHostSubtitles('oldrun', ws)).toThrow(); // never overwrite a new host edit
});
