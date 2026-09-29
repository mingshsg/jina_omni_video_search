import { describe, expect, it } from 'vitest';
import { selectedSearchGroupIds } from './group-filter-ui';

describe('primary search group selection', () => {
  it('treats an empty selection and All as an unfiltered search', () => {
    expect(selectedSearchGroupIds([])).toEqual([]);
    expect(selectedSearchGroupIds([
      { label: 'demo', value: 'demo' },
      { label: 'All groups', value: '' },
    ])).toEqual([]);
  });

  it('keeps multiple selected groups without duplicates', () => {
    expect(selectedSearchGroupIds([
      { label: 'demo', value: 'demo' },
      { label: 'trailer', value: 'trailer' },
      { label: 'demo', value: 'demo' },
    ])).toEqual(['demo', 'trailer']);
  });
});
