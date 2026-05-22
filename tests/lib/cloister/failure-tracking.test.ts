import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_TIME = new Date('2026-05-17T12:00:00.000Z');

describe('agent failure tracking and auto-resume backoff', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let originalNoResume: string | undefined;
  let resumeAgentMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    vi.resetModules();
    vi.clearAllMocks();

    tempHome = mkdtempSync(join(tmpdir(), 'pan-failure-tracking-'));
    originalHome = process.env.PANOPTICON_HOME;
    originalNoResume = process.env.PANOPTICON_NO_RESUME;
    process.env.PANOPTICON_HOME = tempHome;
    delete process.env.PANOPTICON_NO_RESUME;
    resumeAgentMock = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../../src/lib/agents.js');
    vi.doUnmock('../../../src/lib/review-status.js');
    vi.doUnmock('../../../src/lib/shadow-state.js');
    vi.doUnmock('../../../src/lib/activity-logger.js');
    vi.doUnmock('../../../src/lib/persistent-logger.js');
    vi.doUnmock('../../../src/lib/database/app-settings.js');
    vi.doUnmock('../../../src/lib/database/review-status-db.js');
    vi.doUnmock('../../../src/lib/cloister/specialists.js');
    vi.doUnmock('../../../src/lib/tmux.js');
    vi.resetModules();

    if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalHome;
    if (originalNoResume === undefined) delete process.env.PANOPTICON_NO_RESUME;
    else process.env.PANOPTICON_NO_RESUME = originalNoResume;
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function loadAgents() {
    return import('../../../src/lib/agents.js');
  }

  function workspaceFor(agentId: string): string {
    const workspace = join(tempHome, 'workspaces', agentId);
    mkdirSync(workspace, { recursive: true });
    return workspace;
  }

  async function saveStoppedAgent(agentId: string, issueId = 'PAN-1141') {
    const agents = await loadAgents();
    agents.saveAgentStateSync({
      id: agentId,
      issueId,
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
    });
    return agents;
  }

  async function loadDeaconWithResumeMock() {
    vi.doMock('../../../src/lib/agents.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/lib/agents.js')>();
      return {
        ...actual,
        resumeAgent: (...args: unknown[]) => resumeAgentMock(...args),
        listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
        listRunningAgentsSync: vi.fn(() => []),
      };
    });
    vi.doMock('../../../src/lib/review-status.js', () => ({
      getReviewStatus: vi.fn().mockReturnValue({
        reviewStatus: 'blocked',
        testStatus: 'pending',
        verificationStatus: 'passed',
        readyForMerge: false,
      }),
      getReviewStatusSync: vi.fn().mockReturnValue({
        reviewStatus: 'blocked',
        testStatus: 'pending',
        verificationStatus: 'passed',
        readyForMerge: false,
      }),
      loadReviewStatuses: vi.fn().mockReturnValue({}),
      setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
      setReviewStatusSync: vi.fn(),
    }));
    vi.doMock('../../../src/lib/shadow-state.js', () => ({
      getShadowState: vi.fn(() => Effect.succeed(null)),
    }));
    vi.doMock('../../../src/lib/activity-logger.js', () => ({
      emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
      emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
    }));
    vi.doMock('../../../src/lib/persistent-logger.js', () => ({
      logDeaconEvent: vi.fn(),
      logDeaconEventSync: vi.fn(),
      logAgentLifecycle: vi.fn(),
      logAgentLifecycleSync: vi.fn(),
    }));
    vi.doMock('../../../src/lib/database/app-settings.js', () => ({
      isDeaconGloballyPaused: vi.fn().mockReturnValue(false),
    }));
    vi.doMock('../../../src/lib/database/review-status-db.js', () => ({
      markWorkspaceStuck: vi.fn(),
    }));
    vi.doMock('../../../src/lib/cloister/specialists.js', () => ({
      getTmuxSessionName: vi.fn(),
      isRunning: vi.fn().mockResolvedValue(false),
      getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../../../src/lib/tmux.js', () => ({
      buildTmuxCommandString: vi.fn(),
      capturePaneAsync: vi.fn().mockResolvedValue(''),
      createSessionAsync: vi.fn(),
      isPaneDeadAsync: vi.fn().mockResolvedValue(false),
      killSession: vi.fn(),
  killSessionSync: vi.fn(),
      killSessionAsync: vi.fn().mockResolvedValue(undefined),
      listPaneValues: vi.fn().mockReturnValue([]),
      listPaneValuesAsync: vi.fn().mockResolvedValue([]),
      listSessionNamesAsync: vi.fn().mockResolvedValue([]),
      sessionExists: vi.fn().mockReturnValue(false),
      sessionExistsSync: vi.fn().mockReturnValue(false),
      sessionExistsAsync: vi.fn().mockResolvedValue(false),
      sendKeysAsync: vi.fn().mockResolvedValue(undefined),
    }));

    const agents = await import('../../../src/lib/agents.js');
    const deacon = await import('../../../src/lib/cloister/deacon.js');
    return { agents, autoResumeStoppedWorkAgents: deacon.autoResumeStoppedWorkAgents };
  }

  it('increments the counter when resumeAgent fails during auto-resume', async () => {
    const agentId = 'agent-pan-1141-resume-fails';
    resumeAgentMock.mockResolvedValue({ success: false, error: 'tmux crashed' });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
    });

    const resumed = await autoResumeStoppedWorkAgents();
    const state = agents.getAgentStateSync(agentId);

    expect(resumed).toEqual([]);
    expect(resumeAgentMock).toHaveBeenCalledWith(agentId);
    expect(state?.consecutiveFailures).toBe(1);
    expect(state?.lastFailureReason).toContain('tmux crashed');
    expect(state?.lastFailureNextRetryAt).toBe(new Date(BASE_TIME.getTime() + 5_000).toISOString());
  });

  it('increments the counter for orphan-crash observations', async () => {
    const agentId = 'agent-pan-1141-orphan';
    const agents = await saveStoppedAgent(agentId);

    agents.recordAgentFailureSync(agentId, 'orphaned: tmux session missing (patrol)');
    const state = agents.getAgentStateSync(agentId);

    expect(state?.consecutiveFailures).toBe(1);
    expect(state?.lastFailureReason).toBe('orphaned: tmux session missing (patrol)');
    expect(state?.firstFailureInRunAt).toBe(BASE_TIME.toISOString());
  });

  it('resets the counter when an agent reaches running status', async () => {
    const agentId = 'agent-pan-1141-running-reset';
    const agents = await saveStoppedAgent(agentId);
    agents.recordAgentFailureSync(agentId, 'resume failed');

    const state = agents.getAgentStateSync(agentId);
    expect(state?.consecutiveFailures).toBe(1);
    agents.__testInternals.markAgentRunning(state!);
    agents.saveAgentStateSync(state!);

    const updated = agents.getAgentStateSync(agentId);
    expect(updated?.status).toBe('running');
    expect(updated?.consecutiveFailures).toBe(0);
    expect(updated?.firstFailureInRunAt).toBeUndefined();
    expect(updated?.lastFailureAt).toBeUndefined();
    expect(updated?.lastFailureReason).toBeUndefined();
    expect(updated?.lastFailureNextRetryAt).toBeUndefined();
  });

  it('honors 5s, 30s, and 120s backoff windows', async () => {
    const agentId = 'agent-pan-1141-backoff';
    const agents = await saveStoppedAgent(agentId);

    agents.recordAgentFailureSync(agentId, 'first failure');
    expect(agents.getAgentStateSync(agentId)?.lastFailureNextRetryAt).toBe(new Date(BASE_TIME.getTime() + 5_000).toISOString());
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 5_000));
    agents.recordAgentFailureSync(agentId, 'second failure');
    expect(agents.getAgentStateSync(agentId)?.lastFailureNextRetryAt).toBe(new Date(BASE_TIME.getTime() + 35_000).toISOString());
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 35_000));
    agents.recordAgentFailureSync(agentId, 'third failure');
    expect(agents.getAgentStateSync(agentId)?.lastFailureNextRetryAt).toBe(new Date(BASE_TIME.getTime() + 155_000).toISOString());

    resumeAgentMock.mockResolvedValue({ success: true });
    const { autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 154_999));
    await autoResumeStoppedWorkAgents();
    expect(resumeAgentMock).not.toHaveBeenCalled();
  });

  it('treats lastFailureNextRetryAt equality as eligible to retry', async () => {
    const agentId = 'agent-pan-1141-backoff-boundary';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      lastFailureNextRetryAt: BASE_TIME.toISOString(),
    });

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumeAgentMock).toHaveBeenCalledWith(agentId);
    expect(resumed).toEqual([agentId]);
  });

  it('marks an agent troubled after three failures inside the ten-minute window', async () => {
    const agentId = 'agent-pan-1141-troubled';
    const agents = await saveStoppedAgent(agentId);

    agents.recordAgentFailureSync(agentId, 'first');
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 60_000));
    agents.recordAgentFailureSync(agentId, 'second');
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 120_000));
    agents.recordAgentFailureSync(agentId, 'third');

    const state = agents.getAgentStateSync(agentId);
    expect(state?.consecutiveFailures).toBe(3);
    expect(state?.troubled).toBe(true);
    expect(state?.troubledAt).toBe(new Date(BASE_TIME.getTime() + 120_000).toISOString());
  });

  it('does not mark troubled when the failure window slides past ten minutes', async () => {
    const agentId = 'agent-pan-1141-window-slide';
    const agents = await saveStoppedAgent(agentId);

    agents.recordAgentFailureSync(agentId, 'first');
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 11 * 60_000));
    agents.recordAgentFailureSync(agentId, 'second');
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 12 * 60_000));
    agents.recordAgentFailureSync(agentId, 'third');

    const state = agents.getAgentStateSync(agentId);
    expect(state?.consecutiveFailures).toBe(2);
    expect(state?.firstFailureInRunAt).toBe(new Date(BASE_TIME.getTime() + 11 * 60_000).toISOString());
    expect(state?.troubled).toBeUndefined();
  });

  it('uses per-project auto-resume config overrides', async () => {
    writeFileSync(join(tempHome, 'projects.yaml'), `projects:\n  custom:\n    name: Custom\n    path: ${JSON.stringify(tempHome)}\n    issue_prefix: CUS\n    autoResume:\n      maxConsecutiveFailures: 4\n      troubledWindowMs: 300000\n      failureBackoffSchedule:\n        - 2\n        - 4\n`, 'utf-8');
    const agentId = 'agent-cus-1-overrides';
    const agents = await saveStoppedAgent(agentId, 'CUS-1');

    agents.recordAgentFailureSync(agentId, 'first');
    expect(agents.getAgentStateSync(agentId)?.lastFailureNextRetryAt).toBe(new Date(BASE_TIME.getTime() + 2_000).toISOString());
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 2_000));
    agents.recordAgentFailureSync(agentId, 'second');
    expect(agents.getAgentStateSync(agentId)?.lastFailureNextRetryAt).toBe(new Date(BASE_TIME.getTime() + 6_000).toISOString());
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 6_000));
    agents.recordAgentFailureSync(agentId, 'third');
    expect(agents.getAgentStateSync(agentId)?.troubled).toBeUndefined();
    vi.setSystemTime(new Date(BASE_TIME.getTime() + 10_000));
    agents.recordAgentFailureSync(agentId, 'fourth');

    const state = agents.getAgentStateSync(agentId);
    expect(state?.consecutiveFailures).toBe(4);
    expect(state?.troubled).toBe(true);
  });
});
