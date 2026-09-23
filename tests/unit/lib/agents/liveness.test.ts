/**
 * PAN-3849 (W32): the single liveness oracle.
 *
 * isAlive/isAliveSync verdict cases use the modules' dependency seams (no
 * vi.mock). The idle cases are ported from the retired cloister/agent-idle.ts
 * test files (PAN-1586, PAN-3846) and mock the runtime-state / runtimes /
 * tmux modules the activity signals read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgentRuntimeStateSync: vi.fn(),
  getRuntimeForAgent: vi.fn(),
  listPaneValuesSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/runtime-state.js', () => ({
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  listPaneValuesSync: mocks.listPaneValuesSync,
}));

import {
  getAgentEffectiveLastActivityMs,
  idleAgeMs,
  isAlive,
  isAliveSync,
  isConfirmedDead,
  isIdle,
  registerLivenessHeartbeatLookup,
} from '../../../../src/lib/agents/liveness.js';

// The heartbeat reaches liveness through the registration seam (the barrel
// registers at load; tests register their fixture instead).
beforeEach(() => {
  registerLivenessHeartbeatLookup((agentId) => mocks.getRuntimeForAgent(agentId)?.getHeartbeat?.(agentId) ?? null);
});
afterEach(() => {
  registerLivenessHeartbeatLookup(null);
});

const NOW = new Date('2026-09-17T12:00:00Z').getTime();

// ─── isAlive (AC1, AC2) ─────────────────────────────────────────────────────

function aliveDeps(overrides: Record<string, unknown> = {}) {
  return {
    sessionExists: vi.fn(async () => true),
    listPaneRows: vi.fn(async () => [{ pid: '100', dead: false }]),
    findRuntimePid: vi.fn(async () => 100 as number | null),
    readHarness: vi.fn(() => 'claude-code' as const),
    ...overrides,
  };
}

describe('isAlive: the single liveness oracle (PAN-3849)', () => {
  it('AC1: returns no-session when the tmux session is absent', async () => {
    const deps = aliveDeps({ sessionExists: vi.fn(async () => false) });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: false, reason: 'no-session' });
    expect(deps.listPaneRows).not.toHaveBeenCalled();
  });

  it('AC2: returns pane-dead when every pane is dead (remain-on-exit zombie)', async () => {
    const deps = aliveDeps({ listPaneRows: vi.fn(async () => [{ pid: '100', dead: true }]) });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: false, reason: 'pane-dead' });
  });

  it('AC2: returns runtime-missing when a live pane has no harness process in its subtree', async () => {
    const deps = aliveDeps({ findRuntimePid: vi.fn(async () => null) });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: false, reason: 'runtime-missing' });
  });

  it('AC2: returns alive with the runtime pid when session, pane, and harness process are all present', async () => {
    await expect(isAlive('agent-x', aliveDeps())).resolves.toEqual({ alive: true, paneAlive: true, runtimePid: 100 });
  });

  it('skips dead panes and walks the live one (supervisor launcher shape)', async () => {
    const findRuntimePid = vi.fn(async (pid: string) => (pid === '200' ? 200 : null));
    const deps = aliveDeps({
      listPaneRows: vi.fn(async () => [{ pid: '100', dead: true }, { pid: '200', dead: false }]),
      findRuntimePid,
    });
    const verdict = await isAlive('agent-x', deps);
    expect(verdict.alive).toBe(true);
    expect(findRuntimePid).toHaveBeenCalledWith('200', 'claude-code');
  });

  it('returns runtime-indeterminate when the probe itself fails (not confirmed death)', async () => {
    const deps = aliveDeps({ findRuntimePid: vi.fn(async () => 'indeterminate' as const) });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: false, reason: 'runtime-indeterminate' });
  });

  it('prefers a found runtime over an indeterminate sibling pane', async () => {
    const findRuntimePid = vi.fn(async (pid: string) => (pid === '200' ? 200 : 'indeterminate' as const));
    const deps = aliveDeps({
      listPaneRows: vi.fn(async () => [{ pid: '100', dead: false }, { pid: '200', dead: false }]),
      findRuntimePid,
    });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: true, paneAlive: true, runtimePid: 200 });
  });

  it('returns runtime-indeterminate when one pane is indeterminate and none holds the runtime', async () => {
    const findRuntimePid = vi.fn(async (pid: string) => (pid === '100' ? 'indeterminate' as const : null));
    const deps = aliveDeps({
      listPaneRows: vi.fn(async () => [{ pid: '100', dead: false }, { pid: '200', dead: false }]),
      findRuntimePid,
    });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: false, reason: 'runtime-indeterminate' });
  });
});

// ─── Herdr backend (PAN-3917 W12) ───────────────────────────────────────────

/**
 * A Herdr agent has no tmux session at all: the tmux probe would answer
 * `no-session` for every healthy agent and the remediators (deacon-lite,
 * feedback routing, the parked sweeper) would reap the fleet. On a Herdr host
 * the backend's own agent registry is the oracle.
 */
describe('isAlive on the Herdr backend', () => {
  it('reports a detected agent alive without touching tmux', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'alive' as const, paneId: 'wE:p2', state: 'working' as const })),
    });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: true, paneAlive: true });
    expect(deps.sessionExists).not.toHaveBeenCalled();
    expect(deps.listPaneRows).not.toHaveBeenCalled();
  });

  it('reports a PANE-BOUND agent alive on its pane alone, state and all', async () => {
    // A codex / ACP / kimi agent runs behind a host process, so Herdr detects
    // nothing in its pane and reports `unknown`. The probe answers from the
    // token-stamped pane; "Herdr has no agent record" is not a death.
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'alive' as const, paneId: 'wE:p2', state: 'unknown' as const })),
    });
    await expect(isAlive('agent-pan-3705-review', deps)).resolves.toEqual({ alive: true, paneAlive: true });
  });

  it('reports an agent Herdr does not know as no-session (a confirmed death)', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'absent' as const })),
      sessionExists: vi.fn(async () => false),
    });
    const verdict = await isAlive('agent-x', deps);
    expect(verdict).toEqual({ alive: false, reason: 'no-session' });
    expect(isConfirmedDead(verdict)).toBe(true);
  });

  // Review of #3992 (M3): an agent launched before the host moved to Herdr
  // still runs in a tmux session Herdr knows nothing about.
  it('reports a live legacy tmux agent alive when Herdr does not know it', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'absent' as const })),
    });
    const verdict = await isAlive('agent-legacy', deps);
    expect(verdict).toEqual({ alive: true, paneAlive: true, runtimePid: 100 });
    expect(deps.sessionExists).toHaveBeenCalledWith('agent-legacy');
  });

  it('a legacy tmux session whose probe cannot answer is indeterminate, never a death', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'absent' as const })),
      findRuntimePid: vi.fn(async () => 'indeterminate' as const),
    });
    const verdict = await isAlive('agent-legacy', deps);
    expect(verdict).toEqual({ alive: false, reason: 'runtime-indeterminate' });
    expect(isConfirmedDead(verdict)).toBe(false);
  });

  it('a legacy tmux corpse (session up, harness gone) stays a confirmed death', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'absent' as const })),
      findRuntimePid: vi.fn(async () => null),
    });
    const verdict = await isAlive('agent-legacy', deps);
    expect(verdict).toEqual({ alive: false, reason: 'no-session' });
    expect(isConfirmedDead(verdict)).toBe(true);
  });

  it('does not consult tmux when Herdr itself answers (exited)', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'exited' as const, paneId: 'wE:p2' })),
    });
    await isAlive('agent-x', deps);
    expect(deps.sessionExists).not.toHaveBeenCalled();
  });

  it('reports an exited pane as pane-dead', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'exited' as const, paneId: 'wE:p2' })),
    });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: false, reason: 'pane-dead' });
  });

  it('a Herdr socket outage is runtime-indeterminate, NEVER a confirmed death', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => ({ kind: 'indeterminate' as const, reason: 'timeout' })),
    });
    const verdict = await isAlive('agent-x', deps);
    expect(verdict).toEqual({ alive: false, reason: 'runtime-indeterminate' });
    expect(isConfirmedDead(verdict)).toBe(false);
  });

  it('a probe that throws is indeterminate too — a broken probe must not kill', async () => {
    const deps = aliveDeps({
      backend: 'herdr' as const,
      probeHerdr: vi.fn(async () => { throw new Error('socket closed'); }),
    });
    expect(isConfirmedDead(await isAlive('agent-x', deps))).toBe(false);
  });

  it('keeps the tmux three-check probe when the backend is tmux', async () => {
    const probeHerdr = vi.fn();
    const deps = aliveDeps({ backend: 'tmux' as const, probeHerdr });
    await expect(isAlive('agent-x', deps)).resolves.toEqual({ alive: true, paneAlive: true, runtimePid: 100 });
    expect(probeHerdr).not.toHaveBeenCalled();
  });
});

// ─── isAliveSync (lifecycle-classifier variant) ─────────────────────────────

function aliveSyncDeps(overrides: Record<string, unknown> = {}) {
  return {
    sessionExistsSync: vi.fn(() => true),
    listPaneRowsSync: vi.fn(() => [{ pid: '100', dead: false }]),
    findRuntimePidSync: vi.fn(() => 100 as number | null),
    readHarness: vi.fn(() => 'claude-code' as const),
    ...overrides,
  };
}

describe('isAliveSync: the lifecycle-classifier variant', () => {
  it('returns no-session when the tmux session is absent', () => {
    const deps = aliveSyncDeps({ sessionExistsSync: vi.fn(() => false) });
    expect(isAliveSync('agent-x', deps)).toEqual({ alive: false, reason: 'no-session' });
    expect(deps.listPaneRowsSync).not.toHaveBeenCalled();
  });

  it('returns pane-dead when every pane is dead', () => {
    const deps = aliveSyncDeps({ listPaneRowsSync: vi.fn(() => [{ pid: '100', dead: true }]) });
    expect(isAliveSync('agent-x', deps)).toEqual({ alive: false, reason: 'pane-dead' });
  });

  it('returns runtime-missing when no live pane subtree holds the harness', () => {
    const deps = aliveSyncDeps({ findRuntimePidSync: vi.fn(() => null) });
    expect(isAliveSync('agent-x', deps)).toEqual({ alive: false, reason: 'runtime-missing' });
  });

  it('returns alive when session, pane, and harness process are all present', () => {
    expect(isAliveSync('agent-x', aliveSyncDeps())).toEqual({ alive: true, paneAlive: true, runtimePid: 100 });
  });

  it('returns runtime-indeterminate when the probe itself fails (not confirmed death)', () => {
    const deps = aliveSyncDeps({ findRuntimePidSync: vi.fn(() => 'indeterminate' as const) });
    expect(isAliveSync('agent-x', deps)).toEqual({ alive: false, reason: 'runtime-indeterminate' });
  });
});

describe('isConfirmedDead: remediation gate (a broken probe is never death)', () => {
  it('is false for alive verdicts', () => {
    expect(isConfirmedDead({ alive: true, paneAlive: true, runtimePid: 100 })).toBe(false);
  });

  it('is false for runtime-indeterminate', () => {
    expect(isConfirmedDead({ alive: false, reason: 'runtime-indeterminate' })).toBe(false);
  });

  it('is true for confirmed absence and tmux-level death', () => {
    expect(isConfirmedDead({ alive: false, reason: 'runtime-missing' })).toBe(true);
    expect(isConfirmedDead({ alive: false, reason: 'no-session' })).toBe(true);
    expect(isConfirmedDead({ alive: false, reason: 'pane-dead' })).toBe(true);
  });
});

// ─── isIdle / idleAgeMs (ported from cloister/agent-idle.ts) ────────────────

function runtimeWithHeartbeat(heartbeatAgeMs: number) {
  mocks.getRuntimeForAgent.mockReturnValue({
    getHeartbeat: () => ({ timestamp: new Date(NOW - heartbeatAgeMs) }),
  });
}

describe('isIdle (PAN-3846, FR-5): idle is work activity, never the mirror label alone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPaneValuesSync.mockReturnValue([]);
    mocks.getRuntimeForAgent.mockReturnValue(undefined);
  });

  it('mirror idle with a transcript heartbeat 10 seconds old is NOT idle', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(NOW - 10_000).toISOString(),
    });
    runtimeWithHeartbeat(10_000);

    expect(isIdle('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
  });

  it('mirror idle with a heartbeat 6 minutes old IS idle', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(NOW - 6 * 60_000).toISOString(),
    });
    runtimeWithHeartbeat(6 * 60_000);

    expect(isIdle('agent-pan-1', 5 * 60_000, NOW)).toBe(true);
  });

  it('mirror active with a heartbeat 6 minutes old IS idle (stale active mirror)', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'active',
      lastActivity: new Date(NOW - 6 * 60_000).toISOString(),
    });
    runtimeWithHeartbeat(6 * 60_000);

    expect(isIdle('agent-pan-1', 5 * 60_000, NOW)).toBe(true);
  });

  it('mirror active with a fresh heartbeat is NOT idle', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'active',
      lastActivity: new Date(NOW - 30_000).toISOString(),
    });
    runtimeWithHeartbeat(30_000);

    expect(isIdle('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
  });

  it('suspended, stopped, and waiting-on-human are never idle', () => {
    for (const state of ['suspended', 'stopped', 'waiting-on-human']) {
      mocks.getAgentRuntimeStateSync.mockReturnValue({
        state,
        lastActivity: new Date(NOW - 60 * 60_000).toISOString(),
      });
      runtimeWithHeartbeat(60 * 60_000);
      expect(isIdle('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
    }
  });

  it('no runtime mirror falls back to work activity age', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    runtimeWithHeartbeat(6 * 60_000);
    expect(isIdle('agent-pan-1', 5 * 60_000, NOW)).toBe(true);

    runtimeWithHeartbeat(10_000);
    expect(isIdle('agent-pan-1', 5 * 60_000, NOW)).toBe(false);
  });

  it('returns false when no runtime mirror and no work-activity signal exists (hook never fired)', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.getRuntimeForAgent.mockReturnValue(null);
    expect(isIdle('agent-x', 5 * 60_000, NOW)).toBe(false);
  });

  it('returns true for a STALE active agent (Stop hook never fired — the PAN-1574 case)', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'active',
      lastActivity: new Date(NOW - 36 * 60 * 60 * 1000).toISOString(),
    });
    mocks.getRuntimeForAgent.mockReturnValue(null);
    expect(isIdle('agent-x', 5 * 60_000, NOW)).toBe(true);
  });

  it('returns true for a stale uninitialized agent (unchanged behavior)', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'uninitialized',
      lastActivity: new Date(NOW - 10 * 60_000).toISOString(),
    });
    expect(isIdle('agent-x', 5 * 60_000, NOW)).toBe(true);
  });
});

describe('idleAgeMs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPaneValuesSync.mockReturnValue([]);
  });

  it('reports the age of the newest work-activity signal', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(NOW - 10 * 60_000).toISOString(),
    });
    runtimeWithHeartbeat(2 * 60_000);

    expect(idleAgeMs('agent-pan-1', NOW)).toBe(2 * 60_000);
  });

  it('returns null when no work-activity signal exists', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(null);
    mocks.getRuntimeForAgent.mockReturnValue(undefined);

    expect(idleAgeMs('agent-pan-1', NOW)).toBeNull();
  });
});

describe('getAgentEffectiveLastActivityMs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the freshest harness-neutral activity instead of a stale runtime mirror', () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue({
      state: 'active',
      lastActivity: new Date(NOW - 36 * 60 * 60 * 1000).toISOString(),
    });
    mocks.listPaneValuesSync.mockReturnValue([String(Math.floor((NOW - 60_000) / 1000))]);
    mocks.getRuntimeForAgent.mockReturnValue({
      getHeartbeat: () => ({
        timestamp: new Date(NOW - 120_000),
        agentId: 'agent-x',
        source: 'jsonl',
        confidence: 'medium',
      }),
    });

    expect(getAgentEffectiveLastActivityMs('agent-x')).toBe(NOW - 60_000);
    expect(isIdle('agent-x', 5 * 60_000, NOW)).toBe(false);
  });
});
