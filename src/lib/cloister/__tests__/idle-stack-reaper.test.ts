import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetIdleStackReaperState,
  reconcileIdleWorkspaceStacks,
  type IdleStackReaperDeps,
} from '../idle-stack-reaper.js';

describe('reconcileIdleWorkspaceStacks (PAN-1817)', () => {
  beforeEach(() => {
    __resetIdleStackReaperState();
    delete process.env.PANOPTICON_DISABLE_STACK_REAPER;
    delete process.env.PANOPTICON_NO_RESUME;
  });

  function makeDeps(overrides: Partial<IdleStackReaperDeps> = {}): IdleStackReaperDeps {
    return {
      listContainerNames: async () => ['panopticon-feature-pan-1817-server-1', 'panopticon-feature-pan-1817-frontend-1'],
      listSessions: async () => [],
      stopContainers: vi.fn(async () => {}),
      now: () => 0,
      graceMs: 10 * 60 * 1000,
      ...overrides,
    };
  }

  it('preserves a workspace idle for less than the grace window', async () => {
    const deps = makeDeps({ now: () => 5 * 60 * 1000 });
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(0);
    expect(deps.stopContainers).not.toHaveBeenCalled();
  });

  it('stops server+frontend containers of a workspace idle longer than the grace window', async () => {
    // First patrol starts the grace clock at t=0.
    const firstDeps = makeDeps({ now: () => 0 });
    await reconcileIdleWorkspaceStacks(firstDeps);
    expect(firstDeps.stopContainers).not.toHaveBeenCalled();

    // Second patrol, past the grace window, reaps the stack.
    const secondDeps = makeDeps({ now: () => 20 * 60 * 1000, stopContainers: firstDeps.stopContainers });
    const actions = await reconcileIdleWorkspaceStacks(secondDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/reaped idle workspace UI stack for PAN-1817/i);
    expect(firstDeps.stopContainers).toHaveBeenCalledTimes(1);
    const stopped = firstDeps.stopContainers.mock.calls[0][0];
    expect(stopped).toContain('panopticon-feature-pan-1817-server-1');
    expect(stopped).toContain('panopticon-feature-pan-1817-frontend-1');
  });

  it('preserves a workspace with a live tmux session regardless of elapsed idle time', async () => {
    const deps = makeDeps({
      now: () => 15 * 60 * 1000,
      listSessions: async () => ['agent-pan-1817'],
    });
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(0);
    expect(deps.stopContainers).not.toHaveBeenCalled();
  });

  it('preserves a workspace with a running agent regardless of elapsed idle time', async () => {
    const deps = makeDeps({
      now: () => 15 * 60 * 1000,
      listSessions: async () => ['review-pan-1817'],
    });
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(0);
    expect(deps.stopContainers).not.toHaveBeenCalled();
  });

  it('does not treat an overlapping issue id substring as a live session', async () => {
    const firstDeps = makeDeps({ now: () => 0, listSessions: async () => [] });
    await reconcileIdleWorkspaceStacks(firstDeps);
    expect(firstDeps.stopContainers).not.toHaveBeenCalled();

    const secondDeps = makeDeps({
      now: () => 20 * 60 * 1000,
      listSessions: async () => ['agent-pan-18170'],
      stopContainers: firstDeps.stopContainers,
    });
    const actions = await reconcileIdleWorkspaceStacks(secondDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/reaped idle workspace UI stack for PAN-1817/i);
    expect(firstDeps.stopContainers).toHaveBeenCalledTimes(1);
  });

  it('resets the grace clock when UI containers disappear', async () => {
    const deps = makeDeps({
      now: () => 15 * 60 * 1000,
      listContainerNames: async () => [],
    });
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(0);
    expect(deps.stopContainers).not.toHaveBeenCalled();
  });

  it('returns without reaping when PANOPTICON_DISABLE_STACK_REAPER is set', async () => {
    process.env.PANOPTICON_DISABLE_STACK_REAPER = '1';
    const deps = makeDeps({ now: () => 20 * 60 * 1000 });
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(0);
    expect(deps.stopContainers).not.toHaveBeenCalled();
  });

  it('does not stop containers when docker is unreachable', async () => {
    const deps = makeDeps({
      listContainerNames: async () => {
        throw new Error('docker not reachable');
      },
    });
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(0);
  });
});
