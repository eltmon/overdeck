// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { readRunningBuildCommit } from '../../../../src/lib/deploy/running-boot-gates.js';

describe('readRunningBuildCommit (PAN-4888)', () => {
  it('returns the commit the running dashboard reports', async () => {
    const fetchHealth = vi.fn(async () => ({ ok: true, buildCommit: ' 530ee175e8c1d2e3 \n' }));

    await expect(readRunningBuildCommit(3011, { fetchHealth })).resolves.toBe('530ee175e8c1d2e3');
    expect(fetchHealth).toHaveBeenCalledWith('http://127.0.0.1:3011/api/health', 3_000);
  });

  it('returns null when the health read throws', async () => {
    const fetchHealth = vi.fn(async () => { throw new Error('no answer within 3000ms'); });

    await expect(readRunningBuildCommit(3011, { fetchHealth })).resolves.toBeNull();
  });

  it('returns null when buildCommit is missing', async () => {
    const fetchHealth = vi.fn(async () => ({ ok: true }));

    await expect(readRunningBuildCommit(3011, { fetchHealth })).resolves.toBeNull();
  });
});
