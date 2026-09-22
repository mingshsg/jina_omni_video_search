import { describe, expect, it } from 'vitest';
import {
  assembleWindowsFromFragments,
  computeWindowEndAt,
  shouldOpenNewEpoch,
  FRAGMENTS_PER_WINDOW,
  FRAGMENT_STEP,
  type FinalizedFragment,
} from './window-assembler';

function frag(
  seq: number,
  overrides: Partial<FinalizedFragment> = {},
): FinalizedFragment {
  const start = seq * 2000;
  return {
    stream_epoch: 1,
    sequence_no: seq,
    start_pts_ms: start,
    end_pts_ms: start + 2000,
    media_signature: 'sigA',
    finalized_at: new Date(Date.UTC(2026, 8, 10, 0, 0, seq * 2)).toISOString(),
    path: `/spool/frag_${String(seq).padStart(6, '0')}.ts`,
    media_sha256: `sha256:${seq}`,
    ...overrides,
  };
}

describe('window assembler', () => {
  it('emits 4-fragment windows with 3-fragment step and no duplicate sequences as ends', () => {
    // Need sequences 0..150 for 50 windows ending at 3,6,...,150
    const fragments = Array.from({ length: 151 }, (_, i) => frag(i));
    const { windows, incomplete } = assembleWindowsFromFragments(fragments);
    expect(windows).toHaveLength(50);
    expect(windows[0]!.fragment_sequences).toEqual([0, 1, 2, 3]);
    expect(windows[1]!.fragment_sequences).toEqual([3, 4, 5, 6]);
    expect(windows[0]!.duration_ms).toBe(8000);
    expect(windows[49]!.sequence_no).toBe(150);
    // Overlap: shared fragment 3 between first two windows
    expect(windows[0]!.fragment_sequences[3]).toBe(
      windows[1]!.fragment_sequences[0],
    );
    expect(incomplete).toBeNull();
    expect(FRAGMENTS_PER_WINDOW).toBe(4);
    expect(FRAGMENT_STEP).toBe(3);
  });

  it('handles 2.03s fragment drift via actual PTS', () => {
    const fragments = [0, 1, 2, 3].map((seq) => {
      const start = Math.round(seq * 2030);
      return frag(seq, {
        start_pts_ms: start,
        end_pts_ms: start + 2030,
      });
    });
    const { windows } = assembleWindowsFromFragments(fragments);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.duration_ms).toBe(2030 * 4);
    expect(windows[0]!.start_pts_ms).toBe(0);
    expect(windows[0]!.end_pts_ms).toBe(2030 * 4);
  });

  it('marks short tails incomplete', () => {
    const fragments = [0, 1, 2].map((i) => frag(i));
    const { windows, incomplete } = assembleWindowsFromFragments(fragments);
    expect(windows).toHaveLength(0);
    expect(incomplete?.fragment_count).toBe(3);
    expect(incomplete?.reason).toBe('insufficient_fragments');
  });

  it('rejects PTS regression and signature change inside an epoch', () => {
    expect(() =>
      assembleWindowsFromFragments([
        frag(0),
        frag(1, { start_pts_ms: -50, end_pts_ms: 1950 }),
      ]),
    ).toThrow(/PTS regression/);
    expect(() =>
      assembleWindowsFromFragments([
        frag(0),
        frag(1, { media_signature: 'other' }),
      ]),
    ).toThrow(/Media signature/);
  });

  it('detects epoch boundaries on reconnect/codec change', () => {
    expect(
      shouldOpenNewEpoch(frag(5), {
        start_pts_ms: 0,
        media_signature: 'sigA',
      }),
    ).toBe(true);
    expect(
      shouldOpenNewEpoch(frag(5), {
        start_pts_ms: 12000,
        media_signature: 'sigB',
      }),
    ).toBe(true);
    expect(
      shouldOpenNewEpoch(frag(5), {
        start_pts_ms: 12000,
        media_signature: 'sigA',
      }),
    ).toBe(false);
  });

  it('A-09: window_end_at is last PDT start + PTS span (not last PDT alone)', () => {
    const fragments = [0, 1, 2, 3].map((seq) => {
      const start = seq * 2000;
      return frag(seq, {
        start_pts_ms: start,
        end_pts_ms: start + 2000,
        program_date_time: new Date(
          Date.UTC(2026, 8, 10, 12, 0, seq * 2),
        ).toISOString(),
      });
    });
    const { windows } = assembleWindowsFromFragments(fragments);
    expect(windows).toHaveLength(1);
    // First PDT 12:00:00 + 8000ms PTS coverage → 12:00:08
    expect(windows[0]!.window_start_at).toBe('2026-09-10T12:00:00.000Z');
    expect(windows[0]!.window_end_at).toBe('2026-09-10T12:00:08.000Z');
    // Not the last fragment PDT alone (12:00:06)
    expect(windows[0]!.window_end_at).not.toBe('2026-09-10T12:00:06.000Z');
    expect(
      computeWindowEndAt(fragments[0]!, fragments[3]!),
    ).toBe('2026-09-10T12:00:08.000Z');
  });
});
