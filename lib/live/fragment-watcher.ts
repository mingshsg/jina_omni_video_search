import fs from 'node:fs';
import path from 'node:path';
import {
  parseHlsMediaPlaylist,
  type PlaylistSegment,
} from './fragment-capture';

export interface WatchedFragment {
  sequence_no: number;
  absolutePath: string;
  durationSec: number;
  programDateTime?: string;
  discovered_at: string;
}

/**
 * Poll HLS playlist for newly finalized segments (temp_file rename complete).
 * Ignores `*.tmp` files — only playlist entries count as published.
 */
export class HlsFragmentWatcher {
  private seen = new Set<string>();
  private sequence = 0;

  constructor(
    private readonly playlistPath: string,
    private readonly fragmentDir: string,
  ) {}

  poll(): WatchedFragment[] {
    if (!fs.existsSync(this.playlistPath)) return [];
    const text = fs.readFileSync(this.playlistPath, 'utf8');
    const segs = parseHlsMediaPlaylist(text);
    const newly: WatchedFragment[] = [];
    for (const seg of segs) {
      if (this.seen.has(seg.uri)) continue;
      const absolutePath = path.resolve(this.fragmentDir, path.basename(seg.uri));
      if (!fs.existsSync(absolutePath)) continue;
      if (fs.existsSync(`${absolutePath}.tmp`)) continue;
      this.seen.add(seg.uri);
      newly.push({
        sequence_no: this.sequence++,
        absolutePath,
        durationSec: seg.durationSec,
        programDateTime: seg.programDateTime,
        discovered_at: new Date().toISOString(),
      });
    }
    return newly;
  }

  /** Test helper: expose whether a path looks like an in-flight temp write. */
  static isTempPublishPath(filePath: string): boolean {
    return filePath.endsWith('.tmp');
  }

  reset(): void {
    this.seen.clear();
    this.sequence = 0;
  }
}

export type { PlaylistSegment };
