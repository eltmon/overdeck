import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMemoryThresholds } from '../env-loader.js';

const GB = 1024 ** 3;

describe('getMemoryThresholds', () => {
  let originalWarn: string | undefined;
  let originalBlock: string | undefined;

  beforeEach(() => {
    originalWarn = process.env.PAN_MEMORY_WARN_GB;
    originalBlock = process.env.PAN_MEMORY_BLOCK_GB;
    delete process.env.PAN_MEMORY_WARN_GB;
    delete process.env.PAN_MEMORY_BLOCK_GB;
  });

  afterEach(() => {
    if (originalWarn === undefined) {
      delete process.env.PAN_MEMORY_WARN_GB;
    } else {
      process.env.PAN_MEMORY_WARN_GB = originalWarn;
    }
    if (originalBlock === undefined) {
      delete process.env.PAN_MEMORY_BLOCK_GB;
    } else {
      process.env.PAN_MEMORY_BLOCK_GB = originalBlock;
    }
  });

  it('returns defaults of 4GB warn and 2GB block when env vars not set', () => {
    const { warnBytes, blockBytes } = getMemoryThresholds();
    expect(warnBytes).toBe(4 * GB);
    expect(blockBytes).toBe(2 * GB);
  });

  it('reads PAN_MEMORY_WARN_GB from environment', () => {
    process.env.PAN_MEMORY_WARN_GB = '8';
    const { warnBytes } = getMemoryThresholds();
    expect(warnBytes).toBe(8 * GB);
  });

  it('reads PAN_MEMORY_BLOCK_GB from environment', () => {
    process.env.PAN_MEMORY_BLOCK_GB = '1';
    const { blockBytes } = getMemoryThresholds();
    expect(blockBytes).toBe(1 * GB);
  });

  it('supports fractional GB values', () => {
    process.env.PAN_MEMORY_WARN_GB = '2.5';
    const { warnBytes } = getMemoryThresholds();
    expect(warnBytes).toBe(2.5 * GB);
  });

  it('falls back to defaults for non-numeric values', () => {
    process.env.PAN_MEMORY_WARN_GB = 'invalid';
    process.env.PAN_MEMORY_BLOCK_GB = 'bad';
    const { warnBytes, blockBytes } = getMemoryThresholds();
    expect(warnBytes).toBe(4 * GB);
    expect(blockBytes).toBe(2 * GB);
  });
});
