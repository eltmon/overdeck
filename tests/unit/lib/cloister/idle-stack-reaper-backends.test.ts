/**
 * PAN-4669: the idle-stack reaper decides "in use" from the selected terminal
 * backend's live-agent inventory, never the tmux socket. On a Herdr host the
 * tmux list holds no agent sessions, so a tmux-only check stopped the
 * server/frontend containers of every running workspace after the grace window.
 *
 * These tests leave `listLiveAgentIds` at its default, so the real inventory
 * module runs against a mocked backend (Herdr and tmux).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const backendState = vi.hoisted(() => ({
  backend: null as null | { name: 'herdr' | 'tmux'; list: () => unknown },
  herdrAgents: [] as Array<{ agentId: string; paneId: string; terminalId: string; state: string }>,
  herdrFails: false,
  listSessionNames: vi.fn(),
}));

vi.mock('../../../../src/lib/terminal-backends/launch.js', () => ({
  resolveLaunchBackend: async () => {
    if (!backendState.backend) throw new Error('no backend');
    return backendState.backend;
  },
}));

vi.mock('../../../../src/lib/terminal-backends/herdr.js', () => ({
  listHerdrAgents: async () => {
    if (backendState.herdrFails) throw new Error('herdr socket unreachable');
    return backendState.herdrAgents;
  },
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  listSessionNames: backendState.listSessionNames,
}));

vi.mock('../../../../src/lib/workspaces/resolver.js', () => ({
  listWorkspaces: () => [],
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: () => {},
}));

import {
  __resetIdleStackReaperState,
  reconcileIdleWorkspaceStacks,
  type IdleStackReaperDeps,
} from '../../../../src/lib/cloister/idle-stack-reaper.js';

const SERVER = (id: string) => `overdeck-feature-${id}-server-1`;
const FRONTEND = (id: string) => `overdeck-feature-${id}-frontend-1`;

function dockerDeps(containers: string[], clock: { now: number }) {
  const stopped: string[][] = [];
  const deps: Partial<IdleStackReaperDeps> = {
    listContainerNames: async () => containers,
    listComposeContainers: async () => [],
    stopContainers: async (names) => { stopped.push(names); },
    now: () => clock.now,
    graceMs: 10_000,
    fullStackGraceMs: 20_000,
  };
  return { deps, stopped };
}

function herdrBackend(): { name: 'herdr'; list: () => unknown } {
  return { name: 'herdr', list: () => Effect.die('herdr inventory goes through listHerdrAgents') };
}

function tmuxBackend(sessions: string[]): { name: 'tmux'; list: () => unknown } {
  return {
    name: 'tmux',
    list: () => Effect.succeed(
      sessions.map((name) => ({ paneId: name, terminalId: name, state: 'working' })),
    ),
  };
}

beforeEach(() => {
  __resetIdleStackReaperState();
  delete process.env.OVERDECK_DISABLE_STACK_REAPER;
  backendState.backend = null;
  backendState.herdrAgents = [];
  backendState.herdrFails = false;
  backendState.listSessionNames.mockReset();
});

afterEach(() => {
  __resetIdleStackReaperState();
});

describe('idle-stack reaper on a Herdr host (PAN-4669)', () => {
  it('keeps the stack of an issue with a live Herdr agent pane past the grace window', async () => {
    backendState.backend = herdrBackend();
    backendState.herdrAgents = [
      { agentId: 'agent-pan-4643', paneId: 'w1:p1', terminalId: 't1', state: 'working' },
    ];
    const clock = { now: 1_000_000 };
    const { deps, stopped } = dockerDeps([SERVER('pan-4643'), FRONTEND('pan-4643')], clock);

    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    clock.now += 60_000; // well past the 10s grace
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);

    expect(stopped).toEqual([]);
    expect(backendState.listSessionNames).not.toHaveBeenCalled();
  });

  it('still reaps a stack with no live pane for the issue after the grace window', async () => {
    backendState.backend = herdrBackend();
    backendState.herdrAgents = [
      { agentId: 'agent-pan-4643', paneId: 'w1:p1', terminalId: 't1', state: 'working' },
      { agentId: 'agent-pan-4700', paneId: 'w1:p2', terminalId: 't2', state: 'exited' },
    ];
    const clock = { now: 1_000_000 };
    const { deps, stopped } = dockerDeps([SERVER('pan-4700'), FRONTEND('pan-4700')], clock);

    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]); // grace clock starts
    clock.now += 11_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('PAN-4700');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].sort()).toEqual([FRONTEND('pan-4700'), SERVER('pan-4700')].sort());
  });

  it('reaps nothing when the Herdr inventory cannot be read', async () => {
    backendState.backend = herdrBackend();
    backendState.herdrFails = true;
    const clock = { now: 1_000_000 };
    const { deps, stopped } = dockerDeps([SERVER('pan-4643'), FRONTEND('pan-4643')], clock);

    await reconcileIdleWorkspaceStacks(deps);
    clock.now += 60_000;
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);

    expect(stopped).toEqual([]);
  });
});

describe('idle-stack reaper on a tmux host (PAN-4669)', () => {
  it('keeps the stack of an issue with a live tmux agent session past the grace window', async () => {
    backendState.backend = tmuxBackend(['agent-pan-4643-review']);
    const clock = { now: 1_000_000 };
    const { deps, stopped } = dockerDeps([SERVER('pan-4643'), FRONTEND('pan-4643')], clock);

    await reconcileIdleWorkspaceStacks(deps);
    clock.now += 60_000;
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);

    expect(stopped).toEqual([]);
  });

  it('still reaps a stack with no live tmux session for the issue after the grace window', async () => {
    backendState.backend = tmuxBackend(['agent-pan-4643']);
    const clock = { now: 1_000_000 };
    const { deps, stopped } = dockerDeps([SERVER('pan-4700'), FRONTEND('pan-4700')], clock);

    await reconcileIdleWorkspaceStacks(deps);
    clock.now += 11_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('PAN-4700');
    expect(stopped[0].sort()).toEqual([FRONTEND('pan-4700'), SERVER('pan-4700')].sort());
  });

  it('reaps nothing when the backend cannot be resolved', async () => {
    backendState.backend = null;
    const clock = { now: 1_000_000 };
    const { deps, stopped } = dockerDeps([SERVER('pan-4700'), FRONTEND('pan-4700')], clock);

    await reconcileIdleWorkspaceStacks(deps);
    clock.now += 60_000;
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);

    expect(stopped).toEqual([]);
  });
});
