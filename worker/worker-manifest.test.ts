import { describe, expect, it } from 'vitest';
import { emptyWorkerManifest } from '../lib/live/worker-manifest';

describe('worker manifest scaffold', () => {
  it('records schema and node version', () => {
    const m = emptyWorkerManifest('v22.0.0');
    expect(m.schema_version).toBe(1);
    expect(m.node_version).toBe('v22.0.0');
  });
});
