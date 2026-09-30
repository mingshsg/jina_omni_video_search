import { describe, expect, it } from 'vitest';
import {
  createGroupAvailabilityLoader,
  type GroupAvailabilityLoadState,
} from './group-availability-load';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('createGroupAvailabilityLoader', () => {
  it('ignores an older response after a new selection succeeds', async () => {
    const updates: GroupAvailabilityLoadState<string>[] = [];
    const loader = createGroupAvailabilityLoader<string>((state) => updates.push(state));
    const oldRequest = deferred<string>();
    const newRequest = deferred<string>();
    const oldLoad = loader.load(() => oldRequest.promise);
    const newLoad = loader.load(() => newRequest.promise);

    newRequest.resolve('new selection');
    await newLoad;
    oldRequest.resolve('old selection');
    await oldLoad;

    expect(updates).toEqual([
      { status: 'loading' },
      { status: 'loading' },
      { status: 'ready', data: 'new selection' },
    ]);
  });

  it('ignores an older rejection after a new selection succeeds', async () => {
    const updates: GroupAvailabilityLoadState<string>[] = [];
    const loader = createGroupAvailabilityLoader<string>((state) => updates.push(state));
    const oldRequest = deferred<string>();
    const newRequest = deferred<string>();
    const oldLoad = loader.load(() => oldRequest.promise);
    const newLoad = loader.load(() => newRequest.promise);

    newRequest.resolve('new selection');
    await newLoad;
    oldRequest.reject(new Error('old request failed'));
    await oldLoad;

    expect(updates.at(-1)).toEqual({ status: 'ready', data: 'new selection' });
  });

  it('does not publish after unmount invalidates a request', async () => {
    const updates: GroupAvailabilityLoadState<string>[] = [];
    const loader = createGroupAvailabilityLoader<string>((state) => updates.push(state));
    const request = deferred<string>();
    const load = loader.load(() => request.promise);
    loader.invalidate();
    request.resolve('late');
    await load;
    expect(updates).toEqual([{ status: 'loading' }]);
  });
});
