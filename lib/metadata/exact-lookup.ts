/**
 * Pure rules for the Group control's exact-name lookup (todo/40 R5).
 *
 * Two defects are fixed here:
 * 1. A late response must never repopulate the options after the input was
 *    cleared or changed — every input change invalidates the in-flight
 *    request by advancing the sequence.
 * 2. The lookup must not fire a full enumeration on every keystroke — names
 *    below the minimum length clear instead of querying, and longer names are
 *    debounced by the caller.
 *
 * Pure module (no React, no timers) so it is covered by the `lib/**` Vitest
 * include and the component only has to schedule the debounce.
 */

/** Debounce before an exact-name lookup is sent. */
export const EXACT_LOOKUP_DEBOUNCE_MS = 300;
/** Shortest name that can be resolved server-side. */
export const EXACT_LOOKUP_MIN_LENGTH = 2;
/** Shortest name that earns a "no match" hint (avoids a hint mid-typing). */
export const EXACT_LOOKUP_MISS_MIN_LENGTH = 3;

export type ExactLookupPlan =
  | { action: 'none' }
  /** Invalidate any in-flight request and clear the lookup options. */
  | { action: 'clear' }
  /** Invalidate the old request, then query `name` after `delayMs`. */
  | { action: 'debounce'; name: string; seq: number; delayMs: number };

/**
 * Decide what an input change should do. The caller advances its own sequence
 * counter to `seq` *before* acting, which is what invalidates an in-flight
 * response no matter which action is chosen.
 */
export function planExactLookup(params: {
  raw: string;
  seq: number;
  debounceMs?: number;
}): ExactLookupPlan {
  const name = params.raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < EXACT_LOOKUP_MIN_LENGTH) return { action: 'clear' };
  return {
    action: 'debounce',
    name,
    seq: params.seq,
    delayMs: params.debounceMs ?? EXACT_LOOKUP_DEBOUNCE_MS,
  };
}

/** True when `seq` has been superseded and its response must be discarded. */
export function isStaleExactLookup(seq: number, currentSeq: number): boolean {
  return seq !== currentSeq;
}

/**
 * The no-match hint text, or null. Only shown for a resolved lookup that
 * returned nothing and only for names long enough to be a real attempt.
 */
export function lookupMissName(
  name: string,
  matches: Array<{ id: string }>,
): string | null {
  return matches.length === 0 && name.length >= EXACT_LOOKUP_MISS_MIN_LENGTH
    ? name
    : null;
}

const normalizeLookup = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export function groupLookupMatches<T extends { id: string; label: string }>(name: string, entries: T[], exact = false): T[] {
  const needle = normalizeLookup(name);
  if (!needle) return [];
  return entries.filter((entry) => [entry.id, entry.label].some((value) =>
    exact ? normalizeLookup(value) === needle : normalizeLookup(value).includes(needle)));
}
