import { describe, expect, it, vi } from 'vitest';

import { patrolResourcePressure } from '../../../../src/lib/cloister/resource-pressure-patrol.js';

describe('resource-pressure-patrol', () => {
  it('runs memory and disk checks in the same patrol', async () => {
    const patrolMemory = vi.fn().mockResolvedValue(['memory action']);
    const patrolDisk = vi.fn().mockResolvedValue(['disk action']);

    await expect(patrolResourcePressure({ patrolMemory, patrolDisk })).resolves.toEqual([
      'memory action',
      'disk action',
    ]);
    expect(patrolMemory).toHaveBeenCalledOnce();
    expect(patrolDisk).toHaveBeenCalledOnce();
  });

  it('still returns the disk result when the memory check fails', async () => {
    const actions = await patrolResourcePressure({
      patrolMemory: async () => { throw new Error('memory probe failed'); },
      patrolDisk: async () => ['disk action'],
    });

    expect(actions).toEqual([
      'memory-pressure-patrol: error: memory probe failed',
      'disk action',
    ]);
  });
});
