import { describe, expect, it } from 'vitest';
import { parseSrt, serializeSrt } from './srt';

describe('parseSrt / serializeSrt', () => {
  it('parses standard SRT blocks', () => {
    const raw = `1
00:00:01,000 --> 00:00:02,500
Hello

2
00:00:03,000 --> 00:00:04,000
世界
`;
    const cues = parseSrt(raw);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      startMs: 1000,
      endMs: 2500,
      text: 'Hello',
    });
    expect(cues[1].text).toBe('世界');
  });

  it('round-trips via serialize', () => {
    const cues = parseSrt(`1
00:00:00,000 --> 00:00:01,000
A
`);
    const again = parseSrt(serializeSrt(cues));
    expect(again[0].text).toBe('A');
    expect(again[0].startMs).toBe(0);
    expect(again[0].endMs).toBe(1000);
  });

  it('strips simple HTML tags', () => {
    const cues = parseSrt(`1
00:00:00,000 --> 00:00:01,000
<i>Hi</i>
`);
    expect(cues[0].text).toBe('Hi');
  });
});
