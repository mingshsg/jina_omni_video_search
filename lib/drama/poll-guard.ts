/** Reject out-of-order reads and pre-retry snapshots without stopping polling. */
export function createDramaPollGuard() {
  let sequence = 0;
  let expectedRunId: string | undefined;
  return {
    begin: () => ++sequence,
    invalidate: () => { sequence += 1; },
    acceptRun: (runId: string | undefined) => { sequence += 1; expectedRunId = runId; },
    isCurrent: (ticket: number) => ticket === sequence,
    accept: (ticket: number, runId: string | undefined): boolean => {
      if (ticket !== sequence || (expectedRunId && expectedRunId !== runId)) return false;
      expectedRunId = undefined;
      return true;
    },
  };
}
