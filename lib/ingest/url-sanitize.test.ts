import { describe, expect, it } from 'vitest';
import { sanitizeUrlProvenance, isRawUrlClientSafe } from './url-sanitize';

describe('sanitizeUrlProvenance', () => {
  it('strips userinfo, query, and fragment (FR-22)', () => {
    const raw =
      'https://user:secret@cdn.example.com/videos/trailer.mp4?token=abc&sig=xyz#t=10';
    const { source_origin_path, source_fingerprint } = sanitizeUrlProvenance(raw);
    expect(source_origin_path).toBe(
      'https://cdn.example.com/videos/trailer.mp4',
    );
    expect(source_origin_path).not.toContain('secret');
    expect(source_origin_path).not.toContain('token');
    expect(source_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves non-default port in origin path', () => {
    const { source_origin_path } = sanitizeUrlProvenance(
      'http://media.example.com:8080/clips/a.mp4',
    );
    expect(source_origin_path).toBe('http://media.example.com:8080/clips/a.mp4');
  });

  it('fingerprints differ for distinct raw URLs', () => {
    const a = sanitizeUrlProvenance('https://example.com/a.mp4?x=1');
    const b = sanitizeUrlProvenance('https://example.com/a.mp4?x=2');
    expect(a.source_origin_path).toBe(b.source_origin_path);
    expect(a.source_fingerprint).not.toBe(b.source_fingerprint);
  });
});

describe('isRawUrlClientSafe', () => {
  it('defaults to false', () => {
    expect(isRawUrlClientSafe('https://example.com/x.mp4')).toBe(false);
  });
});
