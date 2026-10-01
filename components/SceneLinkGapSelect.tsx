'use client';

import { EuiFormRow, EuiIconTip, EuiSelect } from '@elastic/eui';
import { SCENE_LINK_GAP_CHOICES_S } from '@/lib/es/group-hits';
import { useLocale } from '@/lib/i18n/locale-context';

/** Chosen gap (ms) for chaining matching moments into one scene. */
export function SceneLinkGapSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (gapMs: number) => void;
}) {
  const { t } = useLocale();
  return (
    <EuiFormRow
      label={
        <>
          {t.sceneLinkLabel}{' '}
          <EuiIconTip type="question" color="subdued" content={t.sceneLinkHelp} position="top" />
        </>
      }
    >
      <EuiSelect
        options={SCENE_LINK_GAP_CHOICES_S.map((s) => ({
          value: String(s * 1000),
          text: s === 0 ? t.sceneLinkTouching : t.sceneLinkGap.replace('{s}', String(s)),
        }))}
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t.sceneLinkLabel}
      />
    </EuiFormRow>
  );
}
