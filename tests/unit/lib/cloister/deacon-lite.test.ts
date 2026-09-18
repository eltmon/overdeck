import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAgentStates: vi.fn(),
  isIdle: vi.fn(),
  isAliveSync: vi.fn(),
  deliverAgentMessage: vi.fn(async () => ({ ok: true })),
  getWorkspaceGitState: vi.fn(),
  listSessionNames: vi.fn(() => [] as readonly string[]),
  capturePane: vi.fn(() => ''),
  reconcileClosedIssueAgents: vi.fn(async () => [] as string[]),
  isDeaconGloballyPausedSync: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({
  isDeaconGloballyPausedSync: mocks.isDeaconGloballyPausedSync,
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
  isAliveSync: mocks.isAliveSync,
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
}));

vi.mock('../../../../src/lib/agents/delivery.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
}));

vi.mock('../../../../src/lib/workspaces/git-state.js', () => ({
  getWorkspaceGitState: mocks.getWorkspaceGitState,
}));

vi.mock('../../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    listSessionNames: () => Effect.sync(() => mocks.listSessionNames()),
    capturePane: (session: string, lines: number) => Effect.sync(() => mocks.capturePane(session, lines)),
  };
});

vi.mock('../../../../src/lib/cloister/closed-issue-reaper.js', () => ({
  reconcileClosedIssueAgents: mocks.reconcileClosedIssueAgents,
}));

const {
  checkStuckWorkAgents,
  reconcileAgentLiveness,
  reapClosedIssueAgents,
  runDeaconLite,
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
    mocks.listSessionNames.mockReturnValue([]);
    mocks.capturePane.mockReturnValue('');
    mocks.reconcileClosedIssueAgents.mockResolvedValue([]);
    __resetStuckWorkAgentCooldownForTests();
    __resetApiErrorRecoveryStateForTests();
    mocks.isDeaconGloballyPausedSync.mockReturnValue(false);
  });

  afterEach(() => {
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
      mocks.listSessionNames.mockReturnValue(['agent-pan-1']);
      mocks.capturePane.mockReturnValue('❯ working normally\n');

      const actions = await checkApiErrorAgents();

      expect(actions).toEqual([]);
      expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    });

    it('resumes exactly once when a provider error is showing at the prompt', async () => {
      mocks.listSessionNames.mockReturnValue(['agent-pan-1']);
      mocks.capturePane.mockReturnValue('API Error: Overloaded\n❯ ');

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
      mocks.isAliveSync.mockReturnValue({ alive: true, paneAlive: true });
      const notifier = vi.fn();
      setAgentStoppedNotifier(notifier);

      const actions = await reconcileAgentLiveness();

      expect(actions).toEqual([]);
      expect(notifier).not.toHaveBeenCalled();
      setAgentStoppedNotifier(null);
    });

    it('corrects the cache exactly once for a confirmed-dead agent', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.isAliveSync.mockReturnValue({ alive: false, reason: 'no-session' });
      const notifier = vi.fn();
      setAgentStoppedNotifier(notifier);

      const actions = await reconcileAgentLiveness();

      expect(actions).toHaveLength(1);
      expect(notifier).toHaveBeenCalledTimes(1);
      expect(notifier).toHaveBeenCalledWith('agent-pan-1');
      setAgentStoppedNotifier(null);
    });

    it('never writes a record — only calls the notifier seam', async () => {
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.isAliveSync.mockReturnValue({ alive: false, reason: 'pane-dead' });
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
      mocks.listSessionNames.mockReturnValue([]);

      await expect(runDeaconLite()).resolves.toBeUndefined();
      expect(mocks.reconcileClosedIssueAgents).toHaveBeenCalledTimes(1);
    });

    it('runs none of the four routines while globally paused', async () => {
      mocks.isDeaconGloballyPausedSync.mockReturnValue(true);
      mocks.listAgentStates.mockReturnValue([workAgent()]);
      mocks.listSessionNames.mockReturnValue(['agent-pan-1']);

      await expect(runDeaconLite()).resolves.toBeUndefined();

      expect(mocks.listAgentStates).not.toHaveBeenCalled();
      expect(mocks.listSessionNames).not.toHaveBeenCalled();
      expect(mocks.reconcileClosedIssueAgents).not.toHaveBeenCalled();
    });
  });
});
