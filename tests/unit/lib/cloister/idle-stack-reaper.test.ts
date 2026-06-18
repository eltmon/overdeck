import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  reconcileIdleWorkspaceStacks,
  __resetIdleStackReaperState,
  type IdleStackReaperDeps,
} from '../../../../src/lib/cloister/idle-stack-reaper.js';

// PAN-1817: the reaper stops the server+frontend UI containers of a workspace
// once its agent has been idle (no agent, no tmux for the issue) past the grace
// window. These tests lock the policy: never reap an active workspace, honor the
// grace window, and only stop the matched UI containers.

const SERVER = (id: string) => `panopticon-feature-${id}-server-1`;
const FRONTEND = (id: string) => `panopticon-feature-${id}-frontend-1`;

function makeDeps(over: Partial<IdleStackReaperDeps> & {
  containers?: string[];
  sessions?: string[];
}): { deps: Partial<IdleStackReaperDeps>; stopped: string[][] } {
  const stopped: string[][] = [];
  const deps: Partial<IdleStackReaperDeps> = {
    listContainerNames: async () => over.containers ?? [],
    listSessions: async () => over.sessions ?? [],
    stopContainers: async (names) => { stopped.push(names); },
    now: over.now ?? (() => 1_000_000),
    graceMs: over.graceMs ?? 10_000,
  };
  return { deps, stopped };
}

describe('reconcileIdleWorkspaceStacks (PAN-1817)', () => {
  beforeEach(() => { __resetIdleStackReaperState(); delete process.env.OVERDECK_DISABLE_STACK_REAPER; delete process.env.OVERDECK_NO_RESUME; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.OVERDECK_DISABLE_STACK_REAPER; delete process.env.OVERDECK_NO_RESUME; });

  it('does NOT reap on the first observation — it starts the grace clock', async () => {
    const { deps, stopped } = makeDeps({
      containers: [SERVER('pan-9001'), FRONTEND('pan-9001')],
      sessions: [],
      now: () => 1_000_000,
    });
    const actions = await reconcileIdleWorkspaceStacks(deps);
    expect(actions).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('reaps the server+frontend after the grace window elapses', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [SERVER('pan-9002'), FRONTEND('pan-9002')],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 10_000,
    };
    // Cycle 1: starts the clock, no reap.
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    expect(stopped).toEqual([]);
    // Cycle 2: grace elapsed → reap both UI containers.
    nowMs += 11_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('PAN-9002');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].sort()).toEqual([FRONTEND('pan-9002'), SERVER('pan-9002')].sort());
  });

  it('NEVER reaps a workspace with a live tmux session for the issue', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [SERVER('pan-9003'), FRONTEND('pan-9003')],
      listSessions: async () => ['agent-pan-9003-review'], // active review convoy
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 10_000,
    };
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    nowMs += 60_000; // well past grace
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('resets the grace clock if the workspace becomes active again before reaping', async () => {
    let nowMs = 1_000_000;
    let sessions: string[] = [];
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [SERVER('pan-9004')],
      listSessions: async () => sessions,
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 10_000,
    };
    await reconcileIdleWorkspaceStacks(deps);   // clock starts
    sessions = ['agent-pan-9004'];              // agent comes back
    nowMs += 20_000;
    await reconcileIdleWorkspaceStacks(deps);   // active → clock cleared
    sessions = [];                              // idle again
    nowMs += 5_000;
    await reconcileIdleWorkspaceStacks(deps);   // clock restarts, within grace
    expect(stopped).toEqual([]);
  });

  it('honors the OVERDECK_DISABLE_STACK_REAPER kill switch', async () => {
    process.env.OVERDECK_DISABLE_STACK_REAPER = '1';
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [SERVER('pan-9005')],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 1,
    };
    nowMs += 100;
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('ignores non-UI containers (dev, init) and unrelated names', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [
        `panopticon-feature-pan-9006-dev-1`,   // attach container — never reaped
        `panopticon-feature-pan-9006-init-1`,
        `some-unrelated-container`,
      ],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 1,
    };
    await reconcileIdleWorkspaceStacks(deps);
    nowMs += 10;
    const actions = await reconcileIdleWorkspaceStacks(deps);
    expect(actions).toEqual([]);
    expect(stopped).toEqual([]);
  });
});
