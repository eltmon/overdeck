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
 * The tests mock fs.existsSync, readFileSync, and writeFileSync so they
 * never touch the real ~/.panopticon files (review-status.json or
 * deacon/health-state.json). This prevents circuit-breaker state from
 * leaking between test runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Derive file paths that deacon.ts uses internally
// ---------------------------------------------------------------------------
const REVIEW_STATUS_PATH = join(homedir(), '.panopticon', 'review-status.json');
const DEACON_STATE_PATH  = join(homedir(), '.panopticon', 'deacon', 'health-state.json');
const DEACON_DIR         = join(homedir(), '.panopticon', 'deacon');

// ---------------------------------------------------------------------------
// Mutable test state — mutated in beforeEach, read via closure by the fs mock
// ---------------------------------------------------------------------------
let _statusData: Record<string, object> = {};
let _statusExists = true;
let _deaconState: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// Mock fs BEFORE any module that imports it is loaded.
// Intercept review-status.json and deacon/health-state.json so tests
// are fully isolated from the real ~/.panopticon filesystem.
// ---------------------------------------------------------------------------
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (p === REVIEW_STATUS_PATH) return _statusExists;
      if (p === DEACON_STATE_PATH)  return Object.keys(_deaconState).length > 0;
      if (p === DEACON_DIR)         return true; // deacon dir always "exists"
      return actual.existsSync(p);
    }),
    mkdirSync: vi.fn((p: string, opts?: any) => {
      if (String(p).startsWith(DEACON_DIR)) return; // no-op for deacon dir
      actual.mkdirSync(p, opts);
    }),
    readFileSync: vi.fn((p: string, enc?: any) => {
      if (p === REVIEW_STATUS_PATH) return JSON.stringify(_statusData);
      if (p === DEACON_STATE_PATH)  return JSON.stringify(_deaconState);
      return actual.readFileSync(p, enc);
    }),
    writeFileSync: vi.fn((p: string, data: any, enc?: any) => {
      if (p === REVIEW_STATUS_PATH) return; // discard
      if (p === DEACON_STATE_PATH) {
        // Capture in-memory so the circuit breaker state is visible to subsequent
        // calls within the same test, but resets between tests via beforeEach.
        _deaconState = JSON.parse(typeof data === 'string' ? data : data.toString());
        return;
      }
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
  wakeSpecialistWithTask: vi.fn(),
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

vi.mock('../../../../src/lib/review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/review-status.js')>();
  return {
    ...actual,
    loadReviewStatuses: vi.fn(() => _statusData),
  };
});

// Import after mocks are in place
import { checkReadyForMergeStuck, setMergeReadyNotifier } from '../../../../src/lib/cloister/deacon.js';

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkReadyForMergeStuck', () => {
  const mockNotifier = vi.fn();

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    _statusData = {};
    _statusExists = true;
    _deaconState = {}; // reset persisted circuit-breaker counts between tests
    // Register a mock notifier so we can verify notify-only behavior (PAN-354)
    setMergeReadyNotifier(mockNotifier);
  });

  it('notifies for a stuck readyForMerge issue older than 1 hour (no auto-merge, PAN-354)', async () => {
    const issueId = 'PAN-344-REMINDER';
    _statusData = {
      [issueId]: {
        issueId,
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: isoMinutesAgo(65),
      },
    };

    const actions = await checkReadyForMergeStuck();

    // Must notify via callback, not by calling the merge API
    expect(mockNotifier).toHaveBeenCalledOnce();
    expect(mockNotifier).toHaveBeenCalledWith(issueId);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toContain(issueId);
    expect(actions[0]).toContain('Merge ready');
  });

  it('skips an issue where mergeStatus is already "merging"', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'merging', updatedAt: isoMinutesAgo(3) },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue where mergeStatus is already "merged"', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'merged', updatedAt: isoMinutesAgo(3) },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue with mergeStatus=failed', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'failed', updatedAt: isoMinutesAgo(3) },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockNotifier).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue whose readyForMerge status is younger than 2 min', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: undefined, updatedAt: isoMinutesAgo(1) },
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
    let fakeNow = Date.now() + 200 * 60 * 60 * 1000; // +200 hours

    // Make 3 successful attempts, advancing past the cooldown each time
    // Note: MERGE_READY_REMINDER_MS = 1 hour, MERGE_READY_REMINDER_COOLDOWN_MS = 1 hour
    for (let attempt = 0; attempt < 3; attempt++) {
      vi.setSystemTime(fakeNow);
      _statusData = {
        [CKEY]: {
        issueId: CKEY,
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: new Date(fakeNow - 65 * 60 * 1000).toISOString(), // 65 min old (> 1 hour requirement)
      },
    };
      await checkReadyForMergeStuck();
      fakeNow += 65 * 60 * 1000; // advance 65 min (past the 1-hour cooldown)
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
        updatedAt: new Date(fakeNow - 65 * 60 * 1000).toISOString(),
      },
    };
    await checkReadyForMergeStuck();
    vi.useRealTimers();

    expect(mockNotifier.mock.calls.length).toBe(notifyCallsAfterThree);
  });
});
