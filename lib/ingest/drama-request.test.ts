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
      subtitleSource: 'auto',
      directorCoverage: 'sampled',
    });
  });

  it('accepts a spoken source language only when it is requested', () => {
    expect(resolveDramaOptions({
      enabled: true,
      languages: ['en', 'zh'],
      modules: ['subtitles'],
      source_language: 'en',
    })?.sourceLanguage).toBe('en');
    expect(() => resolveDramaOptions({
      enabled: true,
      languages: ['zh'],
      modules: ['subtitles'],
      source_language: 'en',
    })).toThrow(IngestError);
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
      subtitleSource: 'auto',
      directorCoverage: 'sampled',
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
      subtitleSource: 'auto',
      directorCoverage: 'sampled',
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
      subtitleSource: 'auto',
      directorCoverage: 'sampled',
    });
  });

  // P4: per-run subtitle_source / director_coverage parsing.
  it('defaults subtitle_source to auto and director_coverage to sampled', () => {
    const opts = resolveDramaOptions({
      enabled: true,
      languages: ['zh'],
      modules: ['subtitles'],
    });
    expect(opts?.subtitleSource).toBe('auto');
    expect(opts?.directorCoverage).toBe('sampled');
  });

  it('accepts explicit valid subtitle_source values', () => {
    expect(
      resolveDramaOptions({
        enabled: true,
        languages: ['zh'],
        modules: ['subtitles'],
        subtitle_source: 'existing_only',
      })?.subtitleSource,
    ).toBe('existing_only');
    expect(
      resolveDramaOptions({
        enabled: true,
        languages: ['zh'],
        modules: ['subtitles'],
        subtitle_source: 'force_asr',
      })?.subtitleSource,
    ).toBe('force_asr');
  });

  it('accepts explicit director_coverage sampled', () => {
    expect(
      resolveDramaOptions({
        enabled: true,
        languages: ['zh'],
        modules: ['subtitles'],
        director_coverage: 'sampled',
      })?.directorCoverage,
    ).toBe('sampled');
  });

  it('rejects an unknown subtitle_source', () => {
    try {
      resolveDramaOptions({
        enabled: true,
        languages: ['zh'],
        modules: ['subtitles'],
        subtitle_source: 'whatever',
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_DRAMA_INVALID');
    }
  });

  it('rejects director_coverage full (not implemented)', () => {
    try {
      resolveDramaOptions({
        enabled: true,
        languages: ['zh'],
        modules: ['subtitles'],
        director_coverage: 'full',
      });
      expect.fail('expected throw');
    } catch (e) {
      expect((e as IngestError).code).toBe('INGEST_DRAMA_INVALID');
    }
  });
});

describe('assertDramaModeAllowed', () => {
  it('blocks url mode when drama enabled', () => {
    expect(() =>
      assertDramaModeAllowed('url', {
        enabled: true,
        languages: ['zh'],
        modules: ['structure'],
        subtitleSource: 'auto',
        directorCoverage: 'sampled',
      }),
    ).toThrow(IngestError);
  });

  it('allows local and upload', () => {
    const opts = {
      enabled: true as const,
      languages: ['zh' as const],
      modules: ['structure' as const],
      subtitleSource: 'auto' as const,
      directorCoverage: 'sampled' as const,
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
      subtitleSource: 'auto',
      directorCoverage: 'sampled',
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
      subtitleSource: 'auto',
      directorCoverage: 'sampled',
    });
  });

  it('parses ko/th form selections', () => {
    const form = new FormData();
    form.set('drama_enabled', 'true');
    form.set('drama_languages', JSON.stringify(['ko', 'th']));
    form.set('drama_modules', JSON.stringify(['subtitles']));
    expect(parseDramaFromFormData(form)?.languages).toEqual(['ko', 'th']);
  });

  // P4: per-run policy fields from form data (single CSV-ish values).
  it('parses drama_subtitle_source and drama_director_coverage from form', () => {
    const form = new FormData();
    form.set('drama_enabled', 'true');
    form.set('drama_languages', 'zh');
    form.set('drama_modules', 'subtitles');
    form.set('drama_subtitle_source', 'existing_only');
    form.set('drama_director_coverage', 'sampled');
    const opts = parseDramaFromFormData(form);
    expect(opts?.subtitleSource).toBe('existing_only');
    expect(opts?.directorCoverage).toBe('sampled');
  });

  it('rejects an invalid drama_subtitle_source from form', () => {
    const form = new FormData();
    form.set('drama_enabled', 'true');
    form.set('drama_languages', 'zh');
    form.set('drama_modules', 'subtitles');
    form.set('drama_subtitle_source', 'full_auto');
    expect(() => parseDramaFromFormData(form)).toThrow(IngestError);
  });

  it('rejects an invalid drama_director_coverage from form', () => {
    const form = new FormData();
    form.set('drama_enabled', 'true');
    form.set('drama_languages', 'zh');
    form.set('drama_modules', 'subtitles');
    form.set('drama_director_coverage', 'full');
    expect(() => parseDramaFromFormData(form)).toThrow(IngestError);
  });

  it('returns undefined when drama_enabled is false', () => {
    const form = new FormData();
    form.set('drama_enabled', 'false');
    form.set('drama_modules', 'structure');
    expect(parseDramaFromFormData(form)).toBeUndefined();
  });
});
