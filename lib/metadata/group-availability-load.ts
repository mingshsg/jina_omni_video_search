/** A state update for the latest Group availability request. */
export type GroupAvailabilityLoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed' };

/**
 * Run Group availability requests with latest-request-wins semantics. A
 * previous response or rejection cannot publish after a newer selection or
 * locale starts loading. `invalidate` also protects against updates after the
 * component unmounts.
 */
export function createGroupAvailabilityLoader<T>(
  publish: (state: GroupAvailabilityLoadState<T>) => void,
) {
  let sequence = 0;
  return {
    async load(request: () => Promise<T>): Promise<void> {
      const current = ++sequence;
      publish({ status: 'loading' });
      try {
        const data = await request();
        if (current === sequence) publish({ status: 'ready', data });
      } catch {
        if (current === sequence) publish({ status: 'failed' });
      }
    },
    invalidate(): void {
      sequence += 1;
    },
  };
}
