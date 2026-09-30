import { describe, expect, it } from 'vitest';
import { classifyMetaLoad, metaEditorView, type FetchedJson } from './meta-load-state';

const dto: FetchedJson<{ title: string }> = {
  ok: true,
  body: { title: 'Existing title' },
  transportFailed: false,
};
const catalogs: FetchedJson<{ people: string[] }> = {
  ok: true,
  body: { people: ['actor'] },
  transportFailed: false,
};

describe('metadata editor initial load', () => {
  it('renders a valid DTO with its catalogs', () => {
    expect(classifyMetaLoad(dto, catalogs, 'Load failed')).toEqual({
      status: 'ok',
      dto: dto.body,
      catalogs: catalogs.body,
    });
    expect(metaEditorView({ loading: false, hasDto: true })).toBe('form');
  });

  it('keeps the metadata form available when catalogs fail', () => {
    expect(
      classifyMetaLoad(
        dto,
        { ok: false, body: null, transportFailed: true },
        'Load failed',
      ),
    ).toEqual({ status: 'catalogs_warning', dto: dto.body, message: 'Load failed' });
  });

  it('shows an error instead of an endless loading state when metadata fails', () => {
    expect(
      classifyMetaLoad(
        { ok: false, body: null, transportFailed: true },
        catalogs,
        'Load failed',
      ),
    ).toEqual({ status: 'meta_error', message: 'Load failed' });
    expect(metaEditorView({ loading: false, hasDto: false })).toBe('error');
  });

  it('uses a server error for a non-OK metadata response', () => {
    expect(
      classifyMetaLoad(
        {
          ok: false,
          body: null,
          transportFailed: false,
          errorMessage: 'Asset unavailable',
        },
        catalogs,
        'Load failed',
      ),
    ).toEqual({ status: 'meta_error', message: 'Asset unavailable' });
  });

  it('shows loading only while the request is in flight', () => {
    expect(metaEditorView({ loading: true, hasDto: false })).toBe('loading');
    expect(metaEditorView({ loading: true, hasDto: true })).toBe('loading');
  });
});
