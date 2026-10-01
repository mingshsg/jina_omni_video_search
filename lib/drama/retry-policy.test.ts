import { describe, expect, it } from 'vitest';
import type { DramaJobState } from '../ingest/drama-options';
import { resolveDramaRetryPolicy } from './retry-policy';

const failed: DramaJobState = {
  status: 'failed',
  languages: ['zh', 'en'],
  modules: ['subtitles'],
  modules_done: [],
  subtitleSource: 'existing_only',
  directorCoverage: 'sampled',
};

describe('resolveDramaRetryPolicy', () => {
  it('changes method and spoken language only when explicitly requested', () => {
    expect(resolveDramaRetryPolicy(failed, {
      subtitle_source: 'auto',
      source_language: 'en',
    })).toEqual({ subtitleSource: 'auto', sourceLanguage: 'en' });
    expect(failed.subtitleSource).toBe('existing_only');
  });

  it('requires a spoken language when enabling bilingual ASR', () => {
    expect(() => resolveDramaRetryPolicy(failed, { subtitle_source: 'auto' }))
      .toThrow(/spoken language/);
  });

  it('rejects unknown fields and unsupported languages', () => {
    expect(() => resolveDramaRetryPolicy(failed, { subtitle_source: 'auto', modules: ['structure'] }))
      .toThrow(/Invalid subtitle retry options/);
    expect(() => resolveDramaRetryPolicy(failed, { source_language: 'ko' }))
      .toThrow(/Invalid subtitle retry options/);
  });

  it('preserves an existing spoken language when only method changes', () => {
    expect(resolveDramaRetryPolicy({ ...failed, sourceLanguage: 'en' }, { subtitle_source: 'force_asr' }))
      .toEqual({ subtitleSource: 'force_asr', sourceLanguage: 'en' });
  });

  it('rejects policy overrides for runs without subtitles', () => {
    expect(() => resolveDramaRetryPolicy({ ...failed, modules: ['structure'] }, { subtitle_source: 'auto' }))
      .toThrow(/Invalid subtitle retry options/);
  });
});
