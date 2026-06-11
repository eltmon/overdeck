/**
 * Tests for the UAT generation reconciler (PAN-1737).
 * Fake deps; deterministic clock via deps.now.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  reconcileUatGenerations,
  FAILED_RETRY_BACKOFF_MS,
  STUCK_ASSEMBLING_MS,
  type UatReconcilerDeps,
} from '../../../../src/lib/cloister/uat-reconciler.js';
import type { ReadyFeature } from '../../../../src/lib/cloister/uat-generation-engine.js';
import type { UatGeneration, UatGenerationStatus } from '../../../../src/lib/database/uat-generations-db.js';

const MAIN = 'main-sha-1';
const T0 = Date.parse('2026-06-10T12:00:00.000Z');

// Each test gets its own projectRoot so the module-level single-flight map
// never couples tests together.
let projSeq = 0;
function freshProject(): string {
  projSeq += 1;
  return `/proj-${projSeq}`;
}

const READY: ReadyFeature[] = [
  { issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1' },
  { issueId: 'PAN-2', title: 'Second', branch: 'feature/pan-2' },
];

function gen(projectRoot: string, name: string, status: UatGenerationStatus, overrides: Partial<UatGeneration> = {}): UatGeneration {
  return {
    name, worktreePath: `${projectRoot}/workspaces/x`, projectRoot,
    baseSha: MAIN, status,
    members: [
      { issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Second', branch: 'feature/pan-2', headSha: 'h2', mergeOrder: 2 },
    ],
    heldOut: [], resolutions: [], stackStartedAt: null,
    createdAt: '2026-06-10T11:00:00.000Z', updatedAt: '2026-06-10T11:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(projectRoot: string, options: {
  enabled?: boolean;
  readySet?: ReadyFeature[] | null;
  rows?: UatGeneration[];
  headShas?: Record<string, string>;
  assembleStatus?: UatGenerationStatus;
} = {}): UatReconcilerDeps & {
  rows: Map<string, UatGeneration>;
  assembled: ReadyFeature[][];
  teardowns: string[];
  cleanups: number[];
} {
  const rows = new Map((options.rows ?? []).map((g) => [g.name, g]));
  const assembled: ReadyFeature[][] = [];
  const teardowns: string[] = [];
  const cleanups: number[] = [];
  let assembleSeq = 0;
  return {
    rows, assembled, teardowns, cleanups,
    isEnabled: () => options.enabled ?? true,
    getReadySet: async () => options.readySet === undefined ? READY : options.readySet,
    getMainHeadSha: async () => MAIN,
    getBranchHeadSha: async (branch) => options.headShas?.[branch] ?? (branch === 'feature/pan-1' ? 'h1' : 'h2'),
    store: {
      insert: (g) => { rows.set(g.name, { ...g, createdAt: '', updatedAt: '' }); },
      update: (name, patch) => {
        const existing = rows.get(name);
        if (!existing) throw new Error(`not found: ${name}`);
        rows.set(name, { ...existing, ...patch } as UatGeneration);
      },
      listNames: () => [...rows.keys()],
      listChain: (root, statuses) =>
        [...rows.values()]
          .filter((g) => g.projectRoot === root)
          .filter((g) => !statuses || statuses.includes(g.status))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    },
    assemble: async (features) => {
      assembled.push([...features]);
      assembleSeq += 1;
      const g = gen(projectRoot, `uat/pan-new-${assembleSeq}-0610`, options.assembleStatus ?? 'ready');
      rows.set(g.name, g);
      return g;
    },
    teardownStack: async (g) => { teardowns.push(g.name); },
    cleanup: async () => { cleanups.push(1); },
    now: () => T0,
    log: () => {},
  };
}

describe('gates', () => {
  it('no-ops when the merge train is disabled', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj, { enabled: false });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('disabled');
    expect(deps.assembled).toHaveLength(0);
  });

  it('no-ops when there is no active flywheel run (null ready set)', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj, { readySet: null });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('no-queue');
    expect(deps.assembled).toHaveLength(0);
  });
});

describe('first assembly', () => {
  it('assembles a generation when nothing live answers the ready set', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj);
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('assembled');
    expect(deps.assembled).toEqual([READY]);
    expect(deps.cleanups.length).toBeGreaterThan(0);
  });

  it('reports assembly-failed when the engine returns a failed generation', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj, { assembleStatus: 'failed' });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('assembly-failed');
  });
});

describe('idle matching', () => {
  it('does nothing when a live generation matches members, heads, and base', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj, { rows: [gen(proj, 'uat/pan-otter-0610', 'ready')] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('idle');
    expect(deps.assembled).toHaveLength(0);
  });

  it('a superseded generation matching the desired set also counts as answered', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj, { rows: [gen(proj, 'uat/pan-otter-0610', 'superseded')] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('idle');
  });

  it('a generation that held a feature out still answers the same desired set', async () => {
    const proj = freshProject();
    const g = gen(proj, 'uat/pan-otter-0610', 'ready', {
      members: [{ issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 }],
      heldOut: [{ issueId: 'PAN-2', branch: 'feature/pan-2', headSha: 'h2', reason: 'unresolvable conflict' }],
    });
    const deps = makeDeps(proj, { rows: [g] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('idle');
  });
});

describe('growth and invalidation', () => {
  it('a new ready feature triggers a superset assembly while the current stays live', async () => {
    const proj = freshProject();
    const current = gen(proj, 'uat/pan-otter-0610', 'ready');
    const bigger = [...READY, { issueId: 'PAN-3', title: 'Third', branch: 'feature/pan-3' }];
    const deps = makeDeps(proj, { rows: [current], readySet: bigger, headShas: { 'feature/pan-3': 'h3' } });

    const result = await reconcileUatGenerations(proj, deps);

    expect(result.action).toBe('assembled');
    expect(deps.assembled[0]!.map((f) => f.issueId)).toEqual(['PAN-1', 'PAN-2', 'PAN-3']);
    // current is a valid SUBSET off the same base — not invalidated here
    // (the engine flips it to superseded when the new one reaches ready)
    expect(result.invalidated).toEqual([]);
  });

  it('keeps a ready generation testable when main merely advances — assembles a fresh one instead', async () => {
    // First live run (2026-06-10): an active flywheel lands strike commits on
    // main continuously; invalidating on base movement churned every ready
    // batch to death. Base movement must trigger REASSEMBLY, not destruction —
    // promote enforces moved-base safety via the member-file overlap check.
    const proj = freshProject();
    const aged = gen(proj, 'uat/pan-old-0610', 'ready', { baseSha: 'older-main', stackStartedAt: '2026-06-10T10:00:00.000Z' });
    const deps = makeDeps(proj, { rows: [aged] });

    const result = await reconcileUatGenerations(proj, deps);

    expect(result.invalidated).toEqual([]);
    expect(deps.rows.get('uat/pan-old-0610')!.status).toBe('ready');
    expect(deps.teardowns).toEqual([]);
    expect(result.action).toBe('assembled'); // fresh superset off current main
  });

  it('invalidates when a member leaves the queue or its branch gains commits', async () => {
    const proj = freshProject();
    const memberLeft = gen(proj, 'uat/pan-left-0610', 'ready');
    const deps1 = makeDeps(proj, {
      rows: [memberLeft],
      readySet: [READY[0]!],
    });
    const r1 = await reconcileUatGenerations(proj, deps1);
    expect(r1.invalidated).toEqual(['uat/pan-left-0610']);

    const proj2 = freshProject();
    const branchMoved = gen(proj2, 'uat/pan-moved-0610', 'ready');
    const deps2 = makeDeps(proj2, { rows: [branchMoved], headShas: { 'feature/pan-2': 'h2-NEW' } });
    const r2 = await reconcileUatGenerations(proj2, deps2);
    expect(r2.invalidated).toEqual(['uat/pan-moved-0610']);
  });

  it('held-out drift triggers reassembly, never invalidation of the testable batch', async () => {
    // Held-out features are not in the tree — their branch moving (a retry
    // chance) or leaving the queue must spawn a fresh generation while the
    // current one stays UAT-able.
    const proj = freshProject();
    const heldOut = gen(proj, 'uat/pan-held-0610', 'ready', {
      members: [{ issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 }],
      heldOut: [{ issueId: 'PAN-2', branch: 'feature/pan-2', headSha: 'h2', reason: 'unresolvable conflict' }],
    });
    const deps = makeDeps(proj, { rows: [heldOut], headShas: { 'feature/pan-2': 'h2-NEW' } });

    const result = await reconcileUatGenerations(proj, deps);

    expect(result.invalidated).toEqual([]);
    expect(deps.rows.get('uat/pan-held-0610')!.status).toBe('ready');
    expect(result.action).toBe('assembled'); // retry chance for PAN-2 in a fresh generation
  });
});

describe('single-flight, stuck assemblies, backoff', () => {
  it('respects an in-flight assembling generation', async () => {
    const proj = freshProject();
    const assembling = gen(proj, 'uat/pan-building-0610', 'assembling', {
      createdAt: new Date(T0 - 60_000).toISOString(),
    });
    const deps = makeDeps(proj, { rows: [assembling] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('in-flight');
    expect(deps.assembled).toHaveLength(0);
  });

  it('marks a stuck assembling generation failed and proceeds', async () => {
    const proj = freshProject();
    const stuck = gen(proj, 'uat/pan-stuck-0610', 'assembling', {
      createdAt: new Date(T0 - STUCK_ASSEMBLING_MS - 1000).toISOString(),
    });
    const deps = makeDeps(proj, { rows: [stuck] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(deps.rows.get('uat/pan-stuck-0610')!.status).toBe('failed');
    expect(result.action).toBe('assembled');
  });

  it('backs off after a recent failure for the same desired input', async () => {
    const proj = freshProject();
    const failed = gen(proj, 'uat/pan-failed-0610', 'failed', {
      updatedAt: new Date(T0 - FAILED_RETRY_BACKOFF_MS / 2).toISOString(),
    });
    const deps = makeDeps(proj, { rows: [failed] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('backoff');
    expect(deps.assembled).toHaveLength(0);
  });

  it('backs off after a recent held-out failure for the same branch heads', async () => {
    const proj = freshProject();
    const failed = gen(proj, 'uat/pan-held-failed-0610', 'failed', {
      members: [{ issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 }],
      heldOut: [{ issueId: 'PAN-2', branch: 'feature/pan-2', headSha: 'h2', reason: 'unresolvable conflict' }],
      updatedAt: new Date(T0 - FAILED_RETRY_BACKOFF_MS / 2).toISOString(),
    });
    const deps = makeDeps(proj, { rows: [failed] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('backoff');
    expect(deps.assembled).toHaveLength(0);
  });

  it('retries after the backoff window, and force bypasses backoff entirely', async () => {
    const proj = freshProject();
    const failed = gen(proj, 'uat/pan-failed-0610', 'failed', {
      updatedAt: new Date(T0 - FAILED_RETRY_BACKOFF_MS - 1000).toISOString(),
    });
    const deps = makeDeps(proj, { rows: [failed] });
    expect((await reconcileUatGenerations(proj, deps)).action).toBe('assembled');

    const proj2 = freshProject();
    const recent = gen(proj2, 'uat/pan-failed2-0610', 'failed', {
      updatedAt: new Date(T0 - 1000).toISOString(),
    });
    const deps2 = makeDeps(proj2, { rows: [recent] });
    expect((await reconcileUatGenerations(proj2, deps2, { force: true })).action).toBe('assembled');
  });

  it('force also reassembles when a live generation already matches', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj, { rows: [gen(proj, 'uat/pan-otter-0610', 'ready')] });
    const result = await reconcileUatGenerations(proj, deps, { force: true });
    expect(result.action).toBe('assembled');
  });

  it('concurrent ticks for the same project collapse to one', async () => {
    const proj = freshProject();
    let release: () => void = () => {};
    const blocked = new Promise<void>((r) => { release = r; });
    const deps = makeDeps(proj);
    const slowAssemble = deps.assemble;
    deps.assemble = async (features) => { await blocked; return slowAssemble(features); };

    const first = reconcileUatGenerations(proj, deps);
    const second = await reconcileUatGenerations(proj, deps);
    expect(second.action).toBe('in-flight');
    release();
    expect((await first).action).toBe('assembled');
    expect(deps.assembled).toHaveLength(1);
  });
});

describe('empty queue', () => {
  it('is idle (after invalidation rules) when the ready set is empty', async () => {
    const proj = freshProject();
    const deps = makeDeps(proj, { readySet: [] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.action).toBe('idle');
    expect(deps.assembled).toHaveLength(0);
  });

  it('an empty queue invalidates generations whose members all merged away', async () => {
    const proj = freshProject();
    // members no longer in the (empty) desired set → stale
    const leftover = gen(proj, 'uat/pan-leftover-0610', 'ready');
    const deps = makeDeps(proj, { rows: [leftover], readySet: [] });
    const result = await reconcileUatGenerations(proj, deps);
    expect(result.invalidated).toEqual(['uat/pan-leftover-0610']);
    expect(result.action).toBe('idle');
  });
});
