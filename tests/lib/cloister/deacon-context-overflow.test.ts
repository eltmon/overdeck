/**
 * Tests for checkApiErrorAgents — context-window overflow recovery branch.
 *
 * A 400 "input exceeds the context window" cannot be retried by continuing
 * (it re-sends the same oversized context). The deacon recovers by sending
 * `/compact`; once compaction settles and the overflow clears, it nudges the
 * agent to resume. A loop guard escalates to `stuck` if /compact never clears
 * the overflow.
 *
 * Covers:
 *  - overflow detected → sends /compact, records attempt 1
 *  - /compact in flight (within settle window) → does nothing
 *  - settled + overflow cleared → nudges continue, clears state
 *  - settled + overflow persists → /compact again (attempt increments)
 *  - loop guard: after MAX attempts still overflowing → marks stuck, no compact
 *  - non-overflow output → falls through (overflow branch is a no-op)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks ──────────────────────────────────────────────────────

const mockSendKeys = vi.fn();
const mockCapturePane = vi.fn();
const mockListSessionNames = vi.fn();
const mockGetReviewStatusSync = vi.fn();
const mockMarkWorkspaceStuck = vi.fn();
const mockEmitActivityEntry = vi.fn();

vi.mock('../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    sendKeys: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockSendKeys(...args))),
    capturePane: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockCapturePane(...args))),
    listSessionNames: () => Effect.promise(() => Promise.resolve(mockListSessionNames())),
    sessionExists: (...args: unknown[]) => Effect.promise(() => Promise.resolve(false)),
    sessionExistsSync: () => false,
    buildTmuxCommandString: vi.fn(),
    createSession: vi.fn(() => Effect.succeed(undefined)),
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    killSession: vi.fn(() => Effect.succeed(undefined)),
    killSessionSync: vi.fn(),
    listPaneValues: vi.fn(() => Effect.succeed([])),
    listPaneValuesSync: vi.fn(() => []),
  };
});

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: (...args: unknown[]) => mockGetReviewStatusSync(...args),
  setReviewStatusSync: vi.fn(),
  loadReviewStatuses: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../src/lib/database/review-status-db.js', () => ({
  markWorkspaceStuck: (...args: unknown[]) => mockMarkWorkspaceStuck(...args),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: (...args: unknown[]) => mockEmitActivityEntry(...args),
  emitActivityTtsSync: vi.fn(),
  emitActivityDetailedSync: vi.fn(),
}));

// Stub heavy transitive dependencies that deacon imports at module level.
vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn().mockReturnValue(null),
  getAgentRuntimeStateSync: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: vi.fn().mockReturnValue(null),
  getAgentStateSync: vi.fn().mockReturnValue(null),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
}));

// ── Constants ────────────────────────────────────────────────────────────────

const SESSION = 'agent-pan-9001';
const ISSUE = 'PAN-9001';
const PROMPT = '❯ ';
const OVERFLOW_LINE = 'API Error: 400 Your input exceeds the context window of this model.';
const SETTLE_MS = 60_000;

function pane(...lines: string[]): string {
  return lines.join('\n') + '\n' + PROMPT;
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('checkApiErrorAgents — context-window overflow recovery', () => {
  let checkApiErrorAgents: () => Promise<string[]>;
  let contextOverflowRecoveryState: Map<string, { lastAttempt: number; attempts: number }>;

  beforeEach(async () => {
    vi.resetModules();
    mockSendKeys.mockReset().mockResolvedValue(undefined);
    mockCapturePane.mockReset();
    mockListSessionNames.mockReset().mockResolvedValue([SESSION]);
    mockGetReviewStatusSync.mockReset().mockReturnValue(null);
    mockMarkWorkspaceStuck.mockReset();
    mockEmitActivityEntry.mockReset();

    const mod = await import('../../../src/lib/cloister/deacon.js');
    checkApiErrorAgents = mod.checkApiErrorAgents;
    contextOverflowRecoveryState = mod.contextOverflowRecoveryState;
    contextOverflowRecoveryState.clear();
  });

  it('(a) detects overflow at an idle prompt → sends /compact and records attempt 1', async () => {
    mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockSendKeys).toHaveBeenCalledWith(SESSION, '/compact');
    expect(contextOverflowRecoveryState.get(SESSION)?.attempts).toBe(1);
    expect(actions.some(a => /compacting/.test(a))).toBe(true);
    expect(mockEmitActivityEntry).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', issueId: ISSUE }),
    );
  });

  it('(b) does nothing while a /compact is still in flight (within settle window)', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - 1_000, attempts: 1 });
    mockCapturePane.mockResolvedValue(pane('still compacting', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
    // State preserved untouched
    expect(contextOverflowRecoveryState.get(SESSION)?.attempts).toBe(1);
  });

  it('(c) settled + overflow cleared → nudges continue and clears state', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - (SETTLE_MS + 1_000), attempts: 1 });
    // Compaction succeeded: the recent tail no longer shows the overflow error.
    mockCapturePane.mockResolvedValue(pane('Conversation compacted', 'continuing work'));

    const actions = await checkApiErrorAgents();

    expect(mockSendKeys).toHaveBeenCalledTimes(1);
    const [, msg] = mockSendKeys.mock.calls[0];
    expect(msg).toMatch(/compacted to recover/i);
    expect(msg).not.toBe('/compact');
    expect(contextOverflowRecoveryState.has(SESSION)).toBe(false);
    expect(actions.some(a => /resumed/.test(a))).toBe(true);
  });

  it('(d) settled but overflow persists → compacts again, incrementing the attempt', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - (SETTLE_MS + 1_000), attempts: 1 });
    mockCapturePane.mockResolvedValue(pane('compaction failed', OVERFLOW_LINE));

    await checkApiErrorAgents();

    expect(mockSendKeys).toHaveBeenCalledWith(SESSION, '/compact');
    expect(contextOverflowRecoveryState.get(SESSION)?.attempts).toBe(2);
  });

  it('(e) loop guard: at MAX attempts still overflowing → marks stuck, no further /compact', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - (SETTLE_MS + 1_000), attempts: 3 });
    mockCapturePane.mockResolvedValue(pane('compaction failed', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(mockMarkWorkspaceStuck).toHaveBeenCalledWith(
      ISSUE,
      'context_overflow',
      expect.objectContaining({ compactAttempts: 3 }),
    );
    expect(mockEmitActivityEntry).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', issueId: ISSUE }),
    );
    expect(contextOverflowRecoveryState.has(SESSION)).toBe(false);
    expect(actions).toHaveLength(0);
  });

  it('(f) stuck agent → overflow branch is skipped entirely', async () => {
    mockGetReviewStatusSync.mockReturnValue({ stuck: true });
    mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

    await checkApiErrorAgents();

    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(contextOverflowRecoveryState.has(SESSION)).toBe(false);
  });

  it('(g) no overflow and no pending state → overflow branch is a no-op', async () => {
    mockCapturePane.mockResolvedValue(pane('all good', 'no errors here'));

    await checkApiErrorAgents();

    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(mockMarkWorkspaceStuck).not.toHaveBeenCalled();
    expect(contextOverflowRecoveryState.has(SESSION)).toBe(false);
  });
});
