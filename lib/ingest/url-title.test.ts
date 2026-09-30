import { describe, expect, it } from 'vitest';
import { sanitizeUrlProvenance } from './url-sanitize';
import { titleFromUrlPath } from './url-title';

describe('titleFromUrlPath', () => {
  it('decodes a Chinese filename without changing sanitized provenance', () => {
    const provenance = sanitizeUrlProvenance(
      'https://cdn.example.com/视频素材.mp4?token=private',
    );
    expect(titleFromUrlPath(provenance.source_origin_path)).toBe('视频素材');
    expect(provenance.source_origin_path).toBe(
      'https://cdn.example.com/%E8%A7%86%E9%A2%91%E7%B4%A0%E6%9D%90.mp4',
    );
  });

  it('keeps a malformed escape instead of failing the import', () => {
    expect(titleFromUrlPath('https://cdn.example.com/clip%ZZ.mp4')).toBe(
      'clip%ZZ',
    );
  });

  it('does not let an encoded separator change the selected segment', () => {
    expect(titleFromUrlPath('https://cdn.example.com/a%2Fb.mp4')).toBe('a-b');
  });

  it('returns empty for a URL with no filename', () => {
    expect(titleFromUrlPath('https://cdn.example.com/')).toBe('');
  });
});
