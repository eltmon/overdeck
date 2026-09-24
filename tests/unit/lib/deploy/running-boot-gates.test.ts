import { describe, expect, it, vi } from 'vitest';

import { readRunningDashboardBootGates } from '../../../../src/lib/deploy/running-boot-gates.js';

const OFF_BY_FLAG = {
  deacon: { enabled: false, source: 'flag' },
  resume: { enabled: false, source: 'flag' },
};

describe('readRunningDashboardBootGates (PAN-3899)', () => {
  it('returns the gates the running dashboard reports on /api/health', async () => {
    const fetchHealth = vi.fn(async () => ({ status: 'ok', pid: 42, bootGates: OFF_BY_FLAG }));
    const readEnviron = vi.fn();

    await expect(readRunningDashboardBootGates(3011, { fetchHealth, readEnviron })).resolves.toEqual(OFF_BY_FLAG);
    expect(fetchHealth).toHaveBeenCalledWith('http://127.0.0.1:3011/api/health');
    expect(readEnviron).not.toHaveBeenCalled();
  });

  it('falls back to the process env markers when the server predates bootGates', async () => {
    const environ = [
      'PATH=/usr/bin',
      'OVERDECK_DISABLE_DEACON=1',
      'OVERDECK_DEACON_GATE_SOURCE=flag',
      'OVERDECK_NO_RESUME=1',
      'OVERDECK_RESUME_GATE_SOURCE=flag',
      '',
    ].join('\0');
    const readEnviron = vi.fn(async () => environ);

    await expect(readRunningDashboardBootGates(3011, {
      fetchHealth: async () => ({ status: 'ok', pid: 42 }),
      readEnviron,
    })).resolves.toEqual(OFF_BY_FLAG);
    expect(readEnviron).toHaveBeenCalledWith(42);
  });

  it('returns null when no dashboard answers', async () => {
    await expect(readRunningDashboardBootGates(3011, {
      fetchHealth: async () => { throw new Error('ECONNREFUSED'); },
    })).resolves.toBeNull();
  });

  it('returns null when neither the health body nor the process env can be read', async () => {
    await expect(readRunningDashboardBootGates(3011, {
      fetchHealth: async () => ({ status: 'ok' }),
    })).resolves.toBeNull();
    await expect(readRunningDashboardBootGates(3011, {
      fetchHealth: async () => ({ status: 'ok', pid: 42 }),
      readEnviron: async () => { throw new Error('EACCES'); },
    })).resolves.toBeNull();
  });
});
