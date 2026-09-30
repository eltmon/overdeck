import { describe, expect, it } from 'vitest';
import { checkDiskFloor, DISK_SAFETY_FLOOR_BYTES } from '../disk-floor.js';
import { DISK_PRUNE_TRIGGER_BYTES } from '../cloister/disk-pressure-patrol.js';

const GIB = 1024 ** 3;

describe('checkDiskFloor', () => {
  it('returns error text containing "10.0 GiB" when below the floor (AC1)', async () => {
    const error = await checkDiskFloor('/some/path', async () => 5 * GIB);

    expect(error).toContain('10.0 GiB');
  });

  it('returns null at or above the floor (AC2)', async () => {
    expect(await checkDiskFloor('/some/path', async () => DISK_SAFETY_FLOOR_BYTES)).toBeNull();
    expect(await checkDiskFloor('/some/path', async () => 20 * GIB)).toBeNull();
  });

  it('returns null when the reader throws (AC3)', async () => {
    const error = await checkDiskFloor('/some/path', async () => {
      throw new Error('statfs failed');
    });

    expect(error).toBeNull();
  });

  it('matches the disk-pressure-patrol trigger constant (AC4)', () => {
    expect(DISK_SAFETY_FLOOR_BYTES).toBe(DISK_PRUNE_TRIGGER_BYTES);
  });
});
