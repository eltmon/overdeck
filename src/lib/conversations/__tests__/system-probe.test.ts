import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { resetSystemCapabilitiesCache, getSystemCapabilities as getSystemCapabilitiesEff } from '../system-probe.js';

// Promise-returning shim so the existing async/await assertions keep working
// after the Effect migration (PAN-1249).
const getSystemCapabilities = (override?: number | null) =>
  Effect.runPromise(getSystemCapabilitiesEff(override));

beforeEach(() => {
  resetSystemCapabilitiesCache();
});

describe('system-probe', () => {
  it('returns SystemCapabilities with all four fields populated', async () => {
    const caps = await getSystemCapabilities();
    expect(caps.cpuCores).toBeGreaterThan(0);
    expect(['ssd', 'hdd', 'unknown']).toContain(caps.driveType);
    expect(caps.driveReadMBps).toBeGreaterThanOrEqual(0);
    expect(caps.availableMemoryMB).toBeGreaterThan(0);
    expect(caps.recommendedParallelism).toBeGreaterThan(0);
  });

  it('recommendedParallelism follows spec table', async () => {
    const caps = await getSystemCapabilities();
    const { cpuCores, driveType, recommendedParallelism } = caps;
    if (driveType === 'ssd') {
      expect(recommendedParallelism).toBe(Math.min(cpuCores, 16));
    } else if (driveType === 'hdd') {
      expect(recommendedParallelism).toBe(2);
    } else {
      expect(recommendedParallelism).toBe(4);
    }
  });

  it('scanMaxParallel config override takes precedence over probe result', async () => {
    const caps = await getSystemCapabilities(7);
    expect(caps.recommendedParallelism).toBe(7);
  });

  it('caches result — second call returns same object', async () => {
    const a = await getSystemCapabilities();
    const b = await getSystemCapabilities();
    expect(b).toBe(a); // same reference = cached
  });

  it('resetSystemCapabilitiesCache clears the cache', async () => {
    const a = await getSystemCapabilities();
    resetSystemCapabilitiesCache();
    const b = await getSystemCapabilities();
    // Should be a different object (re-probed), but same shape
    expect(b.cpuCores).toBe(a.cpuCores);
    expect(b).not.toBe(a);
  });

  it('does not throw on any platform', async () => {
    // Probe should never throw even on unsupported platforms
    await expect(getSystemCapabilities()).resolves.toBeDefined();
  });
});
