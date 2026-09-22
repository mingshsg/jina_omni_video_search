/**
 * Parse live duration tokens (`24h`, `30m`, …) used by LIVE_SEARCH_MAX_RANGE
 * and request window validation.
 */

export function durationTokenToMs(token: string): number {
  const raw = token.trim().toLowerCase();
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(raw);
  if (!m) {
    throw new Error(`Invalid duration token: ${token}`);
  }
  const n = Number(m[1]);
  const unit = m[2]!;
  switch (unit) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default: {
      const _exhaustive: never = unit as never;
      return _exhaustive;
    }
  }
}
