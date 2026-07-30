import { describe, expect, it } from 'vitest';

import { getDashboardIdentity } from '../../../src/dashboard/server/identity.js';

describe('dashboard health identity', () => {
  it('identifies the serving process alongside the repository and mode', () => {
    const identity = getDashboardIdentity();

    expect(identity).toMatchObject({
      repoRoot: process.cwd(),
      mode: expect.stringMatching(/^(primary|peer)$/),
    });
    expect(identity.pid).toBe(process.pid);
  });
});
