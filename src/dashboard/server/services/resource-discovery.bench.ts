import { performance } from 'node:perf_hooks';

import { bench, describe, expect, it } from 'vitest';

import { discoverResourceAllocatedIssuesFresh } from './resource-discovery.js';

const DISCOVERY_TARGET_MS = 1_000;

/**
 * PAN-862 acceptance evidence.
 *
 * Target from review / PRD: discovery completes in < 1s for the current workload
 * (28 worktrees, 124 branches). This file now provides both a benchmark for local
 * profiling and a CI-visible assertion that fails if the uncached path exceeds the
 * accepted threshold.
 *
 * Recommended invocation:
 *   npx vitest bench src/dashboard/server/services/resource-discovery.bench.ts
 *   npx vitest run src/dashboard/server/services/resource-discovery.bench.ts
 */
const isBenchmarkMode = process.argv.some((arg) => arg === 'bench' || arg === '--bench');

describe('discoverResourceAllocatedIssuesFresh', () => {
  it(`completes a full uncached discovery pass in under ${DISCOVERY_TARGET_MS}ms`, async () => {
    // Prime long-lived singleton dependencies (issue service, module init, V8 JIT)
    // outside the measurement window. The assertion is meant to guard the steady-
    // state request path, not one-time process bootstrap cost.
    await discoverResourceAllocatedIssuesFresh();

    const startedAt = performance.now();
    await discoverResourceAllocatedIssuesFresh();
    const durationMs = performance.now() - startedAt;

    expect(durationMs).toBeLessThan(DISCOVERY_TARGET_MS);
  });

  if (isBenchmarkMode) {
    bench('completes a full uncached discovery pass', async () => {
      await discoverResourceAllocatedIssuesFresh();
    });
  }
});
