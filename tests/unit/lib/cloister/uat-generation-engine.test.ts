/**
 * Tests for the UAT generation assembly engine (PAN-1737).
 * Fake git + store deps — every path is exercised without touching git.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assembleUatGeneration,
  cleanupUatGenerations,
  generationFolderName,
  type AssembleGenerationDeps,
  type GenerationGitDeps,
  type GenerationStorePort,
  type ReadyFeature,
} from '../../../../src/lib/cloister/uat-generation-engine.js';
import type { UatGeneration, UatGenerationStatus } from '../../../../src/lib/database/uat-generations-db.js';

// ============== Fakes ==============

function makeFakeStore(initial: UatGeneration[] = []): GenerationStorePort & { rows: Map<string, UatGeneration> } {
  const rows = new Map<string, UatGeneration>(initial.map((g) => [g.name, g]));
  let counter = 0;
  return {
    rows,
    insert: (gen) => {
      counter += 1;
      rows.set(gen.name, { ...gen, createdAt: `2026-06-10T00:00:0${counter}.000Z`, updatedAt: '' });
    },
    update: (name, patch) => {
      const existing = rows.get(name);
      if (!existing) throw new Error(`not found: ${name}`);
      rows.set(name, { ...existing, ...patch } as UatGeneration);
    },
    listNames: () => [...rows.keys()],
    listChain: (projectRoot, statuses) =>
      [...rows.values()]
        .filter((g) => g.projectRoot === projectRoot)
        .filter((g) => !statuses || statuses.includes(g.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

interface FakeGitOptions {
  /** branch → outcome; default clean merge. */
  merges?: Record<string, { ok: true } | { ok: false; conflict: boolean; reason: string } | Error>;
  failWorktree?: boolean;
  failPush?: boolean;
}

function makeFakeGit(options: FakeGitOptions = {}): GenerationGitDeps & {
  calls: { merged: string[]; aborts: number; pushed: string[] };
} {
  const calls = { merged: [] as string[], aborts: 0, pushed: [] as string[] };
  return {
    calls,
    fetchMain: async () => 'main-sha-123',
    createWorktree: async () => {
      if (options.failWorktree) throw new Error('disk full');
    },
    branchHeadSha: async (branch) => `sha-of-${branch}`,
    mergeBranch: async (branch) => {
      calls.merged.push(branch);
      const outcome = options.merges?.[branch];
      if (outcome instanceof Error) throw outcome;
      return outcome ?? { ok: true };
    },
    abortMerge: async () => { calls.aborts += 1; },
    push: async (name) => {
      if (options.failPush) throw new Error('remote rejected');
      calls.pushed.push(name);
    },
  };
}

const FEATURES: ReadyFeature[] = [
  { issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11' },
  { issueId: 'PAN-2', title: 'Second', branch: 'feature/pan-2' },
  { issueId: 'PAN-3', title: 'Third', branch: 'feature/pan-3', conflictsWith: ['PAN-1'] },
];

function input(features: ReadyFeature[] = FEATURES) {
  return { projectRoot: '/proj', label: 'pan', dateIso: '2026-06-10T12:00:00.000Z', features };
}

function deps(git: GenerationGitDeps, store: GenerationStorePort, extra: Partial<AssembleGenerationDeps> = {}): AssembleGenerationDeps {
  return { git, store, ...extra };
}

// ============== Tests ==============

describe('assembleUatGeneration — happy path', () => {
  it('merges all features in order, pushes, and records a ready generation', async () => {
    const git = makeFakeGit();
    const store = makeFakeStore();

    const gen = await assembleUatGeneration(input(), deps(git, store));

    expect(gen.status).toBe('ready');
    expect(gen.name).toMatch(/^uat\/pan-[a-z]+-0610$/);
    expect(gen.baseSha).toBe('main-sha-123');
    expect(gen.members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-2', 'PAN-3']);
    expect(gen.members.map((m) => m.mergeOrder)).toEqual([1, 2, 3]);
    expect(gen.members[0]).toMatchObject({ headSha: 'sha-of-feature/pan-1', pr: 11 });
    expect(gen.heldOut).toEqual([]);
    expect(git.calls.merged).toEqual(['feature/pan-1', 'feature/pan-2', 'feature/pan-3']);
    expect(git.calls.pushed).toEqual([gen.name]);
    expect(store.rows.get(gen.name)!.status).toBe('ready');
    expect(gen.worktreePath).toBe(`/proj/workspaces/${generationFolderName(gen.name)}`);
  });

  it('supersedes older ready generations on success', async () => {
    const store = makeFakeStore([{
      name: 'uat/pan-otter-0609', worktreePath: '/proj/workspaces/uat-pan-otter-0609',
      projectRoot: '/proj', baseSha: 'old', status: 'ready',
      members: [], heldOut: [], resolutions: [], stackStartedAt: null,
      createdAt: '2026-06-09T00:00:00.000Z', updatedAt: '',
    }]);
    const gen = await assembleUatGeneration(input(), deps(makeFakeGit(), store));

    expect(store.rows.get('uat/pan-otter-0609')!.status).toBe('superseded');
    expect(store.rows.get(gen.name)!.status).toBe('ready');
  });

  it('reuses the same deterministic daily branch on rebuild', async () => {
    const store = makeFakeStore();
    const git = makeFakeGit();
    const first = await assembleUatGeneration(input(), deps(git, store));
    const second = await assembleUatGeneration(input(), deps(git, store));
    expect(second.name).toBe(first.name);
    expect(git.calls.pushed).toEqual([first.name, first.name]);
    expect(store.rows.get(first.name)!.status).toBe('ready');
  });
});

describe('assembleUatGeneration — conflicts', () => {
  const conflictOutcome = { ok: false as const, conflict: true, reason: 'CONFLICT (content): src/x.ts' };

  it('resolves a conflict via the hook and records the resolution pair', async () => {
    const git = makeFakeGit({ merges: { 'feature/pan-3': conflictOutcome } });
    const store = makeFakeStore();
    const hook = vi.fn(async () => ({ files: ['src/x.ts'], commitSha: 'resolved-sha' }));

    const gen = await assembleUatGeneration(input(), deps(git, store, { resolveConflict: hook }));

    expect(hook).toHaveBeenCalledTimes(1);
    const ctx = hook.mock.calls[0]![0] as { conflictingIssueIds: string[]; mergedIssueIds: string[] };
    expect(ctx.conflictingIssueIds).toEqual(['PAN-1']);
    expect(ctx.mergedIssueIds).toEqual(['PAN-1', 'PAN-2']);

    expect(gen.status).toBe('ready');
    expect(gen.members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-2', 'PAN-3']);
    expect(gen.resolutions).toEqual([
      { issueIds: ['PAN-3', 'PAN-1'], files: ['src/x.ts'], commitSha: 'resolved-sha' },
    ]);
    expect(git.calls.aborts).toBe(0);
  });

  it('holds the feature out when the hook gives up, and continues assembling', async () => {
    const git = makeFakeGit({ merges: { 'feature/pan-2': conflictOutcome } });
    const store = makeFakeStore();
    const hook = vi.fn(async () => null);

    const gen = await assembleUatGeneration(input(), deps(git, store, { resolveConflict: hook }));

    expect(gen.status).toBe('ready');
    expect(gen.members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-3']);
    expect(gen.heldOut).toHaveLength(1);
    expect(gen.heldOut[0]!.issueId).toBe('PAN-2');
    expect(gen.heldOut[0]!.reason).toContain('could not be auto-resolved');
    expect(git.calls.aborts).toBe(1);
  });

  it('holds out on hook exceptions without wedging the build', async () => {
    const git = makeFakeGit({ merges: { 'feature/pan-2': conflictOutcome } });
    const store = makeFakeStore();
    const hook = vi.fn(async () => { throw new Error('agent timeout'); });

    const gen = await assembleUatGeneration(input(), deps(git, store, { resolveConflict: hook }));

    expect(gen.status).toBe('ready');
    expect(gen.heldOut.map((h) => h.issueId)).toEqual(['PAN-2']);
    expect(git.calls.aborts).toBe(1);
  });

  it('holds out conflicts when no hook is provided', async () => {
    const git = makeFakeGit({ merges: { 'feature/pan-3': conflictOutcome } });
    const store = makeFakeStore();

    const gen = await assembleUatGeneration(input(), deps(git, store));

    expect(gen.members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-2']);
    expect(gen.heldOut[0]).toMatchObject({ issueId: 'PAN-3' });
    expect(gen.heldOut[0]!.reason).toContain('no assembly agent');
    expect(git.calls.aborts).toBe(1);
  });

  it('holds out non-conflict merge failures with the git reason', async () => {
    const git = makeFakeGit({ merges: { 'feature/pan-2': { ok: false, conflict: false, reason: 'fatal: bad object' } } });
    const store = makeFakeStore();

    const gen = await assembleUatGeneration(input(), deps(git, store));

    expect(gen.heldOut[0]).toMatchObject({
      issueId: 'PAN-2',
      branch: 'feature/pan-2',
      headSha: 'sha-of-feature/pan-2',
      reason: 'fatal: bad object',
    });
    expect(gen.members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-3']);
  });
});

describe('assembleUatGeneration — failure paths', () => {
  it('marks the generation failed when the worktree cannot be created', async () => {
    const gen = await assembleUatGeneration(input(), deps(makeFakeGit({ failWorktree: true }), makeFakeStore()));
    expect(gen.status).toBe('failed');
    expect(gen.members).toEqual([]);
  });

  it('marks failed when every feature is held out (nothing to push)', async () => {
    const conflict = { ok: false as const, conflict: true, reason: 'CONFLICT' };
    const git = makeFakeGit({ merges: { 'feature/pan-1': conflict, 'feature/pan-2': conflict, 'feature/pan-3': conflict } });
    const gen = await assembleUatGeneration(input(), deps(git, makeFakeStore()));
    expect(gen.status).toBe('failed');
    expect(gen.heldOut).toHaveLength(3);
    expect(git.calls.pushed).toEqual([]);
  });

  it('marks failed when the push is rejected', async () => {
    const gen = await assembleUatGeneration(input(), deps(makeFakeGit({ failPush: true }), makeFakeStore()));
    expect(gen.status).toBe('failed');
  });
});

describe('cleanupUatGenerations', () => {
  function liveGen(name: string, status: UatGenerationStatus, createdAt: string, stack = false): UatGeneration {
    return {
      name, worktreePath: `/proj/workspaces/${generationFolderName(name)}`, projectRoot: '/proj',
      baseSha: 'x', status, members: [], heldOut: [], resolutions: [],
      stackStartedAt: stack ? '2026-06-10T00:00:00.000Z' : null,
      createdAt, updatedAt: '',
    };
  }

  it('keeps the newest 3 live generations, trims the rest to invalidated, reaps dead rows', async () => {
    const store = makeFakeStore([
      liveGen('uat/pan-a-0610', 'ready', '2026-06-10T05:00:00.000Z'),
      liveGen('uat/pan-b-0610', 'superseded', '2026-06-10T04:00:00.000Z'),
      liveGen('uat/pan-c-0610', 'superseded', '2026-06-10T03:00:00.000Z'),
      liveGen('uat/pan-d-0610', 'superseded', '2026-06-10T02:00:00.000Z', true),
      liveGen('uat/pan-e-0610', 'promoted', '2026-06-10T01:00:00.000Z'),
      liveGen('uat/pan-f-0610', 'failed', '2026-06-10T00:30:00.000Z'),
    ]);
    const removed: string[] = [];
    const deleted: string[] = [];
    const teardowns: string[] = [];

    await cleanupUatGenerations('/proj', {
      store,
      removeWorktree: async (p) => { removed.push(p); },
      deleteBranch: async (b) => { deleted.push(b); },
      teardownStack: async (g) => { teardowns.push(g.name); },
    });

    // newest 3 live untouched
    expect(store.rows.get('uat/pan-a-0610')!.status).toBe('ready');
    expect(store.rows.get('uat/pan-b-0610')!.status).toBe('superseded');
    expect(store.rows.get('uat/pan-c-0610')!.status).toBe('superseded');
    // 4th live generation trimmed: stack torn down, branch+worktree gone, invalidated
    expect(store.rows.get('uat/pan-d-0610')!.status).toBe('invalidated');
    expect(store.rows.get('uat/pan-d-0610')!.cleanedAt).toBeTruthy();
    expect(teardowns).toEqual(['uat/pan-d-0610']);
    // dead rows reaped but statuses preserved and marked cleaned so future ticks skip them
    expect(store.rows.get('uat/pan-e-0610')!.status).toBe('promoted');
    expect(store.rows.get('uat/pan-e-0610')!.cleanedAt).toBeTruthy();
    expect(store.rows.get('uat/pan-f-0610')!.status).toBe('failed');
    expect(store.rows.get('uat/pan-f-0610')!.cleanedAt).toBeTruthy();
    expect(deleted.sort()).toEqual(['uat/pan-d-0610', 'uat/pan-e-0610', 'uat/pan-f-0610']);
    expect(removed).toHaveLength(3);
  });

  it('does not reprocess dead generations already marked cleaned', async () => {
    const store = makeFakeStore([
      liveGen('uat/pan-done-0610', 'promoted', '2026-06-10T01:00:00.000Z', false),
    ]);
    store.rows.set('uat/pan-done-0610', { ...store.rows.get('uat/pan-done-0610')!, cleanedAt: '2026-06-10T02:00:00.000Z' });
    const removed: string[] = [];
    const deleted: string[] = [];

    await cleanupUatGenerations('/proj', {
      store,
      removeWorktree: async (p) => { removed.push(p); },
      deleteBranch: async (b) => { deleted.push(b); },
    });

    expect(removed).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
