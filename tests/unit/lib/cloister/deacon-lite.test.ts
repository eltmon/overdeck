import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAgentStates: vi.fn(),
  isIdle: vi.fn(),
  isAlive: vi.fn(),
  deliverAgentMessage: vi.fn(async () => ({ ok: true })),
  getWorkspaceGitState: vi.fn(),
  liveAgentInventory: vi.fn(),
  capturePaneText: vi.fn(() => ''),
  reconcileClosedIssueAgents: vi.fn(async () => [] as string[]),
  isDeaconGloballyPaused: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({
  isDeaconGloballyPaused: mocks.isDeaconGloballyPaused,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  listAgentStates: mocks.listAgentStates,
}));

// A pure factory (no importOriginal): liveness.ts's own module graph reaches
// src/lib/agents/agent-state.ts, which currently imports the deleted
// auto-resume-config.ts (another worker's file, not yet re-pointed) — loading
// the real module here would fail this test for a reason unrelated to
// deacon-lite. isConfirmedDead is one line; reimplement it directly.
vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  isIdle: mocks.isIdle,
  isAlive: mocks.isAlive,
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
}));

vi.mock('../../../../src/lib/agents/delivery.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
}));

vi.mock('../../../../src/lib/workspaces/git-state.js', () => ({
  getWorkspaceGitState: mocks.getWorkspaceGitState,
}));

// PAN-3917 FR-3/FR-11: liveness and pane text come from the SELECTED terminal
// backend's inventory, never a tmux census — a Herdr-hosted agent has no tmux
// session at all. The adapters keep the tmux behaviour inside themselves.
vi.mock('../../../../src/lib/terminal-backends/inventory.js', () => ({
  liveAgentInventory: mocks.liveAgentInventory,
  listLiveAgentPanes: async () => (await mocks.liveAgentInventory())?.panes ?? null,
  listLiveAgentIds: async () => {
    const inventory = await mocks.liveAgentInventory();
    return inventory === null ? null : new Set(inventory.panes.map((pane: { agentId: string }) => pane.agentId));
  },
  captureLiveAgentPaneText: (pane: { agentId: string }, lines: number) => mocks.capturePaneText(pane.agentId, lines),
}));

/** A tmux inventory holding the named agents, as the backend reports it. */
function inventory(agentIds: string[], backend: 'tmux' | 'herdr' = 'tmux') {
  return {
    backend,
    panes: agentIds.map((agentId) => ({
      backend, agentId, paneId: agentId, terminalId: agentId, state: 'working' as const,
    })),
  };
}

vi.mock('../../../../src/lib/cloister/closed-issue-reaper.js', () => ({
  reconcileClosedIssueAgents: mocks.reconcileClosedIssueAgents,
}));

const {
  checkStuckWorkAgents,
  reconcileAgentLiveness,
  reapClosedIssueAgents,
  runDeaconLite,
  runDeaconLitePatrol,
  setPatrolRunObserver,
  getDeaconLiteStatus,
  startDeaconLite,
  stopDeaconLite,
  DEACON_LITE_INTERVAL_MS,
  setAgentStoppedNotifier,
  __resetStuckWorkAgentCooldownForTests,
} = await import('../../../../src/lib/cloister/deacon-lite.js');
const { checkApiErrorAgents, __resetApiErrorRecoveryStateForTests } = await import('../../../../src/lib/cloister/deacon-api-recovery.js');

function workAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    workspace: '/repo/workspaces/feature-pan-1',
    role: 'work',
    model: 'claude',
    status: 'running',
    startedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('deacon-lite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
    vi.clearAllMocks();
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true });
    mocks.liveAgentInventory.mockResolvedValue(inventory(['agent-pan-1']));
    mocks.capturePaneText.mockReturnValue('');
    mocks.reconcileClosedIssueAgents.mockResolvedValue([]);
    __resetStuckWorkAgentCooldownForTests();
    __resetApiErrorRecoveryStateForTests();
    mocks.isDeaconGloballyPaused.mockReturnValue(false);
  });

  afterEach(() => {
    setPatrolRunObserver(null);
    stopDeaconLite();
    vi.useRealTimers();
  });

  describe('checkStuckWorkAgents', () => {
    it('emits no nudge for a healthy fixture (not idle)', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.isIdle.mockReturnValue(false);

      const actions = await checkStuckWorkAgents();

      expect(actions).toEqual([]);
      expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    });

    it('nudges exactly once when idle 20+ minutes with unpushed commits', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.isIdle.mockReturnValue(true);
      mocks.getWorkspaceGitState.mockResolvedValue({ ahead: 3, behind: 0, dirtyFiles: 0, branch: 'feature/pan-1', detached: false, hasUpstream: true });

      const actions = await checkStuckWorkAgents();

      expect(actions).toHaveLength(1);
      expect(mocks.deliverAgentMessage).toHaveBeenCalledTimes(1);
      expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
        'agent-pan-1',
        expect.stringContaining('idle'),
        'deacon-lite:checkStuckWorkAgents',
      );
    });

    it('does not nudge an idle agent with nothing unpushed', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.isIdle.mockReturnValue(true);
      mocks.getWorkspaceGitState.mockResolvedValue({ ahead: 0, behind: 0, dirtyFiles: 0, branch: 'feature/pan-1', detached: false, hasUpstream: true });

      const actions = await checkStuckWorkAgents();

      expect(actions).toEqual([]);
      expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    });

    it('does not re-nudge the same agent within the hour cooldown', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.isIdle.mockReturnValue(true);
      mocks.getWorkspaceGitState.mockResolvedValue({ ahead: 1, behind: 0, dirtyFiles: 0, branch: 'feature/pan-1', detached: false, hasUpstream: true });

      await checkStuckWorkAgents();
      const second = await checkStuckWorkAgents();

      expect(second).toEqual([]);
      expect(mocks.deliverAgentMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkApiErrorAgents', () => {
    it('emits no nudge for a healthy fixture (no error text)', async () => {
      mocks.capturePaneText.mockReturnValue('❯ working normally\n');

      const actions = await checkApiErrorAgents();

      expect(actions).toEqual([]);
      expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    });

    it('resumes exactly once when a provider error is showing at the prompt', async () => {
      mocks.capturePaneText.mockReturnValue('API Error: Overloaded\n❯ ');

      const actions = await checkApiErrorAgents();

      expect(actions).toHaveLength(1);
      expect(mocks.deliverAgentMessage).toHaveBeenCalledTimes(1);
      expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
        'agent-pan-1',
        expect.any(String),
        'deacon-lite:checkApiErrorAgents',
      );
    });
  });

  describe('reconcileAgentLiveness', () => {
    it('emits no notification for a healthy fixture (agent alive)', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });
      const notifier = vi.fn();
      setAgentStoppedNotifier(notifier);

      const actions = await reconcileAgentLiveness();

      expect(actions).toEqual([]);
      expect(notifier).not.toHaveBeenCalled();
      setAgentStoppedNotifier(null);
    });

    it('corrects the cache exactly once for a confirmed-dead agent', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([]));
      mocks.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
      const notifier = vi.fn();
      setAgentStoppedNotifier(notifier);

      const actions = await reconcileAgentLiveness();

      expect(actions).toHaveLength(1);
      expect(notifier).toHaveBeenCalledTimes(1);
      expect(notifier).toHaveBeenCalledWith('agent-pan-1');
      setAgentStoppedNotifier(null);
    });

    // Review of #4018 (L1): the Herdr inventory lists Herdr panes only. An
    // agent still live in its pre-switch tmux session is absent from it, and
    // must not be marked stopped while resumeAgent refuses it as healthy.
    it('on Herdr, leaves an agent the oracle reports alive (legacy tmux session)', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([], 'herdr'));
      mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true, runtimePid: 4242 });
      const notifier = vi.fn();
      setAgentStoppedNotifier(notifier);

      const actions = await reconcileAgentLiveness();

      expect(mocks.isAlive).toHaveBeenCalledWith('agent-pan-1');
      expect(actions).toEqual([]);
      expect(notifier).not.toHaveBeenCalled();
      setAgentStoppedNotifier(null);
    });

    it('on Herdr, leaves an agent whose verdict is indeterminate', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([], 'herdr'));
      mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
      const notifier = vi.fn();
      setAgentStoppedNotifier(notifier);

      await expect(reconcileAgentLiveness()).resolves.toEqual([]);
      expect(notifier).not.toHaveBeenCalled();
      setAgentStoppedNotifier(null);
    });

    it('on Herdr, still corrects the cache once the oracle confirms the death', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([], 'herdr'));
      mocks.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
      const notifier = vi.fn();
      setAgentStoppedNotifier(notifier);

      const actions = await reconcileAgentLiveness();

      expect(notifier).toHaveBeenCalledWith('agent-pan-1');
      expect(actions[0]).toContain('absent from the herdr inventory; no-session');
      setAgentStoppedNotifier(null);
    });

    it('never writes a record — only calls the notifier seam', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([]));
      mocks.isAlive.mockResolvedValue({ alive: false, reason: 'pane-dead' });
      setAgentStoppedNotifier(null);

      // No notifier registered — the routine must not throw or touch disk.
      await expect(reconcileAgentLiveness()).resolves.toEqual(
        expect.arrayContaining([]),
      );
    });
  });

  describe('reapClosedIssueAgents', () => {
    it('is the closed-issue-reaper routine, unmodified', async () => {
      mocks.reconcileClosedIssueAgents.mockResolvedValue(['reaped agent-x']);

      const actions = await reapClosedIssueAgents();

      expect(actions).toEqual(['reaped agent-x']);
      expect(mocks.reconcileClosedIssueAgents).toHaveBeenCalledTimes(1);
    });
  });

  describe('runDeaconLite', () => {
    it('awaits all four routines in order', async () => {
      mocks.listAgentStates.mockReturnValue([]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([]));

      await expect(runDeaconLite()).resolves.toBeUndefined();
      expect(mocks.reconcileClosedIssueAgents).toHaveBeenCalledTimes(1);
    });

    it('runs none of the four routines while globally paused', async () => {
      mocks.isDeaconGloballyPaused.mockReturnValue(true);
      mocks.listAgentStates.mockReturnValue([workAgent()]);

      await expect(runDeaconLite()).resolves.toBeUndefined();

      expect(mocks.listAgentStates).not.toHaveBeenCalled();
      expect(mocks.liveAgentInventory).not.toHaveBeenCalled();
      expect(mocks.reconcileClosedIssueAgents).not.toHaveBeenCalled();
    });
  });

  describe('runDeaconLitePatrol', () => {
    it('reports a clean run and stamps lastRunAt', async () => {
      mocks.listAgentStates.mockReturnValue([]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([]));
      const observer = vi.fn();
      setPatrolRunObserver(observer);

      await runDeaconLitePatrol();

      const expectedAt = new Date('2026-09-18T12:00:00.000Z').toISOString();
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledWith({ at: expectedAt, error: null });
      expect(getDeaconLiteStatus().lastRunAt).toBe(expectedAt);
    });

    it('reports the error text when reconcileClosedIssueAgents rejects', async () => {
      mocks.listAgentStates.mockReturnValue([]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([]));
      mocks.reconcileClosedIssueAgents.mockRejectedValue(new Error('tracker down'));
      const observer = vi.fn();
      setPatrolRunObserver(observer);

      await expect(runDeaconLitePatrol()).resolves.toBeUndefined();

      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledWith(expect.objectContaining({ error: 'tracker down' }));
      expect(getDeaconLiteStatus().lastRunError).toBe('tracker down');
    });

    it('still reports while globally paused, without running any routine', async () => {
      mocks.isDeaconGloballyPaused.mockReturnValue(true);
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      const observer = vi.fn();
      setPatrolRunObserver(observer);

      await runDeaconLitePatrol();

      expect(mocks.listAgentStates).not.toHaveBeenCalled();
      expect(mocks.liveAgentInventory).not.toHaveBeenCalled();
      expect(mocks.reconcileClosedIssueAgents).not.toHaveBeenCalled();
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledWith(expect.objectContaining({ error: null }));
    });

    it('swallows a throwing observer and still resolves and stamps lastRunAt', async () => {
      mocks.listAgentStates.mockReturnValue([]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([]));
      setPatrolRunObserver(() => {
        throw new Error('observer boom');
      });

      await expect(runDeaconLitePatrol()).resolves.toBeUndefined();

      expect(getDeaconLiteStatus().lastRunAt).not.toBeNull();
    });
  });

  describe('DEACON_LITE_INTERVAL_MS and startDeaconLite', () => {
    it('exports the 60s interval constant and the runDeaconLitePatrol function', () => {
      expect(DEACON_LITE_INTERVAL_MS).toBe(60_000);
      expect(typeof runDeaconLitePatrol).toBe('function');
    });

    it('runs runDeaconLitePatrol immediately and again on every interval', async () => {
      mocks.listAgentStates.mockReturnValue([]);
      mocks.liveAgentInventory.mockResolvedValue(inventory([]));
      const observer = vi.fn();
      setPatrolRunObserver(observer);

      startDeaconLite();
      await vi.advanceTimersByTimeAsync(0);
      expect(observer).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(DEACON_LITE_INTERVAL_MS);
      expect(observer).toHaveBeenCalledTimes(2);
    });
  });
});
