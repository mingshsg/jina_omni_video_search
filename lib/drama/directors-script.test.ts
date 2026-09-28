import { describe, expect, it } from 'vitest';
import {
  renumberScenes,
  splitBilingualDirectorsDoc,
} from './bilingual-split';
import { planDirectorWindows } from './directors-script';

describe('splitBilingualDirectorsDoc', () => {
  it('routes ZH/EN labeled sections', () => {
    const raw = `## SCENE 1 · 00:00:00–00:01:00

**SLUGLINE (ZH):** 内景。宫殿 — 日
**SLUGLINE (EN):** INT. PALACE — DAY

**DIALOGUE (ZH):**
- [00:00:10] 你好
**DIALOGUE (EN):**
- [00:00:10] Hello
`;
    const { zh, en } = splitBilingualDirectorsDoc(raw);
    expect(zh).toContain('宫殿');
    expect(zh).toContain('你好');
    expect(zh).not.toContain('Hello');
    expect(en).toContain('PALACE');
    expect(en).toContain('Hello');
    expect(en).not.toContain('你好');
  });
});

describe('renumberScenes', () => {
  it('flattens local scene numbers', () => {
    const { body, count } = renumberScenes(
      `## SCENE 1 · 00:00:00–00:01:00\n\nx\n\n## SCENE 1 · 00:01:00–00:02:00\n\ny\n`,
    );
    expect(count).toBe(2);
    expect(body).toContain('## SCENE 1 ·');
    expect(body).toContain('## SCENE 2 ·');
  });
});

describe('planDirectorWindows', () => {
  it('caps windows and prefers body range', () => {
    const windows = planDirectorWindows({
      durationMs: 45 * 60_000,
      windowSec: 120,
      maxWindows: 3,
      structure: [
        {
          kind: 'opening_credits',
          start_ms: 0,
          end_ms: 60_000,
          confidence: 0.5,
          source: 'heuristic',
        },
        {
          kind: 'body',
          start_ms: 60_000,
          end_ms: 40 * 60_000,
          confidence: 0.5,
          source: 'heuristic',
        },
        {
          kind: 'ending_credits',
          start_ms: 40 * 60_000,
          end_ms: 45 * 60_000,
          confidence: 0.5,
          source: 'heuristic',
        },
      ],
    });
    expect(windows).toHaveLength(3);
    expect(windows[0].t0).toBe(60);
    expect(windows[0].t1 - windows[0].t0).toBe(120);
  });
});
