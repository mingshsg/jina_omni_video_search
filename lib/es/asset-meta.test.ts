import { describe, expect, it } from 'vitest';
import { isStrictDynamicMappingException } from './asset-meta';
import { videoAssetsMetaMappingProperties } from './asset-meta-mapping';

describe('isStrictDynamicMappingException', () => {
  it('detects ES client body type', () => {
    expect(
      isStrictDynamicMappingException({
        meta: {
          body: {
            error: {
              type: 'strict_dynamic_mapping_exception',
              reason:
                'mapping set to strict, dynamic introduction of [description_embedding_meta] within [meta] is not allowed',
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('detects message-only shape', () => {
    expect(
      isStrictDynamicMappingException({
        message:
          'strict_dynamic_mapping_exception: mapping set to strict, dynamic introduction of [description_embedding_meta] within [meta] is not allowed',
      }),
    ).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isStrictDynamicMappingException(new Error('version_conflict'))).toBe(
      false,
    );
    expect(isStrictDynamicMappingException(null)).toBe(false);
  });
});

describe('videoAssetsMetaMappingProperties Phase 3.5 fields', () => {
  it('declares description_embedding and description_embedding_meta under meta', () => {
    const meta = videoAssetsMetaMappingProperties().meta as {
      properties: Record<string, unknown>;
    };
    expect(meta.properties.description_embedding).toEqual({
      type: 'dense_vector',
      dims: 1024,
      index: true,
      similarity: 'cosine',
    });
    const embMeta = meta.properties.description_embedding_meta as {
      type: string;
      properties: Record<string, unknown>;
    };
    expect(embMeta.type).toBe('object');
    expect(embMeta.properties.state).toEqual({ type: 'keyword' });
    expect(embMeta.properties.dims).toEqual({ type: 'integer' });
  });
});
