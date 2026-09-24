import { describe, expect, it } from 'vitest';
import { deriveSemanticMirrorFields, isStrictDynamicMappingException, strictDynamicIntroducedField } from './asset-meta';
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

  it('extracts the introduced field name from the reason', () => {
    expect(
      strictDynamicIntroducedField({
        meta: {
          body: {
            error: {
              type: 'strict_dynamic_mapping_exception',
              reason:
                'mapping set to strict, dynamic introduction of [work_title] within [meta] is not allowed',
            },
          },
        },
      }),
    ).toBe('work_title');
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

describe('videoAssetsMetaMappingProperties item 4 semantic_text mirror fields', () => {
  it('omits *_semantic fields when no inference id is passed', () => {
    const meta = videoAssetsMetaMappingProperties().meta as {
      properties: Record<string, unknown>;
    };
    expect(meta.properties.description_semantic).toBeUndefined();
    expect(meta.properties.abstract_semantic).toBeUndefined();
    expect(meta.properties.work_title_semantic).toBeUndefined();
  });

  it('declares three semantic_text fields bound to the given inference id', () => {
    const meta = videoAssetsMetaMappingProperties('my-inference-id').meta as {
      properties: Record<string, unknown>;
    };
    expect(meta.properties.description_semantic).toEqual({
      type: 'semantic_text',
      inference_id: 'my-inference-id',
    });
    expect(meta.properties.abstract_semantic).toEqual({
      type: 'semantic_text',
      inference_id: 'my-inference-id',
    });
    expect(meta.properties.work_title_semantic).toEqual({
      type: 'semantic_text',
      inference_id: 'my-inference-id',
    });
  });

  it('leaves the existing lexical description/abstract fields untouched', () => {
    const meta = videoAssetsMetaMappingProperties('my-inference-id').meta as {
      properties: Record<string, unknown>;
    };
    expect(meta.properties.description).toEqual({ type: 'text' });
    expect(meta.properties.abstract).toEqual({ type: 'text' });
  });
});

describe('deriveSemanticMirrorFields', () => {
  it('mirrors description/abstract/work_title.en when touched', () => {
    expect(
      deriveSemanticMirrorFields({
        description: 'A plot summary',
        abstract: 'One line',
        work_title: { en: 'Nirvana in Fire' },
      }),
    ).toEqual({
      description_semantic: 'A plot summary',
      abstract_semantic: 'One line',
      work_title_semantic: 'Nirvana in Fire',
    });
  });

  it('mirrors null clears alongside the lexical field', () => {
    expect(
      deriveSemanticMirrorFields({ description: null, work_title: null }),
    ).toEqual({
      description_semantic: null,
      work_title_semantic: null,
    });
  });

  it('does not invent a mirror for untouched fields', () => {
    expect(deriveSemanticMirrorFields({ tags: ['a'] })).toEqual({});
  });
});
