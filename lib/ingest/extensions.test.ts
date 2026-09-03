import { describe, expect, it } from 'vitest';
import { extensionOf, isAllowedVideoExtension } from './extensions';

describe('extensions', () => {
  it('accepts common video extensions', () => {
    expect(isAllowedVideoExtension('clip.MP4')).toBe(true);
    expect(isAllowedVideoExtension('/path/to/video.webm')).toBe(true);
  });

  it('rejects unknown extensions', () => {
    expect(isAllowedVideoExtension('readme.txt')).toBe(false);
    expect(isAllowedVideoExtension('noext')).toBe(false);
  });

  it('extracts extension case-insensitively', () => {
    expect(extensionOf('foo/bar.MOV')).toBe('.mov');
  });
});
