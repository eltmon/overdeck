import { describe, expect, it } from 'vitest';

import { shouldBlockApproveForDirtyStatus } from '../merge-ops.js';

describe('shouldBlockApproveForDirtyStatus', () => {
  it('returns false when approve sees only state-plane paths', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M .pan/test/result.json',
    ].join('\n');

    expect(shouldBlockApproveForDirtyStatus(status)).toBe(false);
  });

  it('returns true when approve sees a dirty source path', () => {
    expect(shouldBlockApproveForDirtyStatus(' M src/foo.ts\n')).toBe(true);
  });

  it('returns true for mixed state-plane and source dirt', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M src/foo.ts',
    ].join('\n');

    expect(shouldBlockApproveForDirtyStatus(status)).toBe(true);
  });
});
