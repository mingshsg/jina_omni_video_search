import { describe, expect, it } from 'vitest';
import { normalizeGroupId } from './catalogs';
import { inferGroupFromVariants, parseFreeformGroupId } from './groups';

describe('normalizeGroupId / parseFreeformGroupId', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeGroupId('  my   set  ')).toBe('my set');
    expect(parseFreeformGroupId('  trailer ')).toBe('trailer');
  });

  it('rejects empty and over-long names', () => {
    expect(normalizeGroupId('   ')).toBeNull();
    expect(() => parseFreeformGroupId('')).toThrow(/empty/);
    expect(() => parseFreeformGroupId('x'.repeat(65))).toThrow(/exceeds/);
  });
});

describe('inferGroupFromVariants', () => {
  it('maps fine / 10s → trailer and 2s → demo', () => {
    expect(
      inferGroupFromVariants([{ chunk_preset: 'fine', chunk_window_ms: 10_000 }]),
    ).toBe('trailer');
    expect(
      inferGroupFromVariants([{ chunk_preset: '2s', chunk_window_ms: 2_000 }]),
    ).toBe('demo');
    expect(inferGroupFromVariants([{ chunk_window_ms: 10_000 }])).toBe(
      'trailer',
    );
    expect(inferGroupFromVariants([{ chunk_window_ms: 2_000 }])).toBe('demo');
  });

  it('prefers demo when both windows are present', () => {
    expect(
      inferGroupFromVariants([
        { chunk_preset: 'fine', chunk_window_ms: 10_000 },
        { chunk_preset: '2s', chunk_window_ms: 2_000 },
      ]),
    ).toBe('demo');
  });

  it('returns null for unrelated presets', () => {
    expect(
      inferGroupFromVariants([{ chunk_preset: '30s', chunk_window_ms: 30_000 }]),
    ).toBeNull();
    expect(inferGroupFromVariants([])).toBeNull();
  });
});
