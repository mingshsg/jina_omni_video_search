/** Empty selection means All groups. Choosing All clears any selected groups. */
export function selectedSearchGroupIds(
  options: Array<{ label: string; value?: string | number | string[] | null }>,
): string[] {
  if (options.some((option) => option.value === '')) return [];
  return [...new Set(options.map((option) => String(option.value ?? option.label)))];
}
