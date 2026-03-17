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

  it('skips an issue with mergeStatus=failed', async () => {
    writeReviewStatus({
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: 'failed',
        updatedAt: THREE_MIN_AGO,
      },
    });

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue with no updatedAt timestamp', async () => {
    writeReviewStatus({
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: undefined,
        // no updatedAt field
      },
    });

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('circuit breaker stops triggering after 3 attempts for the same issue', async () => {
    // Use a unique key isolated from other tests (module-level Maps persist within a file)
    const CKEY = 'PAN-CB-SINGLE';

    vi.useFakeTimers();
    // Start far in the future to avoid colliding with real-clock tests
    let fakeNow = NOW + 100 * 60 * 60 * 1000; // +100 hours

    // Make 3 successful attempts, advancing past the 10-min cooldown each time
    for (let attempt = 0; attempt < 3; attempt++) {
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
      fakeNow += 11 * 60 * 1000; // advance 11 min (past the 10-min cooldown)
    }

    const callsAfterThree = mockFetch.mock.calls.length;
    expect(callsAfterThree).toBeGreaterThanOrEqual(3);

    // 4th attempt — should be blocked by the circuit breaker
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

    expect(mockFetch.mock.calls.length).toBe(callsAfterThree);
  });
});
