/**
 * Fixture tests for the parked-population classifier (PAN-3485 phase 1, cut to
 * the derived model by PAN-3917). One test per surviving orbit, plus the
 * overlap rules (yield ≠ park, idle-running is the orbit of last resort) and
 * population-level sort/dedup.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gather = vi.hoisted(() => ({
  agents: [] as unknown[],
  liveAgents: [] as unknown[],
}));
vi.mock('../../agents/queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents/queries.js')>();
  return { ...actual, listAgentStates: () => gather.agents, listRunningAgentsSync: () => gather.liveAgents };
});
// PAN-3849 (W32): the sweeper's "live" filter is the liveness oracle now. Map
// each fixture's tmuxActive flag to the verdict it stood for, so every case
// keeps its original intent.
vi.mock('../../agents/liveness.js', () => ({
  isAliveSync: (agentId: string) => (
    (gather.liveAgents as { id: string; tmuxActive?: boolean }[])
      .some((a) => a.id === agentId && a.tmuxActive === true)
      ? { alive: true, paneAlive: true }
      : { alive: false, reason: 'no-session' }
  ),
  // Mirrors the real isConfirmedDead: only a confirmed absence is death.
  isConfirmedDead: (verdict: { alive: boolean; reason?: string }) =>
    !verdict.alive && verdict.reason !== 'runtime-indeterminate',
}));

import {
  classifyParked,
  IDLE_RUNNING_THRESHOLD_MS,
  PARKED_ORBITS,
  resolveParkedPopulation,
  summarizeParked,
  type ParkedSignals,
} from '../resolver.js';
import type { AgentState } from '../../agents.js';

const NOW = Date.parse('2026-08-02T13:40:00.000Z');
const HOUR = 60 * 60_000;

function baseAgent(overrides: Partial<AgentState>): AgentState {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    role: 'work',
    status: 'running',
    workspace: '/tmp/ws',
    startedAt: new Date(NOW - 20 * HOUR).toISOString(),
    lastActivity: new Date(NOW - 20 * HOUR).toISOString(),
    ...overrides,
  } as AgentState;
}

function signals(overrides: Partial<ParkedSignals>): ParkedSignals {
  return {
    issueId: 'PAN-1',
    agents: [],
    liveAgents: [],
    issueClosed: null,
    now: NOW,
    ...overrides,
  };
}

function liveIdle(overrides: Partial<AgentState> = {}): (AgentState & { tmuxActive: boolean })[] {
  return [{
    ...baseAgent({ lastActivity: new Date(NOW - IDLE_RUNNING_THRESHOLD_MS - HOUR).toISOString(), ...overrides }),
    tmuxActive: true,
  }];
}

beforeEach(() => {
  gather.agents = [];
  gather.liveAgents = [];
});

describe('the taxonomy holds no derivable pipeline state (PAN-3917)', () => {
  it('is exactly the three orbits owned by the agents table and the tracker', () => {
    expect([...PARKED_ORBITS]).toEqual(['operator-gate', 'zombie-session', 'idle-running']);
  });
});

describe('classifyParked — one orbit at a time', () => {
  it('operator-gate: manual pause parks; scheduler yield does NOT', () => {
    const paused = classifyParked(signals({
      agents: [baseAgent({ paused: true, pausedAt: new Date(NOW - 90_000).toISOString() })],
    }));
    expect(paused).toHaveLength(1);
    expect(paused[0].orbit).toBe('operator-gate');
    expect(paused[0].details?.gate).toBe('paused');

    const yielded = classifyParked(signals({
      agents: [baseAgent({ paused: true, yieldedByScheduler: true })],
    }));
    expect(yielded).toHaveLength(0);
  });

  it('operator-gate: troubled and stopped-by-user each park', () => {
    const troubled = classifyParked(signals({ agents: [baseAgent({ troubled: true, troubledAt: new Date(NOW - HOUR).toISOString() })] }));
    expect(troubled[0]?.details?.gate).toBe('troubled');
    const stopped = classifyParked(signals({ agents: [baseAgent({ stoppedByUser: true, status: 'stopped', stoppedAt: new Date(NOW - HOUR).toISOString() })] }));
    expect(stopped[0]?.details?.gate).toBe('stopped-by-user');
  });

  it('zombie-session: a live agent on a closed issue parks; on an open issue does not', () => {
    const zombie = classifyParked(signals({
      liveAgents: [{ ...baseAgent({}), tmuxActive: true }],
      issueClosed: true,
    }));
    expect(zombie).toHaveLength(1);
    expect(zombie[0].orbit).toBe('zombie-session');

    const fresh = [{ ...baseAgent({ lastActivity: new Date(NOW - 5 * 60_000).toISOString() }), tmuxActive: true }];
    const notZombie = classifyParked(signals({ liveAgents: fresh, issueClosed: false }));
    expect(notZombie).toHaveLength(0);
  });

  it('idle-running: live + idle beyond threshold parks', () => {
    const rows = classifyParked(signals({ liveAgents: liveIdle() }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('idle-running');
    expect(rows[0].details?.agentId).toBe('agent-pan-1');
  });

  it('idle-running is the orbit of last resort — another orbit suppresses it', () => {
    const rows = classifyParked(signals({
      agents: [baseAgent({ id: 'agent-pan-2', paused: true, pausedAt: new Date(NOW - HOUR).toISOString() })],
      liveAgents: liveIdle(),
    }));
    expect(rows.map((r) => r.orbit)).toEqual(['operator-gate']);
  });

  it('a warm live agent is never idle-running', () => {
    const warm = [{ ...baseAgent({ lastActivity: new Date(NOW - 60_000).toISOString() }), tmuxActive: true }];
    expect(classifyParked(signals({ liveAgents: warm }))).toHaveLength(0);
  });

  it('a closed issue produces nothing but zombie-session rows', () => {
    const rows = classifyParked(signals({
      agents: [baseAgent({ paused: true })],
      liveAgents: liveIdle(),
      issueClosed: true,
    }));
    expect(rows.map((r) => r.orbit)).toEqual(['zombie-session']);
  });
});

describe('summarizeParked', () => {
  it('counts by orbit and picks the most severe primary per issue', () => {
    const summary = summarizeParked([
      { issueId: 'PAN-1', orbit: 'operator-gate', parkedAt: '2026-08-02T00:00:00Z', parkReason: '', unparkCondition: '' },
      { issueId: 'PAN-1', orbit: 'zombie-session', parkedAt: '2026-08-02T01:00:00Z', parkReason: '', unparkCondition: '' },
      { issueId: 'PAN-2', orbit: 'idle-running', parkedAt: '2026-08-02T02:00:00Z', parkReason: '', unparkCondition: '' },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.byOrbit).toEqual({ 'operator-gate': 1, 'zombie-session': 1, 'idle-running': 1 });
    expect(summary.primaryByIssue['PAN-1']).toBe('zombie-session');
    expect(summary.primaryByIssue['PAN-2']).toBe('idle-running');
  });
});

describe('guard-exit inventory (PAN-3488)', () => {
  it('every orbit in the taxonomy has a fixture producing non-empty park + release copy', () => {
    // One fixture per orbit — each must classify with both sentences
    // populated. A new orbit added to PARKED_ORBITS without a classifier
    // branch (or without copy) fails here.
    const fixtures: Record<string, ParkedSignals> = {
      'operator-gate': signals({ agents: [baseAgent({ paused: true })] }),
      'zombie-session': signals({ liveAgents: [{ ...baseAgent({}), tmuxActive: true }], issueClosed: true }),
      'idle-running': signals({ liveAgents: liveIdle() }),
    };
    expect(Object.keys(fixtures).sort()).toEqual([...PARKED_ORBITS].sort());
    for (const orbit of PARKED_ORBITS) {
      const rows = classifyParked(fixtures[orbit]);
      const row = rows.find((candidate) => candidate.orbit === orbit);
      expect(row, `orbit ${orbit} must classify`).toBeDefined();
      expect(row!.parkReason.length, `orbit ${orbit} must say WHY it is parked`).toBeGreaterThan(0);
      expect(row!.unparkCondition.length, `orbit ${orbit} must document its exit`).toBeGreaterThan(0);
    }
  });
});

describe('orchestrator idle exemption (first-night flywheel kill)', () => {
  it('flywheel/sequencer/conversation agents never classify idle-running', () => {
    for (const role of ['flywheel', 'sequencer', 'conversation']) {
      const rows = classifyParked(signals({ liveAgents: liveIdle({ role }) }));
      expect(rows, `role ${role} must never be idle-running`).toHaveLength(0);
    }
  });
});

describe('completed-handoff is not an operator park (pan done suppression)', () => {
  it('a stoppedByUser agent WITH a completed marker never reports operator-gate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-dir-'));
    mkdirSync(join(dir, 'agents', 'agent-pan-9'), { recursive: true });
    writeFileSync(join(dir, 'agents', 'agent-pan-9', 'completed'), '');
    process.env.OVERDECK_HOME = dir;
    const rows = classifyParked(signals({
      agents: [baseAgent({ id: 'agent-pan-9', stoppedByUser: true, status: 'stopped', stoppedAt: new Date(NOW - HOUR).toISOString() })],
    }));
    expect(rows).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('resolveParkedPopulation', () => {
  it('candidates come from the agents table, and the tracker decides closedness', async () => {
    const paused = baseAgent({ id: 'agent-pan-501', issueId: 'PAN-501', paused: true, pausedAt: new Date(NOW - HOUR).toISOString() });
    gather.agents = [paused];
    const isClosed = vi.fn(async () => false);

    const rows = await resolveParkedPopulation({ now: NOW, isClosed });

    expect(rows.map((row) => `${row.issueId}:${row.orbit}`)).toEqual(['PAN-501:operator-gate']);
  });

  it('keeps only zombie-session rows for a tracker-closed issue', async () => {
    const live = { ...baseAgent({ id: 'agent-pan-502', issueId: 'PAN-502' }), tmuxActive: true };
    gather.agents = [live];
    gather.liveAgents = [live];

    const rows = await resolveParkedPopulation({ now: NOW, isClosed: async () => true });

    expect(rows.map((row) => row.orbit)).toEqual(['zombie-session']);
  });

  it('status gate survives the oracle migration: a stopped agent with a live session is not live', async () => {
    // The W32 oracle migration dropped the pre-migration status gate
    // (tmuxActive && (running || starting)); a stopped agent whose session is
    // still alive then entered liveAgents, minting zombie-session rows for an
    // agent that is resumable residue, not a running agent.
    const stopped = baseAgent({
      id: 'agent-pan-503',
      issueId: 'PAN-503',
      status: 'stopped',
      stoppedAt: new Date(NOW - HOUR).toISOString(),
      lastActivity: new Date(NOW - HOUR).toISOString(),
    });
    gather.agents = [stopped];
    // Oracle verdict is alive (the session outlived the harness) — the status
    // gate alone must keep this agent out of liveAgents.
    gather.liveAgents = [{ ...stopped, tmuxActive: true }];

    const rows = await resolveParkedPopulation({ now: NOW, isClosed: async () => false });

    expect(rows.filter((row) => row.issueId === 'PAN-503')).toHaveLength(0);
  });

  it('never calls the tracker for an issue with no live agent', async () => {
    gather.agents = [baseAgent({ id: 'agent-pan-504', issueId: 'PAN-504', status: 'stopped' })];
    const isClosed = vi.fn(async () => false);

    await resolveParkedPopulation({ now: NOW, isClosed });

    expect(isClosed).not.toHaveBeenCalled();
  });
});
