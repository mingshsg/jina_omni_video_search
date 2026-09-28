/**
 * Resolve optional ingest `group_id` (free-form).
 */
import { describe, expect, it } from 'vitest';
import { IngestError } from './errors';
import { resolveIngestGroupId } from './group-request';

describe('resolveIngestGroupId', () => {
  it('returns undefined for empty / absent', () => {
    expect(resolveIngestGroupId(undefined)).toBeUndefined();
    expect(resolveIngestGroupId(null)).toBeUndefined();
    expect(resolveIngestGroupId('')).toBeUndefined();
    expect(resolveIngestGroupId('   ')).toBeUndefined();
  });

  it('accepts free-form names', () => {
    expect(resolveIngestGroupId('default')).toBe('default');
    expect(resolveIngestGroupId(' demo ')).toBe('demo');
    expect(resolveIngestGroupId('my-campaign')).toBe('my-campaign');
    expect(resolveIngestGroupId(' 客户 A ')).toBe('客户 A');
  });

  it('rejects over-long names', () => {
    expect(() => resolveIngestGroupId('x'.repeat(65))).toThrow(IngestError);
    try {
      resolveIngestGroupId('x'.repeat(65));
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).code).toBe('INGEST_INVALID_GROUP');
    }
  });
});
