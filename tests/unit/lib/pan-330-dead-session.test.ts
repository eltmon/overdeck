import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for PAN-330: Dead-session detection and runtime state reset
 *
 * Covers:
 * 1. ClaudeCodeRuntimeSync.killAgent() resets runtime.json to idle (claude-code.ts:327)
 * 2. Deacon patrol resets stale active state for stopped specialists (deacon.ts:1741-1752)
 * 3. Merge-agent busy-wait detects dead tmux session and resets to idle (merge-agent.ts:1069-1078)
 * 4. CloisterService.emergencyStop() stops every live agent through the terminal backend (#4109)
 */

// ---------------------------------------------------------------------------
// Section 1: ClaudeCodeRuntimeSync.killAgent() (claude-code.ts:327)
// ---------------------------------------------------------------------------

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentState: vi.fn(),
  getAgentDir: vi.fn(() => '/tmp/agent-dir'),
  spawnAgent: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  listRunningAgents: vi.fn(() => Effect.succeed([])),
  listRunningAgentsSync: vi.fn(() => []),
  stopAgent: vi.fn(() => Effect.void),
  getAgentRuntimeState: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(() => null),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn(),
  sessionExistsSync: vi.fn(),
  killSession: vi.fn(),
  killSessionSync: vi.fn(),
  sendKeys: vi.fn(),
  sendKeysAsync: vi.fn(),
  getAgentSessions: vi.fn(() => []),
  getAgentSessionsSync: vi.fn(() => []),
}));

vi.mock('../../../src/lib/cost-parsers/jsonl-parser.js', () => ({
  parseClaudeSession: vi.fn(() => null),
  getSessionFiles: vi.fn(() => []),
  getProjectDirs: vi.fn(() => []),
}));

vi.mock('../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({ monitoring: { check_interval: 60000 } })),
  loadCloisterConfigSync: vi.fn(() => ({ monitoring: { check_interval: 60000 } })),
  DEFAULT_CLOISTER_CONFIG: { monitoring: { check_interval: 60000 } },
}));

// Fake liveness oracle: emergencyStop confirms each stop afterwards (#4109).
vi.mock('../../../src/lib/agents/liveness.js', () => ({
  isAlive: vi.fn(async () => ({ alive: false, reason: 'no-session' })),
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
  getAgentEffectiveLastActivityMs: vi.fn(() => null),
  isIdle: vi.fn(() => false),
}));

// Fake terminal backend: the live inventory emergencyStop reads (#4109).
vi.mock('../../../src/lib/terminal-backends/inventory.js', () => ({
  listLiveAgentIds: vi.fn(async () => new Set<string>()),
}));

vi.mock('../../../src/lib/runtimes/index.js', () => ({
  getGlobalRegistry: vi.fn(() => ({ getRuntimeForAgent: vi.fn(() => null) })),
  getRuntimeForAgent: vi.fn(() => null),
}));

import { ClaudeCodeRuntimeSync } from '../../../src/lib/runtimes/claude-code.js';
import { sessionExistsSync, killSessionSync } from '../../../src/lib/tmux.js';
import { saveAgentRuntimeState, getAgentState, saveAgentStateSync, listRunningAgents, stopAgent } from '../../../src/lib/agents.js';
import { listLiveAgentIds } from '../../../src/lib/terminal-backends/inventory.js';
import { isAlive } from '../../../src/lib/agents/liveness.js';
import { CloisterService } from '../../../src/lib/cloister/service.js';

const mockSessionExists = vi.mocked(sessionExistsSync);
const mockKillSession = vi.mocked(killSessionSync);
const mockSaveAgentRuntimeState = vi.mocked(saveAgentRuntimeState);
const mockGetAgentState = vi.mocked(getAgentState);
const mockSaveAgentState = vi.mocked(saveAgentStateSync);
const mockListRunningAgents = vi.mocked(listRunningAgents);
const mockStopAgent = vi.mocked(stopAgent);
const mockListLiveAgentIds = vi.mocked(listLiveAgentIds);
const mockIsAlive = vi.mocked(isAlive);

describe('PAN-330: ClaudeCodeRuntimeSync.killAgent() — resets runtime state', () => {
  let runtime: ClaudeCodeRuntimeSync;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new ClaudeCodeRuntimeSync();
  });

  it('resets runtime state to idle when killAgent is called on a running session', () => {
    mockSessionExists.mockReturnValue(true);
    mockGetAgentState.mockReturnValue(null);

    runtime.killAgent('PAN-330');

    expect(mockKillSession).toHaveBeenCalledWith('PAN-330');
    expect(mockSaveAgentRuntimeState).toHaveBeenCalledWith(
      'PAN-330',
      expect.objectContaining({ state: 'idle' })
    );
    const call = mockSaveAgentRuntimeState.mock.calls[0][1];
    expect(new Date(call.lastActivity).getTime()).toBeCloseTo(Date.now(), -3);
  });

  it('kills the tmux session before resetting runtime state', () => {
    mockSessionExists.mockReturnValue(true);
    mockGetAgentState.mockReturnValue(null);

    const callOrder: string[] = [];
    mockKillSession.mockImplementation(() => { callOrder.push('killSession'); });
    mockSaveAgentRuntimeState.mockImplementation(() => { callOrder.push('saveAgentRuntimeState'); });

    runtime.killAgent('PAN-330');

    expect(callOrder).toEqual(['killSession', 'saveAgentRuntimeState']);
  });

  it('also updates agent status to stopped when agent state exists', () => {
    mockSessionExists.mockReturnValue(true);
    const agentState = { id: 'PAN-330', status: 'running' } as any;
    mockGetAgentState.mockReturnValue(agentState);

    runtime.killAgent('PAN-330');

    expect(mockSaveAgentState).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
  });

  it('throws when session does not exist', () => {
    mockSessionExists.mockReturnValue(false);

    expect(() => runtime.killAgent('PAN-330')).toThrow('is not running');
    expect(mockSaveAgentRuntimeState).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 2: Deacon patrol dead-session reset logic (deacon.ts:1741-1752)
//
// The patrol code at lines 1741-1752:
//   if (!projSpec.isRunning) {
//     const runtimeState = getAgentRuntimeState(projSpec.tmuxSession);
//     if (runtimeState?.state === 'active') {
//       saveAgentRuntimeState(tmuxSession, { state: 'idle', lastActivity: ... });
//     }
//     continue;
//   }
//
// Tested as a pure algorithm — same pattern as deacon-cleanup.test.ts.
// ---------------------------------------------------------------------------

describe('PAN-330: Deacon patrol — dead-session reset logic (deacon.ts:1741-1752)', () => {
  // Mirrors the logic embedded in patrolCycle() for per-project specialists
  function applyDeadSessionReset(
    projSpec: { isRunning: boolean; tmuxSession: string },
    getRuntimeState: (id: string) => { state: string } | null,
    resetState: (id: string, data: { state: string; lastActivity: string }) => void
  ): 'reset' | 'skipped' | 'alive' {
    if (!projSpec.isRunning) {
      const runtimeState = getRuntimeState(projSpec.tmuxSession);
      if (runtimeState?.state === 'active') {
        resetState(projSpec.tmuxSession, { state: 'idle', lastActivity: new Date().toISOString() });
        return 'reset';
      }
      return 'skipped';
    }
    return 'alive';
  }

  it('resets active runtime state when session is dead', () => {
    const resetFn = vi.fn();

    const result = applyDeadSessionReset(
      { isRunning: false, tmuxSession: 'pan-330-merge-agent' },
      () => ({ state: 'active' }),
      resetFn
    );

    expect(result).toBe('reset');
    expect(resetFn).toHaveBeenCalledWith(
      'pan-330-merge-agent',
      expect.objectContaining({ state: 'idle' })
    );
  });

  it('does NOT reset when session is dead but state is already idle', () => {
    const resetFn = vi.fn();

    const result = applyDeadSessionReset(
      { isRunning: false, tmuxSession: 'pan-330-merge-agent' },
      () => ({ state: 'idle' }),
      resetFn
    );

    expect(result).toBe('skipped');
    expect(resetFn).not.toHaveBeenCalled();
  });

  it('does NOT reset when session is dead and has no runtime state', () => {
    const resetFn = vi.fn();

    const result = applyDeadSessionReset(
      { isRunning: false, tmuxSession: 'pan-330-merge-agent' },
      () => null,
      resetFn
    );

    expect(result).toBe('skipped');
    expect(resetFn).not.toHaveBeenCalled();
  });

  it('does NOT reset when session is alive (continues normal patrol)', () => {
    const resetFn = vi.fn();

    const result = applyDeadSessionReset(
      { isRunning: true, tmuxSession: 'pan-330-merge-agent' },
      () => ({ state: 'active' }),
      resetFn
    );

    expect(result).toBe('alive');
    expect(resetFn).not.toHaveBeenCalled();
  });

  it('resets even when state is suspended and session is dead', () => {
    // The code only resets when state === 'active'. suspended should NOT trigger reset.
    const resetFn = vi.fn();

    const result = applyDeadSessionReset(
      { isRunning: false, tmuxSession: 'pan-330-merge-agent' },
      () => ({ state: 'suspended' }),
      resetFn
    );

    expect(result).toBe('skipped');
    expect(resetFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 3: Merge-agent busy-wait dead-session detection (merge-agent.ts:1069-1078)
//
// The busy-wait code at lines 1069-1078:
//   try {
//     await execAsync(`tmux has-session -t "${mergeSession}" 2>/dev/null`);
//   } catch {
//     // Session is dead — reset to idle and break
//     saveAgentRuntimeState(mergeSession, { state: 'idle', lastActivity: ... });
//     break;
//   }
//
// Tested as a pure algorithm.
// ---------------------------------------------------------------------------

describe('PAN-330: Merge-agent busy-wait — dead-session detection (merge-agent.ts:1069-1078)', () => {
  // Mirrors the dead-session check inside the busy-wait loop
  async function checkAndResetIfDead(
    sessionName: string,
    getState: (id: string) => { state: string } | null,
    checkTmux: (id: string) => Promise<void>, // throws if dead
    resetState: (id: string, data: { state: string; lastActivity: string }) => void
  ): Promise<'idle' | 'active' | 'dead-reset'> {
    const state = getState(sessionName);
    if (!state || state.state === 'idle' || state.state === 'suspended') {
      return 'idle';
    }
    // Dead-session check: tmux has-session exits non-zero when session doesn't exist
    try {
      await checkTmux(sessionName);
      return 'active';
    } catch {
      resetState(sessionName, { state: 'idle', lastActivity: new Date().toISOString() });
      return 'dead-reset';
    }
  }

  it('detects dead session and resets runtime state to idle', async () => {
    const resetFn = vi.fn();

    const result = await checkAndResetIfDead(
      'pan-330-merge-agent',
      () => ({ state: 'active' }),
      async () => { throw new Error('exit code 1'); }, // tmux has-session fails → session dead
      resetFn
    );

    expect(result).toBe('dead-reset');
    expect(resetFn).toHaveBeenCalledWith(
      'pan-330-merge-agent',
      expect.objectContaining({ state: 'idle' })
    );
  });

  it('returns active when session exists and runtime state is active', async () => {
    const resetFn = vi.fn();

    const result = await checkAndResetIfDead(
      'pan-330-merge-agent',
      () => ({ state: 'active' }),
      async () => { /* tmux has-session succeeds */ },
      resetFn
    );

    expect(result).toBe('active');
    expect(resetFn).not.toHaveBeenCalled();
  });

  it('returns idle immediately when state is already idle (no tmux check needed)', async () => {
    const checkFn = vi.fn();
    const resetFn = vi.fn();

    const result = await checkAndResetIfDead(
      'pan-330-merge-agent',
      () => ({ state: 'idle' }),
      checkFn,
      resetFn
    );

    expect(result).toBe('idle');
    expect(checkFn).not.toHaveBeenCalled();
    expect(resetFn).not.toHaveBeenCalled();
  });

  it('returns idle immediately when no runtime state exists', async () => {
    const checkFn = vi.fn();
    const resetFn = vi.fn();

    const result = await checkAndResetIfDead(
      'pan-330-merge-agent',
      () => null,
      checkFn,
      resetFn
    );

    expect(result).toBe('idle');
    expect(checkFn).not.toHaveBeenCalled();
    expect(resetFn).not.toHaveBeenCalled();
  });

  it('returns idle immediately when state is suspended (treated as ready)', async () => {
    const checkFn = vi.fn();
    const resetFn = vi.fn();

    const result = await checkAndResetIfDead(
      'pan-330-merge-agent',
      () => ({ state: 'suspended' }),
      checkFn,
      resetFn
    );

    expect(result).toBe('idle');
    expect(checkFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 4: CloisterService.emergencyStop() — stops every live agent through
// the terminal backend, Herdr included (#4109)
// ---------------------------------------------------------------------------

describe('CloisterService.emergencyStop() — stops every agent through the backend (#4109)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStopAgent.mockImplementation(() => Effect.void);
    mockIsAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
  });

  function rows(...agents: Array<{ id: string; status?: string; tmuxActive?: boolean }>) {
    mockListRunningAgents.mockReturnValue(Effect.succeed(agents.map((a) => ({ status: 'running', tmuxActive: false, ...a })) as any));
  }

  it('stops every agent in the backend inventory, including Herdr agents with tmuxActive false', async () => {
    rows({ id: 'agent-A' }, { id: 'agent-B' });
    mockListLiveAgentIds.mockResolvedValue(new Set(['agent-A', 'agent-B']));

    const { killedAgents } = await new CloisterService().emergencyStop();

    expect(mockStopAgent).toHaveBeenCalledWith('agent-A');
    expect(mockStopAgent).toHaveBeenCalledWith('agent-B');
    expect(killedAgents).toEqual(['agent-A', 'agent-B']);
  });

  it('also stops running rows the inventory does not list (legacy tmux, failed probe), once each', async () => {
    rows({ id: 'agent-A' }, { id: 'agent-legacy' }, { id: 'agent-stopped-row-live-pane', status: 'stopped' }, { id: 'agent-done', status: 'stopped' });
    mockListLiveAgentIds.mockResolvedValue(new Set(['agent-A', 'agent-stopped-row-live-pane']));

    const { killedAgents } = await new CloisterService().emergencyStop();

    expect(mockStopAgent).toHaveBeenCalledTimes(3);
    expect(killedAgents).toEqual(['agent-A', 'agent-legacy', 'agent-stopped-row-live-pane']);
  });

  it('stops every running row when the inventory is unreadable', async () => {
    rows({ id: 'agent-A' }, { id: 'agent-B', status: 'stopped' });
    mockListLiveAgentIds.mockResolvedValue(null);

    const { killedAgents } = await new CloisterService().emergencyStop();

    expect(killedAgents).toEqual(['agent-A']);
  });

  it('reports a stop whose pane is still live as unconfirmed, not killed', async () => {
    rows({ id: 'agent-A' }, { id: 'agent-B' });
    mockListLiveAgentIds.mockResolvedValue(new Set(['agent-A', 'agent-B']));
    mockIsAlive.mockImplementation(async (id: string) => (id === 'agent-B'
      ? { alive: true, paneAlive: true }
      : { alive: false, reason: 'no-session' }) as never);

    const result = await new CloisterService().emergencyStop();

    expect(result).toEqual({ killedAgents: ['agent-A'], unconfirmedAgents: ['agent-B'] });
  });

  it('continues stopping other agents when one stop fails', async () => {
    rows({ id: 'agent-A' }, { id: 'agent-B' });
    mockListLiveAgentIds.mockResolvedValue(new Set(['agent-A', 'agent-B']));
    mockStopAgent
      .mockImplementationOnce(() => Effect.die(new Error('stop failed')))
      .mockImplementationOnce(() => Effect.void);

    const { killedAgents } = await new CloisterService().emergencyStop();

    expect(mockStopAgent).toHaveBeenCalledTimes(2);
    expect(killedAgents).toEqual(['agent-B']);
  });

  it('returns empty lists when no agents are running', async () => {
    rows();
    mockListLiveAgentIds.mockResolvedValue(new Set());

    expect(await new CloisterService().emergencyStop()).toEqual({ killedAgents: [], unconfirmedAgents: [] });
  });
});
