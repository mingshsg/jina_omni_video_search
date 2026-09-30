import { describe, expect, it } from 'vitest';
import { workTitleTooltipLines } from './work-title-display';

describe('workTitleTooltipLines', () => {
  it('returns English only when that is all that is stored', () => {
    expect(workTitleTooltipLines({ en: 'Empresses in the Palace' })).toEqual([
      'Empresses in the Palace',
    ]);
  });

  it('returns English then Chinese, in that stable order', () => {
    expect(
      workTitleTooltipLines({ en: 'Empresses in the Palace', zh: '甄嬛传' }),
    ).toEqual(['Empresses in the Palace', '甄嬛传']);
  });

  it('appends the native name with its language code', () => {
    expect(
      workTitleTooltipLines({
        en: 'Empresses in the Palace',
        zh: '甄嬛传',
        native: { lang: 'zh-Hans', name: '后宫·甄嬛传' },
      }),
    ).toEqual(['Empresses in the Palace', '甄嬛传', '后宫·甄嬛传 (zh-Hans)']);
  });

  it('omits blank variants instead of rendering empty lines', () => {
    expect(workTitleTooltipLines({ en: 'Only English', zh: '   ' })).toEqual([
      'Only English',
    ]);
    expect(
      workTitleTooltipLines({ en: 'Only English', native: { lang: 'ko', name: '' } }),
    ).toEqual(['Only English']);
  });

  it('renders a native name without a language as the bare name', () => {
    expect(
      workTitleTooltipLines({ en: 'A Work', native: { lang: '  ', name: '본명' } }),
    ).toEqual(['A Work', '본명']);
  });

  it('returns no lines when there is no work_title (tooltip stays off)', () => {
    expect(workTitleTooltipLines(undefined)).toEqual([]);
    expect(workTitleTooltipLines(null)).toEqual([]);
    expect(workTitleTooltipLines({} as never)).toEqual([]);
  });
});
