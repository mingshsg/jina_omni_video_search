import { describe, expect, it } from 'vitest';
import {
  descriptionEmbedText,
  descriptionSourceDigest,
} from './description-embed';

describe('description embedding helpers', () => {
  it('builds a stable digest over description+abstract', () => {
    const a = descriptionSourceDigest('hello', 'world');
    const b = descriptionSourceDigest('hello', 'world');
    const c = descriptionSourceDigest('hello', 'other');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('sha256:')).toBe(true);
  });

  it('joins non-empty description and abstract', () => {
    expect(descriptionEmbedText('  a  ', ' b ')).toBe('a\nb');
    expect(descriptionEmbedText('', null)).toBe('');
    expect(descriptionEmbedText(undefined, 'only')).toBe('only');
  });
});
