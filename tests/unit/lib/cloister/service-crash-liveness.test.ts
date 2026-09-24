/**
 * #4116: Cloister's poke and crash paths decide liveness through the
 * backend-aware oracle, and an unknown answer (backend unreachable) never
 * becomes a poke or a crash.
 *
 * The host backend is a fake Herdr: `hostTerminalBackendName` answers
 * `herdr`, the Herdr liveness probe answers from a table, and no tmux session
 * exists anywhere.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HerdrLivenessProbe } from '../../../../src/lib/terminal-backends/herdr.js';

const world = vi.hoisted(() => ({
  answers: {} as Record<string, string>,
  sendMessage: vi.fn(async () => undefined),
  agentState: null as Record<string, unknown> | null,
}));

vi.mock('../../../../src/lib/terminal-backends/select.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hostTerminalBackendName: async () => 'herdr',
}));

vi.mock('../../../../src/lib/terminal-backends/herdr.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeHerdrAgentLiveness: async (id: string): Promise<HerdrLivenessProbe> => {
    const kind = world.answers[id] ?? 'absent';
    if (kind === 'alive') return { kind, paneId: 'w1:p1', state: 'working' } as unknown as HerdrLivenessProbe;
    if (kind === 'indeterminate') return { kind, reason: 'socket did not answer' } as HerdrLivenessProbe;
    return { kind: 'absent' } as HerdrLivenessProbe;
  },
}));

vi.mock('../../../../src/lib/agents/tmux-session-query.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryTmuxSession: async () => 'missing',
}));

vi.mock('../../../../src/lib/runtimes/index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRuntimeForAgent: () => ({ name: 'claude-code', sendMessage: world.sendMessage }),
}));

vi.mock('../../../../src/lib/agents.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentState: () => world.agentState,
  getAgentRuntimeStateSync: () => null,
}));

import { handleAgentCrash, pokeAgentWithEscalation, type CrashEvent, type CrashHost } from '../../../../src/lib/cloister/service-crash.js';

const AGENT = 'agent-pan-4116';

function makeHost(): CrashHost & { events: CrashEvent[]; appended: unknown[] } {
  const events: CrashEvent[] = [];
  const appended: unknown[] = [];
  return {
    events,
    appended,
    config: {
      auto_restart: { enabled: true, max_retries: 3, backoff_seconds: [30] },
    } as unknown as CrashHost['config'],
    crashTrackers: new Map(),
    deathTimestamps: [],
    spawnsPaused: false,
    pokeProgress: new Map(),
    eventStore: { append: (event) => { appended.push(event); return 1; } },
    progressFingerprint: async () => 'head:pane',
    pokeAgentWithEscalation: async () => undefined,
    checkForMassDeaths: () => undefined,
    pauseSpawns: () => undefined,
    emit: (event) => { events.push(event); },
  };
}

beforeEach(() => {
  world.answers = {};
  world.sendMessage.mockClear();
  world.agentState = { id: AGENT, issueId: 'PAN-4116', role: 'work', status: 'running', sessionId: 'sess-4116', workspace: '/tmp/ws' };
});

describe('pokeAgentWithEscalation', () => {
  it('pokes a live Herdr agent that has no tmux session', async () => {
    world.answers[AGENT] = 'alive';
    const host = makeHost();
    await pokeAgentWithEscalation(host, AGENT);
    expect(world.sendMessage).toHaveBeenCalledTimes(1);
    expect(host.events).toContainEqual({ type: 'poked_agent', agentId: AGENT });
  });

  it('never pokes when the backend cannot answer, and keeps the progress streak', async () => {
    world.answers[AGENT] = 'indeterminate';
    const host = makeHost();
    host.pokeProgress.set(AGENT, { fingerprint: 'head:pane', ineffective: 2 });
    await pokeAgentWithEscalation(host, AGENT);
    expect(world.sendMessage).not.toHaveBeenCalled();
    expect(host.events).toEqual([]);
    expect(host.pokeProgress.get(AGENT)).toEqual({ fingerprint: 'head:pane', ineffective: 2 });
  });

  it('drops the progress streak of a confirmed-dead agent without poking', async () => {
    const host = makeHost();
    host.pokeProgress.set(AGENT, { fingerprint: 'head:pane', ineffective: 2 });
    await pokeAgentWithEscalation(host, AGENT);
    expect(world.sendMessage).not.toHaveBeenCalled();
    expect(host.pokeProgress.has(AGENT)).toBe(false);
  });
});

describe('handleAgentCrash', () => {
  it('does not count a crash for a live Herdr agent', async () => {
    world.answers[AGENT] = 'alive';
    const host = makeHost();
    await handleAgentCrash(host, AGENT);
    expect(host.events).toEqual([]);
    expect(host.appended).toEqual([]);
    expect(host.deathTimestamps).toEqual([]);
  });

  it('does not count a crash when the backend cannot answer', async () => {
    world.answers[AGENT] = 'indeterminate';
    const host = makeHost();
    await handleAgentCrash(host, AGENT);
    expect(host.events).toEqual([]);
    expect(host.appended).toEqual([]);
    expect(host.deathTimestamps).toEqual([]);
  });

  it('counts a crash and emits heartbeat_dead for a confirmed-dead agent', async () => {
    const host = makeHost();
    await handleAgentCrash(host, AGENT);
    expect(host.events).toContainEqual({ type: 'agent_crashed', agentId: AGENT, crashCount: 1 });
    expect(host.appended).toEqual([expect.objectContaining({ type: 'agent.heartbeat_dead' })]);
  });
});
