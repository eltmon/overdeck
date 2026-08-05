/**
 * PAN-3549: the review-convoy signal sweep must not act on monitor state left
 * over from a dead attempt. Run ids are content-derived (head8), so a
 * re-dispatch on the same HEAD inherits the previous attempt's deadlines and
 * retry counters. Timing out on a stale deadline makes retryReviewer kill the
 * fresh lane's live session, and the stale REVIEWER_TIMEOUT signal replays
 * into the resumed parent as a phantom "infrastructure failure" verdict
 * (PAN-3511, 2026-08-04).
 *
 * The guard: a lane whose live tmux session is NEWER than its stamped
 * deadline is a new attempt — clear the stale monitor state and skip it.
 */

import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const AGENTS_DIR = '/tmp/pan-3549-test-agents';

const {
  mockGetAgentState,
  mockGetAgentStateSync,
  mockSaveAgentStateSync,
  mockGetAgentRuntimeStateSync,
  mockMessageAgent,
  mockSessionExists,
  mockIsPaneDead,
  mockListSessions,
  mockKillSession,
} = vi.hoisted(() => ({
  mockGetAgentState: vi.fn(),
  mockGetAgentStateSync: vi.fn(),
  mockSaveAgentStateSync: vi.fn(),
  mockGetAgentRuntimeStateSync: vi.fn(() => null),
  mockMessageAgent: vi.fn().mockResolvedValue(undefined),
  mockSessionExists: vi.fn(),
  mockIsPaneDead: vi.fn(),
  mockListSessions: vi.fn(),
  mockKillSession: vi.fn(),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentState: (...args: Parameters<typeof mockGetAgentState>) => Effect.sync(() => mockGetAgentState(...args)),
  getAgentStateSync: (...args: Parameters<typeof mockGetAgentStateSync>) => mockGetAgentStateSync(...args),
  saveAgentStateSync: (...args: Parameters<typeof mockSaveAgentStateSync>) => mockSaveAgentStateSync(...args),
  getAgentRuntimeStateSync: (...args: Parameters<typeof mockGetAgentRuntimeStateSync>) => mockGetAgentRuntimeStateSync(...args),
  messageAgent: (...args: Parameters<typeof mockMessageAgent>) => mockMessageAgent(...args),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExists: (...args: Parameters<typeof mockSessionExists>) => Effect.promise(() => mockSessionExists(...args)),
  sessionExistsSync: vi.fn(() => true),
  isPaneDead: (...args: Parameters<typeof mockIsPaneDead>) => Effect.promise(() => mockIsPaneDead(...args)),
  listSessions: (...args: Parameters<typeof mockListSessions>) => Effect.promise(() => Promise.resolve(mockListSessions(...args))),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  capturePane: vi.fn(() => Effect.succeed('')),
  killSession: (...args: Parameters<typeof mockKillSession>) => Effect.promise(() => Promise.resolve(mockKillSession(...args))),
}));

vi.mock('../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/paths.js')>();
  return { ...actual, AGENTS_DIR: '/tmp/pan-3549-test-agents' };
});

vi.mock('../../../src/lib/persistent-logger.js', () => ({
  logDeaconEventSync: vi.fn(),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn(() => null),
  setReviewStatusSync: vi.fn(),
}));

vi.mock('../../../src/lib/cloister/review-verdict-feedback.js', () => ({
  deliverReviewVerdictFeedback: vi.fn(),
}));

vi.mock('../../../src/lib/cloister/review-verdict-report.js', () => ({
  findVerdictReport: vi.fn(() => null),
}));

vi.mock('../../../src/lib/codex-auth.js', () => ({
  applyCodexAuthBurnFlag: vi.fn(() => false),
  isCodexAuthRouted: vi.fn(() => false),
  paneShowsCodexAuthBurn: vi.fn(() => false),
}));

vi.mock('../../../src/lib/review-findings.js', () => ({
  extractMarkdownSection: vi.fn(() => ''),
  findBlockingFindings: vi.fn(() => []),
}));

vi.mock('../../../src/lib/cloister/agent-idle.js', () => ({
  getAgentEffectiveLastActivityMs: vi.fn(() => null),
}));

vi.mock('../../../src/lib/context-overflow.js', () => ({
  isContextOverflowTail: vi.fn(() => false),
}));

import { monitorReviewConvoySignals } from '../../../src/lib/cloister/deacon-review-signals.js';

const PARENT = 'agent-pan-1059-review';
const LANE = 'agent-pan-1059-review-security';

function laneState(overrides: Record<string, unknown> = {}) {
  return {
    id: LANE,
    issueId: 'PAN-1059',
    role: 'review',
    status: 'running',
    startedAt: '2026-08-04T20:00:00.000Z',
    workspace: '/tmp/pan-3549-ws',
    reviewSubRole: 'security',
    reviewRunId: 'agent-pan-1059-review-deadbeef',
    reviewSynthesisAgentId: PARENT,
    reviewOutputPath: '/tmp/pan-3549-ws/.pan/review/agent-pan-1059-review-deadbeef/security.md',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rmSync(AGENTS_DIR, { recursive: true, force: true });
  mkdirSync(join(AGENTS_DIR, LANE), { recursive: true });
  mockGetAgentRuntimeStateSync.mockReturnValue(null);
  mockMessageAgent.mockResolvedValue(undefined);
  // Synthesis parent is alive; lane liveness is set per test.
  mockSessionExists.mockResolvedValue(true);
  mockIsPaneDead.mockResolvedValue(false);
});

afterEach(() => {
  rmSync(AGENTS_DIR, { recursive: true, force: true });
});

describe('monitorReviewConvoySignals — stale-deadline guard (PAN-3549)', () => {
  it('clears stale monitor state and skips a lane whose live session is newer than its deadline', async () => {
    const state = laneState({
      reviewDeadlineAt: '2026-08-04T21:26:00.000Z', // ~40 min before the session below
      reviewMonitorSignaled: 'timeout',
      reviewRetryAttempt: 1,
    });
    // The guard's skip path requires reviewMonitorSignaled to be UNSET on read
    // (rows with a signal are skipped earlier) — a stale row from a lost
    // resume-cleanup save has the deadline but no signal yet.
    delete state.reviewMonitorSignaled;
    mockGetAgentState.mockReturnValue(state);
    mockGetAgentStateSync.mockReturnValue(state);
    mockListSessions.mockResolvedValue([
      { name: LANE, created: new Date('2026-08-04T22:50:00.000Z'), attached: false, windows: 1 },
      { name: PARENT, created: new Date('2026-08-04T22:50:30.000Z'), attached: false, windows: 1 },
    ]);

    // Freeze "now" past the stale deadline so only the guard can save the lane.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T22:51:00.000Z'));
    try {
      const actions = await monitorReviewConvoySignals();
      expect(actions).toEqual([]);
      expect(mockKillSession).not.toHaveBeenCalled();
      expect(mockMessageAgent).not.toHaveBeenCalled();
      expect(mockSaveAgentStateSync).toHaveBeenCalledTimes(1);
      const saved = mockSaveAgentStateSync.mock.calls[0]![0] as Record<string, unknown>;
      expect(saved['reviewDeadlineAt']).toBeUndefined();
      expect(saved['reviewRetryAttempt']).toBeUndefined();
      expect(saved['reviewMonitorSignaled']).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still times out a genuinely wedged lane whose session predates its deadline', async () => {
    const state = laneState({
      reviewDeadlineAt: '2026-08-04T21:26:00.000Z',
      reviewRetryAttempt: 1, // retry already exhausted — straight to timeout
    });
    mockGetAgentState.mockReturnValue(state);
    mockGetAgentStateSync.mockReturnValue(state);
    mockListSessions.mockResolvedValue([
      // Session created BEFORE the deadline — same attempt, legitimately wedged.
      { name: LANE, created: new Date('2026-08-04T21:06:00.000Z'), attached: false, windows: 1 },
      { name: PARENT, created: new Date('2026-08-04T21:00:00.000Z'), attached: false, windows: 1 },
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T22:51:00.000Z'));
    try {
      await monitorReviewConvoySignals();
      expect(mockMessageAgent).toHaveBeenCalledTimes(1);
      expect(String(mockMessageAgent.mock.calls[0]![1])).toContain('REVIEWER_TIMEOUT security');
      expect(mockSaveAgentStateSync).toHaveBeenCalledWith(
        expect.objectContaining({ id: LANE, reviewMonitorSignaled: 'timeout' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
