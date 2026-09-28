'use client';

import {
  EuiComboBox,
  type EuiComboBoxOptionOption,
} from '@elastic/eui';

type Props = {
  options: EuiComboBoxOptionOption[];
  selectedOptions: EuiComboBoxOptionOption[];
  onChange: (opts: EuiComboBoxOptionOption[]) => void;
  onCreateOption: (searchValue: string) => boolean;
  placeholder: string;
  'aria-label': string;
  isDisabled?: boolean;
  compressed?: boolean;
  fullWidth?: boolean;
  helpTextAsPlaceholder?: boolean;
};

/**
 * Creatable single-select for free-form index groups.
 * Must be loaded with `next/dynamic(..., { ssr: false })` — EuiComboBox
 * touches DOM constructors during render.
 */
export function CreatableGroupCombo({
  options,
  selectedOptions,
  onChange,
  onCreateOption,
  placeholder,
  'aria-label': ariaLabel,
  isDisabled,
  compressed,
  fullWidth,
}: Props) {
  return (
    <EuiComboBox
      placeholder={placeholder}
      singleSelection={{ asPlainText: true }}
      options={options}
      selectedOptions={selectedOptions}
      onChange={(opts) => onChange(opts.slice(0, 1))}
      onCreateOption={onCreateOption}
      isClearable
      isDisabled={isDisabled}
      compressed={compressed}
      fullWidth={fullWidth}
      aria-label={ariaLabel}
    />
  );
}
