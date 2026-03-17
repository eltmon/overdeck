/**
 * Tests for PAN-344: auto-merge trigger and stuck-merge patrol check.
 *
 * Coverage:
 *  1. checkReadyForMergeStuck finds a stuck issue and calls the merge API
 *  2. checkReadyForMergeStuck skips issues where mergeStatus=merging
 *  3. checkReadyForMergeStuck skips issues where mergeStatus=merged
 *  4. Staleness check: status younger than 2 min is skipped
 *  5. Circuit breaker stops after MERGE_STUCK_MAX_ATTEMPTS (3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Path helpers (mirrors deacon.ts internals)
// ---------------------------------------------------------------------------
const PANOPTICON_HOME = join(homedir(), '.panopticon');
const REVIEW_STATUS_FILE = join(PANOPTICON_HOME, 'review-status.json');

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any imports of the module
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

// We will mock global fetch below per-test
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { checkReadyForMergeStuck } from '../../../../src/lib/cloister/deacon.js';

// ---------------------------------------------------------------------------
// Helper: write review-status.json with the given entries
// ---------------------------------------------------------------------------
function writeReviewStatus(entries: Record<string, object>): void {
  if (!existsSync(PANOPTICON_HOME)) {
    mkdirSync(PANOPTICON_HOME, { recursive: true });
  }
  writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

function removeReviewStatus(): void {
  if (existsSync(REVIEW_STATUS_FILE)) {
    try { unlinkSync(REVIEW_STATUS_FILE); } catch { /* ignore */ }
  }
}

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);
  });

  afterEach(() => {
    removeReviewStatus();
  });

  it('triggers merge for a stuck readyForMerge issue older than 2 min', async () => {
    writeReviewStatus({
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: THREE_MIN_AGO,
      },
    });

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/workspaces\/PAN-344\/merge/);
    expect(opts.method).toBe('POST');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toContain('PAN-344');
  });

  it('skips an issue where mergeStatus is already "merging"', async () => {
    writeReviewStatus({
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: 'merging',
        updatedAt: THREE_MIN_AGO,
      },
    });

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue where mergeStatus is already "merged"', async () => {
    writeReviewStatus({
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: 'merged',
        updatedAt: THREE_MIN_AGO,
      },
    });

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue whose readyForMerge status is younger than 2 min', async () => {
    writeReviewStatus({
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: ONE_MIN_AGO,
      },
    });

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('circuit breaker stops triggering after 3 attempts', async () => {
    // Each call to checkReadyForMergeStuck (when the cooldown expires) counts as an attempt.
    // We need to bypass the cooldown between calls by using distinct issue keys.
    // Alternatively, test by calling 3 times with a very old status AND clearing cooldowns
    // is fragile; instead we test with 3 distinct issues that each hit the breaker limit
    // by examining the in-memory state indirectly.
    //
    // The cleaner approach: use a single issue and verify the 4th call is skipped.
    // Since the cooldown is 10 min, we can't simply re-call — instead we test using a
    // different issue key for each "historical attempt" by verifying that after the
    // module has attempted 3 times in prior calls, a 4th stale entry is skipped.
    //
    // Because module-level Maps persist across tests in the same file, this test is
    // intentionally isolated using a unique issue key.

    const KEY = 'PAN-CB-TEST';
    writeReviewStatus({
      [KEY]: {
        issueId: KEY,
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: new Date(NOW - 30 * 60 * 1000).toISOString(), // 30 min ago
      },
    });

    // Force the cooldown to appear expired between calls by manipulating the test clock
    // isn't feasible without fake timers; instead verify 3 calls succeed and a 4th is
    // blocked — but only after the cooldown window elapses. We simulate this by
    // calling in a sub-test that uses a fresh issue key for each "attempt slot".
    //
    // Practical approach: call once per "minute" is impractical in unit tests.
    // We verify the circuit breaker guard by checking the behaviour when the map
    // already records 3 attempts — done via white-box testing of the exported function.
    //
    // Since mergeStuckAttempts is module-private, we exercise it indirectly:
    // call checkReadyForMergeStuck 3 times (bypassing cooldown by using distinct keys
    // each time), then check the 4th entry is skipped.

    const KEYS = ['PAN-CB-A', 'PAN-CB-B', 'PAN-CB-C', 'PAN-CB-D'];
    const staleTime = new Date(NOW - 30 * 60 * 1000).toISOString();
    let callCount = 0;

    for (let i = 0; i < 4; i++) {
      writeReviewStatus({
        [KEYS[i]]: {
          issueId: KEYS[i],
          readyForMerge: true,
          mergeStatus: undefined,
          updatedAt: staleTime,
        },
      });
      await checkReadyForMergeStuck();
      callCount = mockFetch.mock.calls.length;
    }

    // All 4 distinct keys should have triggered once each (circuit breaker is per-key)
    expect(callCount).toBe(4);

    // Now verify that a single key DOES hit the circuit breaker after 3 attempts.
    // We can't easily advance the cooldown in unit tests, so we test by simulating
    // repeated calls at a future time using vi.setSystemTime.
    const CKEY = 'PAN-CB-SINGLE';

    vi.useFakeTimers();
    let fakeNow = NOW + 60 * 60 * 1000; // start 1 hour in the future

    for (let attempt = 0; attempt < 3; attempt++) {
      vi.setSystemTime(fakeNow);
      writeReviewStatus({
        [CKEY]: {
          issueId: CKEY,
          readyForMerge: true,
          mergeStatus: undefined,
          // status is always "old enough" relative to current fake time
          updatedAt: new Date(fakeNow - 5 * 60 * 1000).toISOString(),
        },
      });
      await checkReadyForMergeStuck();
      fakeNow += 11 * 60 * 1000; // advance 11 min (past cooldown)
    }

    const callsAfterThree = mockFetch.mock.calls.length;

    // 4th attempt — should be blocked by circuit breaker
    vi.setSystemTime(fakeNow);
    writeReviewStatus({
      [CKEY]: {
        issueId: CKEY,
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: new Date(fakeNow - 5 * 60 * 1000).toISOString(),
      },
    });
    await checkReadyForMergeStuck();
    vi.useRealTimers();

    // No additional call after 3 attempts
    expect(mockFetch.mock.calls.length).toBe(callsAfterThree);
  });
});
