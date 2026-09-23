import { describe, expect, it } from 'vitest';
import {
  diffMappingProperties,
  MappingUpgradeConflictError,
} from './mapping-diff';
import { videoAssetsMetaMappingProperties } from './asset-meta-mapping';

describe('diffMappingProperties', () => {
  const desired = videoAssetsMetaMappingProperties();

  it('adds the whole meta tree when missing', () => {
    const diff = diffMappingProperties(desired, {});
    expect(diff.addedPaths).toContain('meta');
    expect(diff.toPut.meta).toBeDefined();
    expect(diff.conflicts).toHaveLength(0);
  });

  it('is a no-op when the full meta mapping already matches', () => {
    const diff = diffMappingProperties(desired, desired);
    expect(diff.addedPaths).toHaveLength(0);
    expect(Object.keys(diff.toPut)).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.alreadyPresent).toContain('meta');
  });

  it('adds missing nested children under an existing meta object', () => {
    const partial = {
      meta: {
        type: 'object',
        properties: {
          year: { type: 'integer' },
          // deliberately missing actor_ids, search_text, …
        },
      },
    };
    const diff = diffMappingProperties(desired, partial);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.addedPaths.some((p) => p.includes('actor_ids'))).toBe(true);
    expect(diff.addedPaths.some((p) => p.includes('search_text'))).toBe(true);
    const metaPut = diff.toPut.meta as {
      properties: Record<string, unknown>;
    };
    expect(metaPut.properties.actor_ids).toEqual({ type: 'keyword' });
    expect(metaPut.properties.year).toBeUndefined();
  });

  it('adds missing search_text.cjk under an existing search_text', () => {
    const partial = {
      meta: {
        type: 'object',
        properties: {
          search_text: { type: 'text' },
        },
      },
    };
    const diff = diffMappingProperties(desired, partial);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.addedPaths.some((p) => p.endsWith('search_text.fields.cjk'))).toBe(
      true,
    );
    const metaPut = diff.toPut.meta as {
      properties: { search_text: { fields: { cjk: unknown } } };
    };
    expect(metaPut.properties.search_text.fields.cjk).toEqual({
      type: 'text',
      analyzer: 'cjk',
    });
  });

  it('adds missing description_embedding fields under existing meta', () => {
    const partial = {
      meta: {
        type: 'object',
        properties: {
          year: { type: 'integer' },
          description: { type: 'text' },
        },
      },
    };
    const diff = diffMappingProperties(desired, partial);
    expect(diff.conflicts).toHaveLength(0);
    expect(
      diff.addedPaths.some((p) => p.includes('description_embedding')),
    ).toBe(true);
    expect(
      diff.addedPaths.some((p) => p.includes('description_embedding_meta')),
    ).toBe(true);
  });

  it('conflicts when an existing field type differs', () => {
    const bad = {
      meta: {
        type: 'object',
        properties: {
          year: { type: 'keyword' },
        },
      },
    };
    const diff = diffMappingProperties(desired, bad);
    expect(diff.conflicts.some((c) => c.path.includes('year') && c.reason.includes('type'))).toBe(
      true,
    );
  });

  it('conflicts when copy_to target differs', () => {
    const bad = {
      meta: {
        type: 'object',
        properties: {
          actor_aliases: {
            type: 'keyword',
            copy_to: 'wrong.target',
          },
        },
      },
    };
    const diff = diffMappingProperties(desired, bad);
    expect(
      diff.conflicts.some((c) => c.path.includes('copy_to')),
    ).toBe(true);
  });

  it('treats implicit object (properties without type) as matching type:object', () => {
    const existing = {
      meta: {
        properties: {
          year: { type: 'integer' },
          description: { type: 'text' },
          abstract: { type: 'text' },
          actors: { type: 'keyword' },
          actor_ids: { type: 'keyword' },
          actor_aliases: { type: 'keyword', copy_to: 'meta.search_text' },
          actor_keys: { type: 'keyword' },
          video_type: { type: 'keyword' },
          primary_language: { type: 'keyword' },
          country: { type: 'keyword' },
          tags: { type: 'keyword' },
          tags_key: { type: 'keyword' },
          work_title: {
            properties: {
              en: { type: 'text' },
              zh: { type: 'text' },
              native: {
                properties: {
                  lang: { type: 'keyword' },
                  name: { type: 'text' },
                },
              },
            },
          },
          review: { properties: {} },
          revision: { type: 'long' },
          updated_at: { type: 'date' },
          search_text: {
            type: 'text',
            fields: { cjk: { type: 'text', analyzer: 'cjk' } },
          },
          description_embedding: {
            type: 'dense_vector',
            dims: 1024,
            index: true,
            similarity: 'cosine',
          },
          description_embedding_meta: {
            type: 'object',
            properties: {
              source_revision: { type: 'long' },
              source_digest: { type: 'keyword' },
              state: { type: 'keyword' },
              provider: { type: 'keyword' },
              model: { type: 'keyword' },
              task: { type: 'keyword' },
              dims: { type: 'integer' },
            },
          },
        },
      },
    };
    // Fill review children from desired so we only test the type omission
    const desiredMeta = desired.meta as {
      properties: { review: { properties: Record<string, unknown> } };
    };
    (
      existing.meta.properties.review as { properties: Record<string, unknown> }
    ).properties = desiredMeta.properties.review.properties;

    const diff = diffMappingProperties(desired, existing);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.addedPaths).toHaveLength(0);
  });

  it('MappingUpgradeConflictError summarizes conflicts', () => {
    const err = new MappingUpgradeConflictError([
      {
        path: 'meta.year.type',
        reason: "'type' differs",
        existing: 'keyword',
        desired: 'integer',
      },
    ]);
    expect(err.code).toBe('MAPPING_UPGRADE_CONFLICT');
    expect(err.message).toContain('meta.year.type');
  });
});
