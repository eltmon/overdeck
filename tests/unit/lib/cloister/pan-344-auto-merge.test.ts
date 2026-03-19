/**
 * Tests for PAN-344: auto-merge trigger and stuck-merge patrol check.
 *
 * Coverage:
 *  1. checkReadyForMergeStuck finds a stuck issue and calls the merge API
 *  2. checkReadyForMergeStuck skips issues where mergeStatus=merging
 *  3. checkReadyForMergeStuck skips issues where mergeStatus=merged
 *  4. checkReadyForMergeStuck skips issues where mergeStatus=failed
 *  5. Staleness check: status younger than 2 min is skipped
 *  6. Staleness check: missing updatedAt is skipped
 *  7. Circuit breaker stops after MERGE_STUCK_MAX_ATTEMPTS (3)
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

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks are in place
import { checkReadyForMergeStuck } from '../../../../src/lib/cloister/deacon.js';

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
    _statusData = {};
    _statusExists = true;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);
  });

  it('detects a stuck readyForMerge issue older than 2 min (PAN-354: no auto-merge, just logs)', async () => {
    _statusData = {
      'PAN-344': {
        issueId: 'PAN-344',
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: THREE_MIN_AGO,
      },
    };

    const actions = await checkReadyForMergeStuck();

    // PAN-354: auto-merge was removed — deacon logs but does NOT call the merge API
    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toContain('PAN-344');
    expect(actions[0]).toContain('readyForMerge');
  });

  it('skips an issue where mergeStatus is already "merging"', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'merging', updatedAt: THREE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue where mergeStatus is already "merged"', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'merged', updatedAt: THREE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue with mergeStatus=failed', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: 'failed', updatedAt: THREE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue whose readyForMerge status is younger than 2 min', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: undefined, updatedAt: ONE_MIN_AGO },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('skips an issue with no updatedAt timestamp', async () => {
    _statusData = {
      'PAN-344': { issueId: 'PAN-344', readyForMerge: true, mergeStatus: undefined },
    };

    const actions = await checkReadyForMergeStuck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
  });

  it('per-issue cooldown suppresses repeated alerts within 10 min window', async () => {
    // Use a unique key isolated from other tests (mergeStuckCooldowns Map persists within a file)
    const CKEY = 'PAN-CB-COOLDOWN';

    vi.useFakeTimers();
    // Start far in the future to avoid colliding with real-clock cooldowns from other tests
    let fakeNow = NOW + 400 * 60 * 60 * 1000; // +400 hours

    vi.setSystemTime(fakeNow);
    _statusData = {
      [CKEY]: {
        issueId: CKEY,
        readyForMerge: true,
        mergeStatus: undefined,
        updatedAt: new Date(fakeNow - 5 * 60 * 1000).toISOString(),
      },
    };

    // First call — should produce an action
    const first = await checkReadyForMergeStuck();
    expect(first.length).toBeGreaterThan(0);

    // Second call immediately after — within the 10-min cooldown, should be suppressed
    const second = await checkReadyForMergeStuck();
    expect(second).toHaveLength(0);

    // Advance past the 10-min cooldown — should fire again
    fakeNow += 11 * 60 * 1000;
    vi.setSystemTime(fakeNow);
    _statusData[CKEY].updatedAt = new Date(fakeNow - 5 * 60 * 1000).toISOString();
    const third = await checkReadyForMergeStuck();
    expect(third.length).toBeGreaterThan(0);

    vi.useRealTimers();

    // PAN-354: no fetch calls — auto-merge was removed
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
