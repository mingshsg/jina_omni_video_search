/**
 * Back-compat surface for the primary Group control helpers. The
 * implementation now lives in `group-availability-ui.ts` (which also owns the
 * G1 availability/cap logic); this module re-exports so existing imports keep
 * working.
 */
export {
  GROUP_SELECTION_LIMIT,
  capGroupSelection,
  selectedSearchGroupIds,
} from './group-availability-ui';
