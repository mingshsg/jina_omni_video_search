import { describe, expect, it } from 'vitest';
import {
  analyzeTitleClues,
  buildLocalSuggestions,
  extractWorkTitle,
  normalizeTitle,
  suggestAbstractFromTitle,
  suggestDescriptionFromTitle,
  suggestLanguageFromMediaTag,
  suggestTagsFromTitle,
  suggestVideoTypeFromTitle,
  suggestYearFromTitle,
} from './suggest-local';

describe('normalizeTitle / extractWorkTitle', () => {
  it('strips extension, separators, quality noise, and leading indexes', () => {
    expect(
      normalizeTitle('Breakfast.at.Tiffany\'s.1961.1080p.BluRay.x264.mp4'),
    ).toBe("Breakfast at Tiffany's 1961");
    expect(normalizeTitle('18_JurassicPark.mp4')).toBe('Jurassic Park');
    expect(
      normalizeTitle(
        'D_XiangSiLing_EverlastingLonging_costume_AB_5m58s_pHuYAdHmG1Q',
      ),
    ).toBe('Xiang Si Ling Everlasting Longing');
    expect(
      normalizeTitle(
        'C_GenieMakeAWish_Netflix_kissreaction_ENGSUB_6m51s_2HsmKYB1Vkk',
      ),
    ).toBe('Genie Make A Wish');
    expect(normalizeTitle('A Beautiful Mind')).toBe('A Beautiful Mind');
    expect(normalizeTitle('I Am Legend')).toBe('I Am Legend');
  });

  it('keeps an ordinary 11-letter final title word', () => {
    expect(normalizeTitle('Harry_Potter_Philosopher')).toBe(
      'Harry Potter Philosopher',
    );
  });

  it('strips spaced letter prefixes and East-Asian broadcaster tokens', () => {
    expect(normalizeTitle('H Hur Jun MBC youeuitae 1999')).toBe(
      'Hur Jun youeuitae 1999',
    );
    expect(normalizeTitle('H_HurJun_MBC_youeuitae_1999')).toBe(
      'Hur Jun youeuitae 1999',
    );
    expect(
      extractWorkTitle(normalizeTitle('H Hur Jun MBC youeuitae 1999')),
    ).toBe('Hur Jun youeuitae');
  });

  it('extracts work title without year and edge decorations', () => {
    expect(
      extractWorkTitle(normalizeTitle("Official Trailer Breakfast at Tiffany's 1961.mp4")),
    ).toBe("Breakfast at Tiffany's");
    expect(
      extractWorkTitle(normalizeTitle('My Movie Trailer 2024.mp4')),
    ).toBe('My Movie');
    expect(
      extractWorkTitle(normalizeTitle('Interview with Alice 2024.mp4')),
    ).toBe('Interview with Alice');
    expect(
      extractWorkTitle(normalizeTitle('Show.S01E03.720p.mkv')),
    ).toBe('Show');
  });
});

describe('analyzeTitleClues', () => {
  it('abstains on empty / generic / too-short titles', () => {
    expect(analyzeTitleClues('').abstained).toBe(true);
    expect(analyzeTitleClues('untitled.mp4').abstain_reason).toBe(
      'generic_title',
    );
    expect(analyzeTitleClues('ab').abstain_reason).toBe('too_short');
  });

  it('accepts a distinctive work title', () => {
    const clues = analyzeTitleClues("Breakfast at Tiffany's 1961 trailer.mp4");
    expect(clues.abstained).toBe(false);
    expect(clues.work_title).toContain('Breakfast');
    expect(clues.work_title.toLowerCase()).not.toContain('trailer');
  });
});

describe('suggestYearFromTitle', () => {
  it('extracts a single unambiguous year', () => {
    expect(suggestYearFromTitle('Breakfast at Tiffany\'s 1961 trailer')).toEqual(
      expect.objectContaining({ value: 1961, source: 'local_title' }),
    );
  });

  it('accepts parentheses years', () => {
    expect(suggestYearFromTitle('Oldboy (2003)')?.value).toBe(2003);
  });

  it('abstains when multiple distinct years appear', () => {
    expect(suggestYearFromTitle('Best of 1999 vs 2001')).toBeNull();
  });

  it('allows the same year repeated', () => {
    expect(suggestYearFromTitle('Show 2020 2020 recap')?.value).toBe(2020);
  });

  it('ignores out-of-range or non-year digit runs', () => {
    expect(suggestYearFromTitle('clip_12345_final')).toBeNull();
    expect(suggestYearFromTitle('file 1789')).toBeNull();
  });
});

describe('suggestVideoTypeFromTitle', () => {
  it('matches trailer / interview tokens', () => {
    expect(suggestVideoTypeFromTitle('Official Trailer HD')?.value).toBe(
      'trailer',
    );
    expect(suggestVideoTypeFromTitle('Cast Interview 2024')?.value).toBe(
      'interview',
    );
  });

  it('prefers trailer over movie when both match', () => {
    expect(suggestVideoTypeFromTitle('My Movie Trailer 2024')?.value).toBe(
      'trailer',
    );
  });

  it('matches SxxExx as tv_episode', () => {
    expect(suggestVideoTypeFromTitle('Show.S01E03.720p')?.value).toBe(
      'tv_episode',
    );
  });

  it('abstains on conflicting file-level type tokens', () => {
    expect(suggestVideoTypeFromTitle('trailer interview mix')).toBeNull();
  });

  it('does not invent a type from an ordinary title', () => {
    expect(suggestVideoTypeFromTitle('Breakfast at Tiffany\'s')).toBeNull();
  });
});

describe('suggestLanguageFromMediaTag', () => {
  it('labels caller-supplied language as caller_hint', () => {
    const hint = suggestLanguageFromMediaTag('zh-hans');
    expect(hint?.value).toBe('zh-Hans');
    expect(hint?.source).toBe('caller_hint');
    expect(hint?.confidence).toBeLessThan(0.5);
  });

  it('labels verified media tags separately', () => {
    const tag = suggestLanguageFromMediaTag('en', { verified: true });
    expect(tag?.source).toBe('media_tag');
    expect(tag?.confidence).toBe(0.7);
  });

  it('returns null for empty or unknown tags', () => {
    expect(suggestLanguageFromMediaTag(null)).toBeNull();
    expect(suggestLanguageFromMediaTag('')).toBeNull();
    expect(suggestLanguageFromMediaTag('xx-YY')).toBeNull();
  });

  it('never invents language from title alone', () => {
    const result = buildLocalSuggestions({
      title: 'Korean drama trailer 2020',
    });
    expect(result.suggestions.primary_language).toBeUndefined();
    expect(result.suggestions.year?.value).toBe(2020);
    expect(result.suggestions.video_type?.value).toBe('trailer');
  });
});

describe('title-clue description / tags (Phase 4b local)', () => {
  it('keeps the caveat in evidence, not the indexed value', () => {
    const clues = analyzeTitleClues("Breakfast at Tiffany's 1961 trailer");
    const desc = suggestDescriptionFromTitle(clues, 'en');
    expect(desc?.value).toMatch(/^Title clue:/);
    expect(desc?.value).not.toMatch(/does not claim scenes|dialogue|cast/i);
    expect(desc?.evidence).toMatch(/does not claim scenes/i);
  });

  it('localizes description for zh', () => {
    const clues = analyzeTitleClues('旧爱 1961 trailer');
    const desc = suggestDescriptionFromTitle(clues, 'zh');
    expect(desc?.value).toContain('标题线索');
    expect(desc?.value).not.toContain('不表示本文件');
    expect(desc?.evidence).toContain('不表示本文件');
  });

  it('abstains description for generic titles', () => {
    const clues = analyzeTitleClues('video.mp4');
    expect(suggestDescriptionFromTitle(clues)).toBeNull();
    expect(suggestAbstractFromTitle(clues)).toBeNull();
  });

  it('suggests tags only from explicit tokens', () => {
    const tags = suggestTagsFromTitle('Official Trailer 2020');
    expect(tags?.value).toEqual(expect.arrayContaining(['trailer', '2020']));
    expect(suggestTagsFromTitle('Breakfast at Tiffany\'s')).toBeNull();
  });

  it('omits fields already filled in the draft', () => {
    const result = buildLocalSuggestions({
      title: 'Official Trailer 2020 Unique Work',
      draft: {
        year: 2019,
        video_type: null,
        description: 'already written',
        tags: null,
      },
      media_language: 'en',
      locale: 'en',
    });
    expect(result.suggestions.year).toBeUndefined();
    expect(result.suggestions.video_type?.value).toBe('trailer');
    expect(result.suggestions.description).toBeUndefined();
    expect(result.suggestions.tags?.value).toEqual(
      expect.arrayContaining(['trailer', '2020']),
    );
    expect(result.suggestions.primary_language?.value).toBe('en');
    expect(result.suggestions.primary_language?.source).toBe('caller_hint');
    expect(result.title_clues.abstained).toBe(false);
  });

  it('returns empty suggestions for a bare generic title', () => {
    const result = buildLocalSuggestions({ title: 'untitled clip' });
    expect(result.suggestions).toEqual({});
    expect(result.title_clues.abstained).toBe(true);
  });
});
