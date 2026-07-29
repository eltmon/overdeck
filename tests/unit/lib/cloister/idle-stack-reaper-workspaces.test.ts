/**
 * PAN-1990 (HAZARD H8): a kind='main' workspace sits on the project's own
 * primary path, never a `feature-<issue>` worktree, so today's naming
 * convention already excludes it from UI_CONTAINER_RE/FEATURE_PROJECT_RE —
 * but only incidentally. These tests cover the explicit isMainWorkspaceIssue
 * guard added on top of the existing container/tmux-name discovery (the
 * reaper's core discovery mechanism is intentionally NOT replaced with a
 * full resolver join in this item — that's a materially larger, separate
 * risk given this file's production role stopping live Docker stacks; see
 * the commit message for the scoping rationale).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import {
  __resetIdleStackReaperState,
  reconcileIdleWorkspaceStacks,
  type IdleStackReaperDeps,
} from '../../../../src/lib/cloister/idle-stack-reaper.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';

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
    fullStackGraceMs: over.fullStackGraceMs ?? 20_000,
  };
  return { deps, stopped };
}

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  __resetIdleStackReaperState();
  delete process.env.OVERDECK_DISABLE_STACK_REAPER;
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  __resetIdleStackReaperState();
  delete process.env.OVERDECK_DISABLE_STACK_REAPER;
});

describe('idle-stack reaper main-workspace exemption (PAN-1990)', () => {
  it('never reaps the UI tier for a registered main workspace, even past the grace window', async () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    // Contrived: a main workspace whose path basename collides with the
    // 'feature-<issue>' pattern the UI tier matches on containers.
    createWorkspace({ projectId: 'proj-1', kind: 'main', name: 'main', path: '/repo/feature-pan-9020' });

    let nowMs = 1_000_000;
    const { deps, stopped } = makeDeps({
      containers: [SERVER('pan-9020'), FRONTEND('pan-9020')],
      sessions: [],
      now: () => nowMs,
      graceMs: 10_000,
    });

    await reconcileIdleWorkspaceStacks(deps); // starts the grace clock (would, if not exempt)
    nowMs += 20_000; // well past the grace window
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toEqual([]);
    expect(stopped).toEqual([]);
  });

  it('still reaps a normal (non-main) idle workspace once a main workspace is registered for a different issue', async () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    createWorkspace({ projectId: 'proj-1', kind: 'main', name: 'main', path: '/repo/overdeck' });

    let nowMs = 1_000_000;
    const { deps, stopped } = makeDeps({
      containers: [SERVER('pan-9021'), FRONTEND('pan-9021')],
      sessions: [],
      now: () => nowMs,
      graceMs: 10_000,
    });

    await reconcileIdleWorkspaceStacks(deps);
    nowMs += 20_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toHaveLength(1);
    expect(stopped).toEqual([[SERVER('pan-9021'), FRONTEND('pan-9021')]]);
  });

  it('never reaps the full-stack tier for a registered main workspace, even past its grace window', async () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    createWorkspace({ projectId: 'proj-1', kind: 'main', name: 'main', path: '/repo/feature-pan-9022' });

    let nowMs = 1_000_000;
    const { deps, stopped } = makeDeps({
      composeContainers: [
        { name: 'overdeck-feature-pan-9022-dev-1', composeProject: 'overdeck-feature-pan-9022' },
        { name: 'overdeck-feature-pan-9022-postgres-1', composeProject: 'overdeck-feature-pan-9022' },
      ],
      sessions: [],
      now: () => nowMs,
      fullStackGraceMs: 20_000,
    });

    await reconcileIdleWorkspaceStacks(deps);
    nowMs += 30_000;
    const actions = await reconcileIdleWorkspaceStacks(deps);

    expect(actions).toEqual([]);
    expect(stopped).toEqual([]);
  });
});
