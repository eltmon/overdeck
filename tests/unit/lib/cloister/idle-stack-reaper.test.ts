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

const SERVER = (id: string) => `overdeck-feature-${id}-server-1`;
const FRONTEND = (id: string) => `overdeck-feature-${id}-frontend-1`;

function makeDeps(over: Partial<IdleStackReaperDeps> & {
  containers?: string[];
  composeContainers?: { name: string; composeProject?: string }[];
  sessions?: string[];
}): { deps: Partial<IdleStackReaperDeps>; stopped: string[][] } {
  const stopped: string[][] = [];
  const deps: Partial<IdleStackReaperDeps> = {
    listContainerNames: async () => over.containers ?? [],
    listComposeContainers: async () => over.composeContainers ?? [],
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
      listComposeContainers: async () => [],
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
      listComposeContainers: async () => [],
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
      listComposeContainers: async () => [],
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
      listComposeContainers: async () => [],
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
        `overdeck-feature-pan-9006-dev-1`,   // attach container — never reaped
        `overdeck-feature-pan-9006-init-1`,
        `some-unrelated-container`,
      ],
      listComposeContainers: async () => [],
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

  // PAN-3049: UI_CONTAINER_RE must match any declared compose-project prefix
  // (e.g. myn-), not just the overdeck- fallback.
  it('reaps a myn-feature- UI stack after the grace window elapses', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => ['myn-feature-min-901-server-1', 'myn-feature-min-901-frontend-1'],
      listComposeContainers: async () => [],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 10_000,
    };
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]); // clock starts
    nowMs += 11_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('MIN-901');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].sort()).toEqual(['myn-feature-min-901-frontend-1', 'myn-feature-min-901-server-1'].sort());
  });

  it('never reaps a myn-feature- dev container — DEV_CONTAINER_RE still protects it', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [
        'myn-feature-min-901-dev-1',
        'myn-feature-min-901-server-1',
        'myn-feature-min-901-frontend-1',
      ],
      listComposeContainers: async () => [],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 10_000,
    };
    await reconcileIdleWorkspaceStacks(deps);
    nowMs += 11_000;
    await reconcileIdleWorkspaceStacks(deps);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).not.toContain('myn-feature-min-901-dev-1');
    expect(stopped[0].sort()).toEqual(['myn-feature-min-901-frontend-1', 'myn-feature-min-901-server-1'].sort());
  });
});

describe('reconcileIdleWorkspaceStacks — full-stack tier (2026-07-25 container leak)', () => {
  beforeEach(() => { __resetIdleStackReaperState(); delete process.env.OVERDECK_DISABLE_STACK_REAPER; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.OVERDECK_DISABLE_STACK_REAPER; });

  const MYN = (project: string, svc: string) => `${project}-${svc}-1`;

  it('starts the full-tier grace clock on first observation — no stop', async () => {
    const stopped: string[][] = [];
    const project = 'myn-feature-min-898';
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [],
      listComposeContainers: async () => [
        { name: MYN(project, 'fe'), composeProject: project },
        { name: MYN(project, 'postgres'), composeProject: project },
      ],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => 1_000_000,
      graceMs: 1,
      fullStackGraceMs: 10_000,
    };
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('stops every service except the dev attach target after the full grace window', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const project = 'myn-feature-min-898';
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [],
      listComposeContainers: async () => [
        { name: MYN(project, 'fe'), composeProject: project },
        { name: MYN(project, 'api'), composeProject: project },
        { name: MYN(project, 'postgres'), composeProject: project },
        { name: MYN(project, 'redis'), composeProject: project },
        { name: MYN(project, 'dev'), composeProject: project },
      ],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 1,
      fullStackGraceMs: 10_000,
    };
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]); // clock starts
    nowMs += 11_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('MIN-898');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].sort()).toEqual([
      MYN(project, 'fe'), MYN(project, 'api'), MYN(project, 'postgres'), MYN(project, 'redis'),
    ].sort());
  });

  it('NEVER full-reaps a project with a live tmux session for the issue', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const project = 'myn-feature-min-898';
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [],
      listComposeContainers: async () => [{ name: MYN(project, 'fe'), composeProject: project }],
      listSessions: async () => ['agent-min-898-review'],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 1,
      fullStackGraceMs: 10_000,
    };
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    nowMs += 60_000;
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('ignores containers without compose labels and non-feature project names', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [],
      listComposeContainers: async () => [
        { name: 'myn-feature-min-899-fe-1' }, // no label — not matched
        { name: 'traefik', composeProject: 'panopticon-traefik' },
        { name: 'myn-main-fe-1', composeProject: 'myn-main' }, // not a feature stack
      ],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 1,
      fullStackGraceMs: 10_000,
    };
    await reconcileIdleWorkspaceStacks(deps);
    nowMs += 60_000;
    expect(await reconcileIdleWorkspaceStacks(deps)).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('does nothing when only the dev container remains', async () => {
    let nowMs = 1_000_000;
    const stopped: string[][] = [];
    const project = 'myn-feature-min-900';
    const deps: Partial<IdleStackReaperDeps> = {
      listContainerNames: async () => [],
      listComposeContainers: async () => [{ name: MYN(project, 'dev'), composeProject: project }],
      listSessions: async () => [],
      stopContainers: async (names) => { stopped.push(names); },
      now: () => nowMs,
      graceMs: 1,
      fullStackGraceMs: 10_000,
    };
    await reconcileIdleWorkspaceStacks(deps);
    nowMs += 60_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);
    expect(actions).toEqual([]);
    expect(stopped).toEqual([]);
  });
});
