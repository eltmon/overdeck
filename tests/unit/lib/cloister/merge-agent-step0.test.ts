import { describe, expect, it, vi } from 'vitest';

import { shouldRestartForPostMerge } from '../../../../src/lib/cloister/merge-agent-step0.js';
import type { BuildStaleness } from '../../../../src/lib/deploy/staleness.js';

function recordIntentMock() {
  return vi.fn(async () => ({
    requestedAt: '2026-07-26T12:00:00.000Z',
    requestedBy: ['merge-step0'],
    lastReason: 'blocked',
    blockedBy: ['PAN-1'],
    deferralCount: 1,
    escalated: false,
  }));
}

function staleness(status: BuildStaleness['status']): BuildStaleness {
  return {
    status,
    buildCommit: 'build-sha',
    originMainSha: 'origin-sha',
    behindTotal: status === 'fresh' ? 0 : 2,
    behindBuildInputs: status === 'fresh' ? 0 : 1,
    originMainLastCommitAt: 1_710_000_000_000,
    originMainLastBuildInputCommitAt: 1_710_000_000_000,
    computedAt: 1_752_580_800_000,
    ...(status === 'unknown' ? { reason: 'legacy unstamped build' } : {}),
  };
}

describe('postMergeLifecycle Step 0 deploy gating', () => {
  it('skips the restart for a fresh build so lifecycle work can continue in-process', async () => {
    const log = vi.fn();
    const recordIntent = recordIntentMock();
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('fresh'),
      getWindowAssessment: vi.fn(),
      recordIntent,
      log,
    })).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(
      'Running build already contains origin/main build inputs — skipping deploy restart',
    );
    expect(recordIntent).not.toHaveBeenCalled();
  });

  it('defers a stale build and registers deploy intent when the window is unsafe', async () => {
    const log = vi.fn();
    const recordIntent = recordIntentMock();
    const reason = 'Deployment deferred because a merge specialist session is active.';
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('stale'),
      getWindowAssessment: async () => ({ reason }),
      recordIntent,
      log,
    })).resolves.toBe(false);
    expect(recordIntent).toHaveBeenCalledWith({
      requestedBy: 'merge-step0',
      reason,
      blockedBy: [],
    });
    expect(log).toHaveBeenCalledWith(
      `Deploy window unsafe (${reason}) — deferring deploy to the staleness patrol`,
    );
  });

  it('preserves the detached restart path for a stale build when the window is clear', async () => {
    const recordIntent = recordIntentMock();
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('stale'),
      getWindowAssessment: async () => ({ reason: null }),
      recordIntent,
    })).resolves.toBe(true);
    expect(recordIntent).not.toHaveBeenCalled();
  });

  it('defers an unknown legacy build when the deploy window is unsafe', async () => {
    const reason = 'Deployment deferred because the post-merge lifecycle is pending.';
    const recordIntent = recordIntentMock();
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('unknown'),
      getWindowAssessment: async () => ({ reason }),
      recordIntent,
    })).resolves.toBe(false);
    expect(recordIntent).toHaveBeenCalledWith({
      requestedBy: 'merge-step0',
      reason,
      blockedBy: [],
    });
  });

  it('preserves the existing restart behavior for an unknown legacy build when the window is clear', async () => {
    const recordIntent = recordIntentMock();
    await expect(shouldRestartForPostMerge('/repo', {
      computeStaleness: async () => staleness('unknown'),
      getWindowAssessment: async () => ({ reason: null }),
      recordIntent,
    })).resolves.toBe(true);
    expect(recordIntent).not.toHaveBeenCalled();
  });
});
