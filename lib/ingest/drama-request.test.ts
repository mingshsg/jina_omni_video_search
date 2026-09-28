import { afterEach, describe, expect, it } from 'vitest';
import { resetDramaEnv } from '../drama/env';
import { IngestError } from './errors';
import {
  assertDramaDurationAllowed,
  assertDramaModeAllowed,
  parseDramaFromFormData,
  resolveDramaOptions,
} from './drama-request';

afterEach(() => {
  resetDramaEnv();
  delete process.env.DRAMA_MAX_DURATION_MS;
});

describe('resolveDramaOptions', () => {
  it('returns undefined when omitted or disabled', () => {
    expect(resolveDramaOptions(undefined)).toBeUndefined();
    expect(resolveDramaOptions({ enabled: false })).toBeUndefined();
  });

  it('accepts enabled modules with languages for subtitles', () => {
    expect(
      resolveDramaOptions({
        enabled: true,
        languages: ['zh', 'en'],
        modules: ['subtitles', 'structure'],
      }),
    ).toEqual({
      enabled: true,
      languages: ['zh', 'en'],
      modules: ['subtitles', 'structure'],
    });
  });

  it('accepts Korean and Thai as source subtitle languages', () => {
    expect(resolveDramaOptions({
      enabled: true,
      languages: ['ko', 'th'],
      modules: ['subtitles'],
    })).toEqual({
      enabled: true,
      languages: ['ko', 'th'],
      modules: ['subtitles'],
    });
  });

  it('rejects empty modules', () => {
    expect(() =>
      resolveDramaOptions({ enabled: true, modules: [], languages: ['zh'] }),
    ).toThrow(IngestError);
    try {
      resolveDramaOptions({ enabled: true, modules: [] });
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_DRAMA_EMPTY');
    }
  });

  it('rejects subtitles without languages', () => {
    try {
      resolveDramaOptions({
        enabled: true,
        modules: ['subtitles'],
        languages: [],
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_DRAMA_INVALID');
    }
  });

  it('rejects unknown language or module', () => {
    expect(() =>
      resolveDramaOptions({
        enabled: true,
        modules: ['subtitles'],
        languages: ['fr'],
      }),
    ).toThrow(IngestError);
    expect(() =>
      resolveDramaOptions({
        enabled: true,
        modules: ['trailer'],
        languages: ['zh'],
      }),
    ).toThrow(IngestError);
  });

  it('rejects key_actors without directors_script', () => {
    try {
      resolveDramaOptions({
        enabled: true,
        modules: ['key_actors'],
        languages: [],
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_DRAMA_NEEDS_DIRECTORS');
    }
  });

  it('accepts key_actors with directors_script', () => {
    expect(
      resolveDramaOptions({
        enabled: true,
        modules: ['key_actors', 'directors_script'],
        languages: [],
      }),
    ).toEqual({
      enabled: true,
      languages: [],
      modules: ['key_actors', 'directors_script'],
    });
  });

  it('dedupes languages and modules', () => {
    expect(
      resolveDramaOptions({
        enabled: true,
        languages: ['zh', 'zh', 'en'],
        modules: ['structure', 'structure'],
      }),
    ).toEqual({
      enabled: true,
      languages: ['zh', 'en'],
      modules: ['structure'],
    });
  });
});

describe('assertDramaModeAllowed', () => {
  it('blocks url mode when drama enabled', () => {
    expect(() =>
      assertDramaModeAllowed('url', {
        enabled: true,
        languages: ['zh'],
        modules: ['structure'],
      }),
    ).toThrow(IngestError);
  });

  it('allows local and upload', () => {
    const opts = {
      enabled: true as const,
      languages: ['zh' as const],
      modules: ['structure' as const],
    };
    expect(() => assertDramaModeAllowed('local', opts)).not.toThrow();
    expect(() => assertDramaModeAllowed('upload', opts)).not.toThrow();
  });
});

describe('assertDramaDurationAllowed', () => {
  it('allows under default 210 minutes', () => {
    expect(() =>
      assertDramaDurationAllowed(209 * 60 * 1000),
    ).not.toThrow();
  });

  it('rejects over the configured cap', () => {
    process.env.DRAMA_MAX_DURATION_MS = String(60 * 60 * 1000);
    resetDramaEnv();
    try {
      assertDramaDurationAllowed(61 * 60 * 1000);
      expect.fail('expected throw');
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_DRAMA_TOO_LONG');
    }
  });
});

describe('parseDramaFromFormData', () => {
  it('parses JSON list fields', () => {
    const form = new FormData();
    form.set('drama_enabled', 'true');
    form.set('drama_languages', JSON.stringify(['zh', 'en']));
    form.set(
      'drama_modules',
      JSON.stringify(['subtitles', 'key_scenes']),
    );
    expect(parseDramaFromFormData(form)).toEqual({
      enabled: true,
      languages: ['zh', 'en'],
      modules: ['subtitles', 'key_scenes'],
    });
  });

  it('parses comma-separated lists', () => {
    const form = new FormData();
    form.set('drama_enabled', '1');
    form.set('drama_languages', 'zh');
    form.set('drama_modules', 'structure,directors_script');
    expect(parseDramaFromFormData(form)).toEqual({
      enabled: true,
      languages: ['zh'],
      modules: ['structure', 'directors_script'],
    });
  });

  it('parses ko/th form selections', () => {
    const form = new FormData();
    form.set('drama_enabled', 'true');
    form.set('drama_languages', JSON.stringify(['ko', 'th']));
    form.set('drama_modules', JSON.stringify(['subtitles']));
    expect(parseDramaFromFormData(form)?.languages).toEqual(['ko', 'th']);
  });

  it('returns undefined when drama_enabled is false', () => {
    const form = new FormData();
    form.set('drama_enabled', 'false');
    form.set('drama_modules', 'structure');
    expect(parseDramaFromFormData(form)).toBeUndefined();
  });
});
