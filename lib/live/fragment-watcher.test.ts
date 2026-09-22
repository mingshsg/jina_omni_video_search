import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HlsFragmentWatcher } from './fragment-watcher';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('HlsFragmentWatcher', () => {
  it('never treats .tmp or unlisted files as finalized', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-watch-'));
    tmpDirs.push(dir);
    const playlist = path.join(dir, 'live.m3u8');
    // Incomplete write present but NOT in playlist yet
    fs.writeFileSync(path.join(dir, 'frag_000000.ts.tmp'), Buffer.from('partial'));
    fs.writeFileSync(
      playlist,
      '#EXTM3U\n#EXT-X-VERSION:3\n',
      'utf8',
    );
    const watcher = new HlsFragmentWatcher(playlist, dir);
    expect(watcher.poll()).toEqual([]);

    // Atomic publish: rename semantics — final file present, .tmp gone, playlist entry
    fs.writeFileSync(path.join(dir, 'frag_000000.ts'), Buffer.from('complete'));
    fs.unlinkSync(path.join(dir, 'frag_000000.ts.tmp'));
    fs.writeFileSync(
      playlist,
      '#EXTM3U\n#EXTINF:2.000,\nfrag_000000.ts\n',
      'utf8',
    );
    const got = watcher.poll();
    expect(got).toHaveLength(1);
    expect(got[0]!.absolutePath.endsWith('frag_000000.ts')).toBe(true);
    expect(HlsFragmentWatcher.isTempPublishPath(got[0]!.absolutePath)).toBe(
      false,
    );
  });

  it('accumulates beyond sliding playlist window (hls_list_size)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls-slide-'));
    tmpDirs.push(dir);
    const playlist = path.join(dir, 'live.m3u8');
    const watcher = new HlsFragmentWatcher(playlist, dir);
    const seen: string[] = [];

    for (let i = 0; i < 12; i++) {
      const name = `frag_${String(i).padStart(6, '0')}.ts`;
      fs.writeFileSync(path.join(dir, name), Buffer.from(`seg-${i}`));
      // Sliding window of 8 entries — older URIs leave the playlist.
      const start = Math.max(0, i - 7);
      const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
      for (let j = start; j <= i; j++) {
        lines.push('#EXTINF:2.000,');
        lines.push(`frag_${String(j).padStart(6, '0')}.ts`);
      }
      fs.writeFileSync(playlist, `${lines.join('\n')}\n`, 'utf8');
      for (const frag of watcher.poll()) {
        seen.push(path.basename(frag.absolutePath));
      }
    }

    expect(seen).toHaveLength(12);
    expect(seen[0]).toBe('frag_000000.ts');
    expect(seen[11]).toBe('frag_000011.ts');
  });
});
