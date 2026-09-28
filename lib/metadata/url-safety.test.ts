import { describe, expect, it } from 'vitest';
import { isAlreadySafeExternalUrl, sanitizeExternalUrl } from './url-safety';

/**
 * todo/33 R1. These cover the no-secrets-in-indexed-documents invariant for
 * the two URL fields that reach Elasticsearch `_source` and the editor API:
 * `meta.reference_urls` and `meta.review.*.source_url`.
 *
 * No real credential is used anywhere below — every token is synthetic.
 */
describe('sanitizeExternalUrl', () => {
  it('strips userinfo credentials from the authority', () => {
    expect(
      sanitizeExternalUrl('https://alice:s3cret@en.wikipedia.org/wiki/Parasite'),
    ).toBe('https://en.wikipedia.org/wiki/Parasite');
    // username-only, no password
    expect(sanitizeExternalUrl('https://alice@example.com/p')).toBe(
      'https://example.com/p',
    );
  });

  it('strips the fragment', () => {
    expect(sanitizeExternalUrl('https://example.com/p#section-2')).toBe(
      'https://example.com/p',
    );
  });

  it('removes credential-bearing query parameters but keeps the rest', () => {
    expect(
      sanitizeExternalUrl('https://example.com/p?api_key=AAA&lang=ko&page=2'),
    ).toBe('https://example.com/p?lang=ko&page=2');
    for (const name of [
      'token',
      'access_token',
      'password',
      'secret',
      'signature',
      'sessionid',
      'jwt',
    ]) {
      const out = sanitizeExternalUrl(`https://example.com/p?${name}=XYZ`);
      expect(out, name).toBe('https://example.com/p');
    }
  });

  it('is case-insensitive about credential parameter names', () => {
    expect(sanitizeExternalUrl('https://example.com/p?API_KEY=AAA')).toBe(
      'https://example.com/p',
    );
  });

  it('preserves a query-addressed reference page', () => {
    // Deliberately NOT reduced to origin+path the way FR-22 does: dropping
    // the whole query here would retarget the link to a different page.
    expect(
      sanitizeExternalUrl('https://en.wikipedia.org/w/index.php?curid=12345'),
    ).toBe('https://en.wikipedia.org/w/index.php?curid=12345');
  });

  it('keeps a bare `key` parameter, which is commonly a legitimate lookup', () => {
    expect(sanitizeExternalUrl('https://example.com/p?key=tt0123')).toBe(
      'https://example.com/p?key=tt0123',
    );
  });

  it('rejects non-http(s) schemes, control characters, and overlong input', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeExternalUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(sanitizeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeExternalUrl('https://example.com/\u0007bell')).toBeNull();
    expect(sanitizeExternalUrl(`https://example.com/${'a'.repeat(4000)}`)).toBeNull();
    expect(sanitizeExternalUrl('not a url')).toBeNull();
    expect(sanitizeExternalUrl(null)).toBeNull();
    expect(sanitizeExternalUrl(undefined)).toBeNull();
  });

  it('honours a protocol restriction (source_url is https-only)', () => {
    expect(
      sanitizeExternalUrl('http://example.com/p', { protocols: ['https:'] }),
    ).toBeNull();
    expect(
      sanitizeExternalUrl('https://example.com/p', { protocols: ['https:'] }),
    ).toBe('https://example.com/p');
  });

  it('reports whether a URL was already safe', () => {
    expect(isAlreadySafeExternalUrl('https://example.com/p')).toBe(true);
    expect(isAlreadySafeExternalUrl('https://u:p@example.com/p')).toBe(false);
    expect(isAlreadySafeExternalUrl('https://example.com/p?token=X')).toBe(false);
  });
});
