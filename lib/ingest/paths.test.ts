import { describe, expect, it } from 'vitest';
import {
  MEDIA_FILENAME_STEM_MAX,
  resolveIngestTitle,
  sanitizeFilenameStem,
  titleFromFilename,
} from './media-name';
import { newMediaFilename } from './paths';

describe('titleFromFilename', () => {
  it('strips only the final extension and keeps the original casing', () => {
    expect(titleFromFilename('Q_ZhenHuanZhuan_EP38_45m10s_NctWfg.mp4')).toBe(
      'Q_ZhenHuanZhuan_EP38_45m10s_NctWfg',
    );
    expect(titleFromFilename('My Movie.MP4')).toBe('My Movie');
  });

  it('keeps earlier dots (multi-part names)', () => {
    expect(titleFromFilename('archive.tar.mp4')).toBe('archive.tar');
  });

  it('uses the last path segment for POSIX and Windows paths', () => {
    expect(titleFromFilename('/data/uploads/clip.mp4')).toBe('clip');
    expect(titleFromFilename('C:\\media\\clip.mp4')).toBe('clip');
  });

  it('returns the name unchanged when there is no extension / dotfile', () => {
    expect(titleFromFilename('noext')).toBe('noext');
    expect(titleFromFilename('.hidden')).toBe('.hidden');
  });
});

describe('sanitizeFilenameStem', () => {
  it('keeps a readable stem and drops the extension', () => {
    expect(sanitizeFilenameStem('Interview with Director.mkv')).toBe(
      'Interview-with-Director',
    );
  });

  it('preserves CJK letters instead of collapsing them', () => {
    expect(sanitizeFilenameStem('甄嬛传 EP38.mp4')).toBe('甄嬛传-EP38');
  });

  it('never yields a path separator and only keeps the basename', () => {
    // `..` segments are dropped wholesale because only the last path segment
    // is considered — the strongest possible traversal defense here.
    expect(sanitizeFilenameStem('../../etc/passwd.mp4')).toBe('passwd');
    expect(sanitizeFilenameStem('C:\\media\\clip name.mkv')).toBe('clip-name');
    expect(sanitizeFilenameStem('/abs/a b.mp4')).toBe('a-b');
  });

  it('collapses traversal and punctuation runs', () => {
    const out = sanitizeFilenameStem('..%2f..%2f etc..mp4');
    expect(out).not.toContain('..');
    expect(out).not.toContain('/');
    expect(out).not.toContain('\\');
  });

  it('bounds the stem length', () => {
    const out = sanitizeFilenameStem(`${'x'.repeat(500)}.mp4`);
    expect(out.length).toBeLessThanOrEqual(MEDIA_FILENAME_STEM_MAX);
  });

  it('returns an empty string when nothing usable survives', () => {
    expect(sanitizeFilenameStem('...mp4')).toBe('');
    expect(sanitizeFilenameStem('   .mp4')).toBe('');
  });
});

describe('resolveIngestTitle', () => {
  it('prefers an explicit title over the filename', () => {
    expect(resolveIngestTitle('My Title', 'clip.mp4')).toBe('My Title');
    expect(resolveIngestTitle('  trimmed  ', 'clip.mp4')).toBe('trimmed');
  });

  it('falls back to the filename stem when no title is given', () => {
    expect(resolveIngestTitle(undefined, 'Q_EP38_45m10s.mp4')).toBe(
      'Q_EP38_45m10s',
    );
    expect(resolveIngestTitle('', 'Q_EP38_45m10s.mp4')).toBe('Q_EP38_45m10s');
    expect(resolveIngestTitle('   ', 'Q_EP38_45m10s.mp4')).toBe('Q_EP38_45m10s');
    expect(resolveIngestTitle(null, 'Q_EP38_45m10s.mp4')).toBe('Q_EP38_45m10s');
  });

  it('returns undefined when neither source yields anything', () => {
    // `''` here would then let createIngestJob apply its own last-resort
    // fallback rather than creating an asset with an empty title.
    expect(resolveIngestTitle(undefined, '')).toBeUndefined();
  });
});

describe('newMediaFilename', () => {
  it('uses the sanitized stem plus a unique suffix and the extension', () => {
    const a = newMediaFilename('.mp4', 'My Clip.mp4');
    const b = newMediaFilename('.mp4', 'My Clip.mp4');
    expect(a).toMatch(/^My-Clip-[0-9a-f]{12}\.mp4$/);
    expect(a).not.toBe(b); // uniqueness survives a same-stem collision
  });

  it('falls back to a bare UUID name without an original name', () => {
    expect(newMediaFilename('.mp4')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/,
    );
  });

  it('falls back to a bare UUID name when the stem sanitizes empty', () => {
    expect(newMediaFilename('.mov', '...mov')).toMatch(
      /^[0-9a-f-]{36}\.mov$/,
    );
  });

  it('normalizes an extension given without a leading dot', () => {
    expect(newMediaFilename('mkv', 'a b.mkv')).toMatch(
      /^a-b-[0-9a-f]{12}\.mkv$/,
    );
  });

  it('cannot produce a traversal from a hostile original name', () => {
    const out = newMediaFilename('.mp4', '../../../etc/passwd.mp4');
    expect(out).not.toContain('..');
    expect(out).not.toContain('/');
    expect(out).toMatch(/\.mp4$/);
  });
});
