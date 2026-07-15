import { describe, expect, it, vi } from 'vitest';

import { shouldRestartForPostMerge } from '../../../../src/lib/cloister/merge-agent-step0.js';
import type { BuildStaleness } from '../../../../src/lib/deploy/staleness.js';

function staleness(status: BuildStaleness['status']): BuildStaleness {
  return {
    status,
    buildCommit: 'build-sha',
    originMainSha: 'origin-sha',
    behindTotal: status === 'fresh' ? 0 : 2,
    behindBuildInputs: status === 'fresh' ? 0 : 1,
    originMainLastCommitAt: 1_710_000_000_000,
    computedAt: 1_752_580_800_000,
    ...(status === 'unknown' ? { reason: 'legacy unstamped build' } : {}),
  };
}

describe('postMergeLifecycle Step 0 deploy gating', () => {
  it('skips the restart for a fresh build so lifecycle work can continue in-process', async () => {
    const log = vi.fn();
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('fresh'),
      getBlockReason: vi.fn(),
      log,
    })).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(
      'Running build already contains origin/main build inputs — skipping deploy restart',
    );
  });

  it('defers a stale build when the deploy window is unsafe', async () => {
    const log = vi.fn();
    const reason = 'Deployment deferred because verification is in flight for PAN-1.';
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('stale'),
      getBlockReason: async () => reason,
      log,
    })).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(
      `Deploy window unsafe (${reason}) — deferring deploy to the staleness patrol`,
    );
  });

  it('preserves the detached restart path for a stale build when the window is clear', async () => {
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('stale'),
      getBlockReason: async () => null,
    })).resolves.toBe(true);
  });

  it('defers an unknown legacy build when the deploy window is unsafe', async () => {
    const reason = 'Deployment deferred because flywheel run RUN-42 owns deployment.';
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('unknown'),
      getBlockReason: async () => reason,
    })).resolves.toBe(false);
  });

  it('preserves the existing restart behavior for an unknown legacy build when the window is clear', async () => {
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('unknown'),
      getBlockReason: async () => null,
    })).resolves.toBe(true);
  });
});
