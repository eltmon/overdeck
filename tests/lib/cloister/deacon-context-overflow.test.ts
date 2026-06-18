/**
 * Tests for checkApiErrorAgents — context-window overflow recovery branch.
 *
 * A 400 "input exceeds the context window" cannot be retried by continuing
 * (it re-sends the same oversized context). The deacon recovers by sending
 * Panopticon-side compact respawn; once the respawn settles and the overflow
 * clears, the recovery state is cleared. Non-agent harness compactions still get
 * a resume nudge. A loop guard escalates to `stuck` if compact respawns never
 * clear the overflow.
 *
 * Covers:
 *  - overflow detected → compact-respawns the agent, records attempt 1
 *  - recovery in flight (within settle window) → does nothing
 *  - settled harness /compact + overflow cleared → nudges continue, clears state
 *  - settled compact respawn + overflow persists → compact-respawns again
 *  - loop guard: after MAX compactAttempts still overflowing → marks stuck, no recovery
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
const mockGetAgentRuntimeState = vi.fn();
const mockSaveAgentRuntimeState = vi.fn();
const mockGetAgentState = vi.fn();
const mockComputeContextUsage = vi.fn();
const mockResumeAgent = vi.fn();
const mockClearWorkspaceStuck = vi.fn();

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

vi.mock('../../../src/lib/overdeck/review-status-sync.js', () => ({
  markWorkspaceStuck: (...args: unknown[]) => mockMarkWorkspaceStuck(...args),
  clearWorkspaceStuck: (...args: unknown[]) => mockClearWorkspaceStuck(...args),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: (...args: unknown[]) => mockEmitActivityEntry(...args),
  emitActivityTtsSync: vi.fn(),
  emitActivityDetailedSync: vi.fn(),
}));

vi.mock('../../../src/dashboard/server/services/conversation-service.js', () => ({
  computeContextUsage: (...args: unknown[]) => mockComputeContextUsage(...args),
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
  getAgentRuntimeState: (...args: unknown[]) => mockGetAgentRuntimeState(...args),
  getAgentRuntimeStateSync: (...args: unknown[]) => mockGetAgentRuntimeState(...args),
  saveAgentRuntimeState: (...args: unknown[]) => mockSaveAgentRuntimeState(...args),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: (agentId: string) => `/tmp/${agentId}`,
  getAgentState: (...args: unknown[]) => mockGetAgentState(...args),
  getAgentStateSync: (...args: unknown[]) => mockGetAgentState(...args),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  resumeAgent: (...args: unknown[]) => mockResumeAgent(...args),
}));

// ── Constants ────────────────────────────────────────────────────────────────

const SESSION = 'agent-pan-9001';
const ISSUE = 'PAN-9001';
const PROMPT = '❯ ';
const OVERFLOW_LINE = 'API Error: 400 Your input exceeds the context window of this model.';
const SETTLE_MS = 150_000;

function pane(...lines: string[]): string {
  return lines.join('\n') + '\n' + PROMPT;
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('checkApiErrorAgents — context-window overflow recovery', () => {
  let checkApiErrorAgents: () => Promise<string[]>;
  let contextOverflowRecoveryState: Map<string, { lastAttempt: number; compactAttempts: number; mechanism: 'respawn' | 'harness-compact' }>;
  let contextProactiveCompactState: Map<string, { lastAttempt: number }>;
  let stuckOverflowNativeRecoveryState: Map<string, { attempts: number; lastAttempt: number }>;

  beforeEach(async () => {
    vi.resetModules();
    mockSendKeys.mockReset().mockResolvedValue(undefined);
    mockCapturePane.mockReset();
    mockListSessionNames.mockReset().mockResolvedValue([SESSION]);
    mockGetReviewStatusSync.mockReset().mockReturnValue(null);
    mockMarkWorkspaceStuck.mockReset();
    mockClearWorkspaceStuck.mockReset();
    mockEmitActivityEntry.mockReset();
    mockGetAgentRuntimeState.mockReset().mockReturnValue(null);
    mockSaveAgentRuntimeState.mockReset().mockResolvedValue(undefined);
    mockGetAgentState.mockReset().mockReturnValue(null);
    mockComputeContextUsage.mockReset().mockResolvedValue(null);
    // PAN-1675: fresh agent-* overflow recovers via resumeAgent({compact:true}).
    mockResumeAgent.mockReset().mockResolvedValue({ success: true });

    const mod = await import('../../../src/lib/cloister/deacon.js');
    checkApiErrorAgents = mod.checkApiErrorAgents;
    contextOverflowRecoveryState = mod.contextOverflowRecoveryState;
    contextProactiveCompactState = mod.contextProactiveCompactState;
    stuckOverflowNativeRecoveryState = mod.stuckOverflowNativeRecoveryState;
    contextOverflowRecoveryState.clear();
    contextProactiveCompactState.clear();
    stuckOverflowNativeRecoveryState.clear();
  });

  it('(a) detects overflow at an idle prompt → Panopticon-side compacts via resumeAgent (never /compact) and records attempt 1', async () => {
    mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockSaveAgentRuntimeState).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ contextSaturatedAt: expect.any(String) }),
    );
    // PAN-1675: agent-* fresh overflow recovers via out-of-band compaction,
    // NOT the harness /compact (which deadlocks on a wedged session).
    expect(mockResumeAgent).toHaveBeenCalledWith(SESSION, undefined, { compact: true });
    expect(mockSendKeys).not.toHaveBeenCalledWith(SESSION, '/compact');
    expect(contextOverflowRecoveryState.get(SESSION)?.mechanism).toBe('respawn');
    expect(contextOverflowRecoveryState.get(SESSION)?.compactAttempts).toBe(1);
    expect(actions.some(a => /compact-respawned/.test(a))).toBe(true);
    expect(mockEmitActivityEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        issueId: ISSUE,
        message: expect.stringContaining('marked wedged'),
      }),
    );
    expect(mockEmitActivityEntry).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', issueId: ISSUE }),
    );
  });

  it('(a2) resumeAgent compaction failure records an attempt and never falls back to /clear', async () => {
    mockResumeAgent.mockResolvedValue({ success: false, error: 'compaction boom' });
    mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockResumeAgent).toHaveBeenCalledWith(SESSION, undefined, { compact: true });
    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(contextOverflowRecoveryState.get(SESSION)).toMatchObject({
      compactAttempts: 1,
      mechanism: 'respawn',
    });
    expect(actions.some(a => /compact respawn failed/.test(a))).toBe(true);
  });

  it('preserves the first contextSaturatedAt timestamp on repeated overflow detections', async () => {
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: '2026-06-05T12:00:00.000Z',
      contextSaturatedAt: '2026-06-05T12:01:00.000Z',
    });
    mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

    await checkApiErrorAgents();

    expect(mockSaveAgentRuntimeState).not.toHaveBeenCalled();
    expect(mockEmitActivityEntry.mock.calls.some(([entry]) => entry.message?.includes('marked wedged'))).toBe(false);
    expect(mockResumeAgent).toHaveBeenCalledWith(SESSION, undefined, { compact: true });
  });

  it('clears contextSaturatedAt when the recent tail no longer overflows', async () => {
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: '2026-06-05T12:00:00.000Z',
      contextSaturatedAt: '2026-06-05T12:01:00.000Z',
    });
    mockCapturePane.mockResolvedValue(pane('all good', 'no errors here'));

    await checkApiErrorAgents();

    expect(mockSaveAgentRuntimeState).toHaveBeenCalledWith(SESSION, { contextSaturatedAt: undefined });
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  it('(b) does nothing while compact recovery is still in flight (within settle window)', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - 1_000, compactAttempts: 1, mechanism: 'respawn' });
    mockCapturePane.mockResolvedValue(pane('still compacting', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(actions).toHaveLength(0);
    // State preserved untouched
    expect(contextOverflowRecoveryState.get(SESSION)?.compactAttempts).toBe(1);
  });

  it('(c) settled harness /compact + overflow cleared → nudges continue and clears state', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - (SETTLE_MS + 1_000), compactAttempts: 1, mechanism: 'harness-compact' });
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

  it('(d) settled compact respawn but overflow persists → compact-respawns again without /clear', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - (SETTLE_MS + 1_000), compactAttempts: 1, mechanism: 'respawn' });
    mockCapturePane.mockResolvedValue(pane('compaction failed', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockResumeAgent).toHaveBeenCalledWith(SESSION, undefined, { compact: true });
    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(contextOverflowRecoveryState.get(SESSION)).toMatchObject({
      compactAttempts: 2,
      mechanism: 'respawn',
    });
    expect(actions.some(a => /compact-respawned/.test(a))).toBe(true);
  });

  it('(e) loop guard: after max compact respawns still overflowing → marks stuck, no further recovery', async () => {
    contextOverflowRecoveryState.set(SESSION, { lastAttempt: Date.now() - (SETTLE_MS + 1_000), compactAttempts: 2, mechanism: 'respawn' });
    mockCapturePane.mockResolvedValue(pane('compaction failed', OVERFLOW_LINE));

    const actions = await checkApiErrorAgents();

    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(mockResumeAgent).not.toHaveBeenCalled();
    expect(mockMarkWorkspaceStuck).toHaveBeenCalledWith(
      ISSUE,
      'context_overflow',
      expect.objectContaining({ compactAttempts: 2 }),
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

  it('proactively compacts an idle agent above the context high-water mark', async () => {
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date().toISOString(),
      claudeSessionId: 'session-123',
    });
    mockGetAgentState.mockReturnValue({
      id: SESSION,
      issueId: ISSUE,
      workspace: '/workspace/pan-9001',
      model: 'gpt-5.5',
      status: 'running',
    });
    mockComputeContextUsage.mockResolvedValue({ percentUsed: 86, contextWindow: 200_000, estimatedTokens: 172_000 });
    mockCapturePane.mockResolvedValue(pane('all good', 'idle'));

    const actions = await checkApiErrorAgents();

    expect(mockSendKeys).toHaveBeenCalledWith(SESSION, '/compact');
    expect(contextProactiveCompactState.has(SESSION)).toBe(true);
    expect(actions.some(a => /86%/.test(a))).toBe(true);
  });

  it('does not proactively compact below the context high-water mark', async () => {
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date().toISOString(),
      claudeSessionId: 'session-123',
    });
    mockGetAgentState.mockReturnValue({
      id: SESSION,
      issueId: ISSUE,
      workspace: '/workspace/pan-9001',
      model: 'gpt-5.5',
      status: 'running',
    });
    mockComputeContextUsage.mockResolvedValue({ percentUsed: 84, contextWindow: 200_000, estimatedTokens: 168_000 });
    mockCapturePane.mockResolvedValue(pane('all good', 'idle'));

    await checkApiErrorAgents();

    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(contextProactiveCompactState.has(SESSION)).toBe(false);
  });

  it('does not run the proactive trigger for an already-overflowing agent', async () => {
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date().toISOString(),
      claudeSessionId: 'session-123',
    });
    mockGetAgentState.mockReturnValue({
      id: SESSION,
      issueId: ISSUE,
      workspace: '/workspace/pan-9001',
      model: 'gpt-5.5',
      status: 'running',
    });
    mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

    await checkApiErrorAgents();

    expect(mockComputeContextUsage).not.toHaveBeenCalled();
    // PAN-1675: fresh overflow on an agent session recovers via out-of-band
    // compaction, not the harness /compact.
    expect(mockResumeAgent).toHaveBeenCalledWith(SESSION, undefined, { compact: true });
    expect(mockSendKeys).not.toHaveBeenCalledWith(SESSION, '/compact');
  });

  it('does not proactively compact within the cooldown window', async () => {
    contextProactiveCompactState.set(SESSION, { lastAttempt: Date.now() - 1_000 });
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date().toISOString(),
      claudeSessionId: 'session-123',
    });
    mockGetAgentState.mockReturnValue({
      id: SESSION,
      issueId: ISSUE,
      workspace: '/workspace/pan-9001',
      model: 'gpt-5.5',
      status: 'running',
    });
    mockComputeContextUsage.mockResolvedValue({ percentUsed: 99, contextWindow: 200_000, estimatedTokens: 198_000 });
    mockCapturePane.mockResolvedValue(pane('all good', 'idle'));

    await checkApiErrorAgents();

    expect(mockComputeContextUsage).not.toHaveBeenCalled();
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  // ── PAN-1675 (A2): rescue agents already flagged stuck=context_overflow ──
  describe('stuck=context_overflow native-compaction rescue', () => {
    it('attempts native compaction on a stuck-overflow agent and clears stuck on success', async () => {
      mockGetReviewStatusSync.mockReturnValue({ stuck: true, stuckReason: 'context_overflow' });
      mockResumeAgent.mockResolvedValue({ success: true });
      mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

      const actions = await checkApiErrorAgents();

      expect(mockResumeAgent).toHaveBeenCalledWith(SESSION, undefined, { compact: true });
      // resumeAgent clears the stuck flag internally on success; the deacon also
      // drops its native-recovery bookkeeping.
      expect(stuckOverflowNativeRecoveryState.has(SESSION)).toBe(false);
      expect(actions.some(a => /native-compacted previously-stuck/.test(a))).toBe(true);
    });

    it('clears a stuck flag only on a POSITIVE recovery signal (context back below high-water)', async () => {
      mockGetReviewStatusSync.mockReturnValue({ stuck: true, stuckReason: 'context_overflow' });
      mockGetAgentState.mockReturnValue({ id: SESSION, issueId: ISSUE, workspace: '/ws', sessionId: 'sess-1', model: 'gpt-5.5', status: 'running' });
      mockComputeContextUsage.mockResolvedValue({ percentUsed: 30, contextWindow: 150_000, estimatedTokens: 45_000 });
      mockCapturePane.mockResolvedValue(pane('all good', 'continuing work'));

      const actions = await checkApiErrorAgents();

      expect(mockClearWorkspaceStuck).toHaveBeenCalledWith('PAN-9001');
      expect(mockResumeAgent).not.toHaveBeenCalled();
      expect(actions.some(a => /cleared stuck flag/.test(a))).toBe(true);
    });

    it('does NOT clear the stuck flag when the tail lacks the error but context is still near 100% (no false-recovery)', async () => {
      mockGetReviewStatusSync.mockReturnValue({ stuck: true, stuckReason: 'context_overflow' });
      mockGetAgentState.mockReturnValue({ id: SESSION, issueId: ISSUE, workspace: '/ws', sessionId: 'sess-1', model: 'gpt-5.5', status: 'running' });
      // Error scrolled out of the tail, but the agent is still pinned near 100%.
      mockComputeContextUsage.mockResolvedValue({ percentUsed: 99, contextWindow: 150_000, estimatedTokens: 148_500 });
      mockCapturePane.mockResolvedValue(pane('all good', 'continuing work'));

      await checkApiErrorAgents();

      expect(mockClearWorkspaceStuck).not.toHaveBeenCalled();
    });

    it('stops after MAX native-compaction attempts and leaves the agent stuck for a human', async () => {
      mockGetReviewStatusSync.mockReturnValue({ stuck: true, stuckReason: 'context_overflow' });
      mockResumeAgent.mockResolvedValue({ success: false, error: 're-overflowed' });
      mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));
      // Pre-seed the budget as exhausted (lastAttempt old enough to skip cooldown).
      stuckOverflowNativeRecoveryState.set(SESSION, { attempts: 2, lastAttempt: Date.now() - (20 * 60 * 1000) });

      await checkApiErrorAgents();

      expect(mockResumeAgent).not.toHaveBeenCalled();
    });

    it('leaves a deacon-ignored stuck agent untouched', async () => {
      mockGetReviewStatusSync.mockReturnValue({ stuck: true, stuckReason: 'context_overflow', deaconIgnored: true });
      mockCapturePane.mockResolvedValue(pane('working...', OVERFLOW_LINE));

      await checkApiErrorAgents();

      expect(mockResumeAgent).not.toHaveBeenCalled();
      expect(mockClearWorkspaceStuck).not.toHaveBeenCalled();
    });
  });
});
