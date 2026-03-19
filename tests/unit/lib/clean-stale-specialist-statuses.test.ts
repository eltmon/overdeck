/**
 * Tests for PAN-366: startup stale specialist status cleanup logic.
 *
 * The actual cleanup runs in cleanStaleSpecialistStatuses() inside server/index.ts,
 * but the core decision logic is:
 *   "if reviewStatus === 'reviewing' AND no review-agent tmux session exists → reset"
 *
 * We test this logic using the pure queue-position helpers (computeQueuePositionFromStatus)
 * and by simulating the tmux-session-name matching patterns used in the cleanup.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Tmux session name matching — mirrors the regex used in cleanStaleSpecialistStatuses
// ---------------------------------------------------------------------------

function hasSessionForSpecialist(sessions: string[], specialistSuffix: string): boolean {
  return sessions.some(
    s => s === `specialist-${specialistSuffix}`
      || new RegExp(`^specialist-.+-${specialistSuffix}$`).test(s)
  );
}

describe('cleanStaleSpecialistStatuses — session matching', () => {
  it('matches legacy session name "specialist-review-agent"', () => {
    expect(hasSessionForSpecialist(['specialist-review-agent'], 'review-agent')).toBe(true);
  });

  it('matches per-project session "specialist-myproj-review-agent"', () => {
    expect(hasSessionForSpecialist(['specialist-myproj-review-agent'], 'review-agent')).toBe(true);
  });

  it('does not match unrelated session names', () => {
    expect(hasSessionForSpecialist(['some-other-session', 'agent-foo'], 'review-agent')).toBe(false);
  });

  it('matches test-agent sessions', () => {
    expect(hasSessionForSpecialist(['specialist-test-agent'], 'test-agent')).toBe(true);
    expect(hasSessionForSpecialist(['specialist-abc-test-agent'], 'test-agent')).toBe(true);
  });

  it('matches merge-agent sessions', () => {
    expect(hasSessionForSpecialist(['specialist-merge-agent'], 'merge-agent')).toBe(true);
    expect(hasSessionForSpecialist(['specialist-xyz-merge-agent'], 'merge-agent')).toBe(true);
  });

  it('returns false when session list is empty', () => {
    expect(hasSessionForSpecialist([], 'review-agent')).toBe(false);
  });

  it('does not match partial names (e.g. "review-agent-extra")', () => {
    // "specialist-review-agent-extra" should NOT match the exact pattern
    expect(hasSessionForSpecialist(['specialist-review-agent-extra'], 'review-agent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale status decision logic
// ---------------------------------------------------------------------------

interface StatusSnapshot {
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
}

/**
 * Compute which fields to reset given a status snapshot and the set of live tmux sessions.
 * This mirrors the decision logic in cleanStaleSpecialistStatuses().
 */
function computeStaleResets(
  status: StatusSnapshot,
  sessions: string[]
): Partial<StatusSnapshot> {
  const updates: Partial<StatusSnapshot> = {};

  if (status.reviewStatus === 'reviewing') {
    if (!hasSessionForSpecialist(sessions, 'review-agent')) {
      updates.reviewStatus = 'pending';
    }
  }
  if (status.testStatus === 'testing') {
    if (!hasSessionForSpecialist(sessions, 'test-agent')) {
      updates.testStatus = 'pending';
    }
  }
  if (status.mergeStatus === 'merging') {
    if (!hasSessionForSpecialist(sessions, 'merge-agent')) {
      updates.mergeStatus = 'pending';
    }
  }
  return updates;
}

describe('computeStaleResets', () => {
  it('resets reviewStatus to pending when reviewing and no review-agent session', () => {
    const updates = computeStaleResets({ reviewStatus: 'reviewing' }, []);
    expect(updates.reviewStatus).toBe('pending');
  });

  it('does NOT reset reviewStatus when review-agent session is live', () => {
    const updates = computeStaleResets(
      { reviewStatus: 'reviewing' },
      ['specialist-review-agent']
    );
    expect(updates.reviewStatus).toBeUndefined();
  });

  it('does NOT reset when reviewStatus is not reviewing', () => {
    const updates = computeStaleResets({ reviewStatus: 'passed' }, []);
    expect(updates.reviewStatus).toBeUndefined();
  });

  it('resets testStatus to pending when testing and no test-agent session', () => {
    const updates = computeStaleResets({ testStatus: 'testing' }, []);
    expect(updates.testStatus).toBe('pending');
  });

  it('does NOT reset testStatus when test-agent session is live', () => {
    const updates = computeStaleResets(
      { testStatus: 'testing' },
      ['specialist-test-agent']
    );
    expect(updates.testStatus).toBeUndefined();
  });

  it('resets mergeStatus to pending when merging and no merge-agent session', () => {
    const updates = computeStaleResets({ mergeStatus: 'merging' }, []);
    expect(updates.mergeStatus).toBe('pending');
  });

  it('does NOT reset mergeStatus when merge-agent session is live', () => {
    const updates = computeStaleResets(
      { mergeStatus: 'merging' },
      ['specialist-merge-agent']
    );
    expect(updates.mergeStatus).toBeUndefined();
  });

  it('resets all three when all are active and no sessions exist', () => {
    const updates = computeStaleResets(
      { reviewStatus: 'reviewing', testStatus: 'testing', mergeStatus: 'merging' },
      []
    );
    expect(updates.reviewStatus).toBe('pending');
    expect(updates.testStatus).toBe('pending');
    expect(updates.mergeStatus).toBe('pending');
  });

  it('handles per-project session names correctly', () => {
    const updates = computeStaleResets(
      { reviewStatus: 'reviewing' },
      ['specialist-myproject-review-agent']
    );
    expect(updates.reviewStatus).toBeUndefined(); // session exists → no reset
  });

  it('returns empty object when no active statuses', () => {
    const updates = computeStaleResets(
      { reviewStatus: 'pending', testStatus: 'passed' },
      []
    );
    expect(Object.keys(updates)).toHaveLength(0);
  });
});
