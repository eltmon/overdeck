/**
 * Tests for PAN-344 / PAN-354: merge-stuck patrol check (notify-only, PAN-354).
 *
 * Coverage:
 *  1. checkReadyForMergeStuck notifies for a stuck issue older than 2 min
 *  2. checkReadyForMergeStuck skips issues where mergeStatus=merging
 *  3. checkReadyForMergeStuck skips issues where mergeStatus=merged
 *  4. checkReadyForMergeStuck skips issues where mergeStatus=failed
 *  5. Staleness check: status younger than 2 min is skipped
 *  6. Staleness check: missing updatedAt is skipped
 *  7. Circuit breaker stops notifying after MERGE_STUCK_MAX_ATTEMPTS (3)
 *
 * PAN-354: checkReadyForMergeStuck no longer auto-triggers the merge API.
 * Instead it calls the mergeReadyNotifier callback (set by the server layer)
 * so the dashboard can alert the user to click MERGE.
 *
 * The tests mock fs.existsSync and fs.readFileSync so they never touch
 * the real ~/.panopticon/review-status.json file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Derive the review-status file path that deacon.ts uses internally
// ---------------------------------------------------------------------------
const REVIEW_STATUS_PATH = join(homedir(), '.panopticon', 'review-status.json');

// ---------------------------------------------------------------------------
// Mutable test state — mutated in beforeEach, read via closure by the fs mock
// ---------------------------------------------------------------------------
let _statusData: Record<string, object> = {};
let _statusExists = true;

// ---------------------------------------------------------------------------
// Mock fs BEFORE any module that imports it is loaded.
// We intercept existsSync and readFileSync only for the review-status path;
// all other paths fall through to the real fs implementation.
// ---------------------------------------------------------------------------
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (p === REVIEW_STATUS_PATH) return _statusExists;
      return actual.existsSync(p);
    }),
    readFileSync: vi.fn((p: string, enc?: any) => {
      if (p === REVIEW_STATUS_PATH) return JSON.stringify(_statusData);
      return actual.readFileSync(p, enc);
    }),
    // writeFileSync is a no-op for the review-status path; other paths pass through
    writeFileSync: vi.fn((p: string, data: any, enc?: any) => {
      if (p === REVIEW_STATUS_PATH) return; // discard — tests don't need write-back
      actual.writeFileSync(p, data, enc);
    }),
  };
});

// ---------------------------------------------------------------------------
// Mock heavy deacon dependencies that aren't under test
// ---------------------------------------------------------------------------
vi.mock('../../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn(),
  initializeSpecialist: vi.fn(),
  wakeSpecialist: vi.fn(),
  clearSessionId: vi.fn(),
  checkSpecialistQueue: vi.fn().mockReturnValue({ hasWork: false }),
  getNextSpecialistTask: vi.fn(),
  wakeSpecialistWithTask: vi.fn(),
  completeSpecialistTask: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn().mockReturnValue([]),
  getAgentDir: vi.fn(),
  getAgentState: vi.fn(),
  saveAgentState: vi.fn(),
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn().mockReturnValue(false),
  sendKeysAsync: vi.fn(),
}));

// Import after mocks are in place
import { checkReadyForMergeStuck, setMergeReadyNotifier } from '../../../../src/lib/cloister/deacon.js';

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------
const NOW = Date.now();
const THREE_MIN_AGO = new Date(NOW - 3 * 60 * 1000).toISOString();
const ONE_MIN_AGO  = new Date(NOW - 1 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkReadyForMergeStuck', () => {
  const mockNotifier = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    _statusData = {};
    _statusExists = true;
    // Register a mock notifier so we can verify notify-only behavior (PAN-354)
    setMergeReadyNotifier(mockNotifier);
  });

  it('notifies for a stuck readyForMerge issue older than 2 min (no auto-merge, PAN-354)', async () => {
    _statusData = {
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: THREE_MIN_AGO,
      },
    };

    const actions = await checkReadyForMergeStuck();

    // Must notify via callback, not by calling the merge API
    expect(mockNotifier).toHaveBeenCalledOnce();
    expect(mockNotifier).toHaveBeenCalledWith('PAN-344');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toContain('PAN-344');
  });

  it('skips an issue where mergeStatus is already "merging"', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'merging', updatedAt: THREE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue where mergeStatus is already "merged"', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'merged', updatedAt: THREE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue with mergeStatus=failed', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'failed', updatedAt: THREE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue whose readyForMerge status is younger than 2 min', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: undefined, updatedAt: ONE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue with no updatedAt timestamp', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: undefined },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('circuit breaker stops notifying after 3 attempts for the same issue', async () => {
    // Use a unique key isolated from other tests (mergeStuckCooldowns Map persists within a file)
    const CKEY = 'PAN-CB-CIRCUIT';

    vi.useFakeTimers();
    // Start far in the future to avoid colliding with real-clock cooldowns from other tests
    let fakeNow = NOW + 200 * 60 * 60 * 1000; // +200 hours

    // Make 3 successful attempts, advancing past the 10-min cooldown each time
    for (let attempt = 0; attempt < 3; attempt++) {
      vi.setSystemTime(fakeNow);
      _statusData = {
        [CKEY]: {
          issueId: CKEY,
          readyForMerge: true,
          mergeStatus: undefined,
          updatedAt: new Date(fakeNow - 5 * 60 * 1000).toISOString(),
        },
      };
      await checkReadyForMergeStuck();
      fakeNow += 11 * 60 * 1000; // advance 11 min (past the 10-min cooldown)
    }

    const notifyCallsAfterThree = mockNotifier.mock.calls.length;
    expect(notifyCallsAfterThree).toBeGreaterThanOrEqual(3);

    // 4th attempt — should be blocked by the circuit breaker
    vi.setSystemTime(fakeNow);
    _statusData = {
      [CKEY]: {
        issueId: CKEY,
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: new Date(fakeNow - 5 * 60 * 1000).toISOString(),
      },
    };
    await checkReadyForMergeStuck();
    vi.useRealTimers();

    expect(mockNotifier.mock.calls.length).toBe(notifyCallsAfterThree);
  });
});
