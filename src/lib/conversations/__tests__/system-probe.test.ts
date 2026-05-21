import { beforeEach, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { layer as NodeServicesLayer } from '@effect/platform-node/NodeServices';
import { resetSystemCapabilitiesCache, getSystemCapabilities } from '../system-probe.js';

beforeEach(() => {
  resetSystemCapabilitiesCache();
});

it.layer(NodeServicesLayer)('system-probe', (it) => {
  it.effect('returns SystemCapabilities with all four fields populated', () =>
    Effect.gen(function* () {
      const caps = yield* getSystemCapabilities();
      expect(caps.cpuCores).toBeGreaterThan(0);
      expect(['ssd', 'hdd', 'unknown']).toContain(caps.driveType);
      expect(caps.driveReadMBps).toBeGreaterThanOrEqual(0);
      expect(caps.availableMemoryMB).toBeGreaterThan(0);
      expect(caps.recommendedParallelism).toBeGreaterThan(0);
    }),
  );

  it.effect('recommendedParallelism follows spec table', () =>
    Effect.gen(function* () {
      const caps = yield* getSystemCapabilities();
      const { cpuCores, driveType, recommendedParallelism } = caps;
      if (driveType === 'ssd') {
        expect(recommendedParallelism).toBe(Math.min(cpuCores, 16));
      } else if (driveType === 'hdd') {
        expect(recommendedParallelism).toBe(2);
      } else {
        expect(recommendedParallelism).toBe(4);
      }
    }),
  );

  it.effect('scanMaxParallel config override takes precedence over probe result', () =>
    Effect.gen(function* () {
      const caps = yield* getSystemCapabilities(7);
      expect(caps.recommendedParallelism).toBe(7);
    }),
  );

  it.effect('caches result — second call returns same object', () =>
    Effect.gen(function* () {
      const a = yield* getSystemCapabilities();
      const b = yield* getSystemCapabilities();
      expect(b).toBe(a); // same reference = cached
    }),
  );

  it.effect('resetSystemCapabilitiesCache clears the cache', () =>
    Effect.gen(function* () {
      const a = yield* getSystemCapabilities();
      resetSystemCapabilitiesCache();
      const b = yield* getSystemCapabilities();
      // Should be a different object (re-probed), but same shape
      expect(b.cpuCores).toBe(a.cpuCores);
      expect(b).not.toBe(a);
    }),
  );

  it.effect('does not throw on any platform', () =>
    Effect.gen(function* () {
      const caps = yield* getSystemCapabilities();
      expect(caps).toBeDefined();
    }),
  );
});
