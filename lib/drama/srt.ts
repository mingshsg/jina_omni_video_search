/**
 * Minimal SRT parse/serialize for drama subtitle indexing.
 */

export interface SrtCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

function parseTimestamp(raw: string): number {
  // 00:01:02,345 or 00:01:02.345
  const m = raw
    .trim()
    .replace('.', ',')
    .match(/^(\d{1,2}):(\d{2}):(\d{2}),(\d{1,3})$/);
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = Number(m[4].padEnd(3, '0').slice(0, 3));
  return ((h * 60 + min) * 60 + sec) * 1000 + ms;
}

function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const rem = total % 3_600_000;
  const min = Math.floor(rem / 60_000);
  const rem2 = rem % 60_000;
  const sec = Math.floor(rem2 / 1000);
  const millis = rem2 % 1000;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/** Parse SRT body into cues (skips malformed blocks). */
export function parseSrt(content: string): SrtCue[] {
  const blocks = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;
    let idxLine = 0;
    let index = cues.length + 1;
    if (/^\d+$/.test(lines[0].trim())) {
      index = Number(lines[0].trim());
      idxLine = 1;
    }
    const timing = lines[idxLine]?.trim() ?? '';
    const tm = timing.match(
      /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/,
    );
    if (!tm) continue;
    const text = lines
      .slice(idxLine + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) continue;
    const startMs = parseTimestamp(tm[1]);
    const endMs = parseTimestamp(tm[2]);
    if (endMs <= startMs) continue;
    cues.push({ index, startMs, endMs, text });
  }
  return cues;
}

export function serializeSrt(cues: SrtCue[]): string {
  return (
    cues
      .map(
        (c, i) =>
          `${c.index || i + 1}\n${formatTimestamp(c.startMs)} --> ${formatTimestamp(c.endMs)}\n${c.text}\n`,
      )
      .join('\n') + '\n'
  );
}
