/**
 * Tests for polyrepo generation teardown (PAN-3093).
 *
 * A polyrepo generation's artifacts are spread across N member repos plus the
 * wrapper folder that holds their worktrees, none of which the monorepo cleanup
 * path can reach. These tests pin that every one of them is removed, and that a
 * partial failure leaves cleanedAt unset so the next patrol retries.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  cleanupUatGenerations,
  type GenerationCleanupDeps,
  type GenerationStorePort,
} from '../../../../src/lib/cloister/uat-generation-engine.js';
import type { UatGeneration, UatGenerationRepo } from '../../../../src/lib/overdeck/merge-sync.js';

const PROJECT_ROOT = '/tmp/myn';
const GEN_NAME = 'uat/min-otter-0727';
const GEN_FOLDER = `${PROJECT_ROOT}/workspaces/uat-min-otter-0727`;

function repoRow(repoKey: string, mergeOrder: number): UatGenerationRepo {
  return {
    repoKey,
    repoPath: `${PROJECT_ROOT}/${repoKey}`,
    branch: GEN_NAME,
    baseSha: `${repoKey}-base`,
    worktreePath: `${GEN_FOLDER}/${repoKey}`,
    mergeOrder,
    promotedAt: null,
  };
}

function generation(overrides: Partial<UatGeneration> = {}): UatGeneration {
  return {
    name: GEN_NAME,
    worktreePath: GEN_FOLDER,
    projectRoot: PROJECT_ROOT,
    baseSha: 'fe@aaa1111 api@bbb2222',
    status: 'promoted',
    repos: [repoRow('fe', 0), repoRow('api', 1)],
    members: [],
    heldOut: [],
    resolutions: [],
    stackStartedAt: '2026-07-27T10:00:00.000Z',
    cleanedAt: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

function makeStore(rows: UatGeneration[]): GenerationStorePort & { patches: Array<[string, unknown]> } {
  const patches: Array<[string, unknown]> = [];
  const byName = new Map(rows.map((g) => [g.name, g]));
  return {
    patches,
    insert: () => {},
    update: (name, patch) => {
      patches.push([name, patch]);
      const existing = byName.get(name);
      if (existing) byName.set(name, { ...existing, ...patch } as UatGeneration);
    },
    listNames: () => [...byName.keys()],
    listChain: (_projectRoot, statuses) =>
      [...byName.values()].filter((g) => !statuses || statuses.includes(g.status)),
  };
}

interface Recorder {
  repoArtifacts: string[];
  residue: string[];
  stacks: string[];
  monoWorktrees: string[];
  monoBranches: string[];
  logs: string[];
}

function makeDeps(
  store: GenerationStorePort,
  recorder: Recorder,
  overrides: Partial<GenerationCleanupDeps> = {},
): GenerationCleanupDeps {
  return {
    store,
    removeWorktree: async (path) => { recorder.monoWorktrees.push(path); },
    deleteBranch: async (branch) => { recorder.monoBranches.push(branch); },
    removeRepoArtifacts: async (repo) => { recorder.repoArtifacts.push(`${repo.repoKey}:${repo.worktreePath}:${repo.branch}`); },
    removeGenerationResidue: async (gen) => { recorder.residue.push(gen.worktreePath); },
    teardownStack: async (gen) => { recorder.stacks.push(gen.name); },
    log: (msg) => recorder.logs.push(msg),
    ...overrides,
  };
}

function recorder(): Recorder {
  return { repoArtifacts: [], residue: [], stacks: [], monoWorktrees: [], monoBranches: [], logs: [] };
}

describe('polyrepo generation cleanup', () => {
  it('removes every per-repo worktree and branch, the stack, and the wrapper folder, then sets cleanedAt', async () => {
    const store = makeStore([generation()]);
    const rec = recorder();

    await cleanupUatGenerations(PROJECT_ROOT, makeDeps(store, rec));

    expect(rec.repoArtifacts).toEqual([
      `fe:${GEN_FOLDER}/fe:${GEN_NAME}`,
      `api:${GEN_FOLDER}/api:${GEN_NAME}`,
    ]);
    expect(rec.residue).toEqual([GEN_FOLDER]);
    expect(rec.stacks).toEqual([GEN_NAME]);

    const patch = store.patches.find(([name]) => name === GEN_NAME)?.[1] as { cleanedAt?: string };
    expect(patch.cleanedAt).toBeTruthy();
  });

  it('never uses the monorepo worktree/branch hooks for a polyrepo generation', async () => {
    const rec = recorder();

    await cleanupUatGenerations(PROJECT_ROOT, makeDeps(makeStore([generation()]), rec));

    expect(rec.monoWorktrees).toEqual([]);
    expect(rec.monoBranches).toEqual([]);
  });

  it('leaves cleanedAt unset and logs when one repo fails to clean', async () => {
    const store = makeStore([generation()]);
    const rec = recorder();

    await cleanupUatGenerations(PROJECT_ROOT, makeDeps(store, rec, {
      removeRepoArtifacts: async (repo) => {
        if (repo.repoKey === 'api') throw new Error('branch -D refused');
        rec.repoArtifacts.push(repo.repoKey);
      },
    }));

    expect(store.patches).toEqual([]);
    expect(rec.logs.join('\n')).toContain('api artifact removal failed');
    expect(rec.logs.join('\n')).toContain('branch -D refused');
  });

  it('still attempts the remaining repos after one fails, so nothing is stranded', async () => {
    const rec = recorder();
    const attempted: string[] = [];

    await cleanupUatGenerations(PROJECT_ROOT, makeDeps(makeStore([generation()]), rec, {
      removeRepoArtifacts: async (repo) => {
        attempted.push(repo.repoKey);
        if (repo.repoKey === 'fe') throw new Error('boom');
      },
    }));

    expect(attempted).toEqual(['fe', 'api']);
  });

  it('leaves cleanedAt unset when the wrapper folder cannot be removed', async () => {
    const store = makeStore([generation()]);
    const rec = recorder();

    await cleanupUatGenerations(PROJECT_ROOT, makeDeps(store, rec, {
      removeGenerationResidue: async () => { throw new Error('EBUSY'); },
    }));

    expect(store.patches).toEqual([]);
    expect(rec.logs.join('\n')).toContain('generation folder removal failed');
  });

  it('flips a trimmed live generation to invalidated after per-repo cleanup', async () => {
    // keep: 0 pushes the ready generation past the retention window.
    const store = makeStore([generation({ status: 'ready' })]);
    const rec = recorder();

    await cleanupUatGenerations(PROJECT_ROOT, makeDeps(store, rec), { keep: 0 });

    expect(rec.repoArtifacts).toHaveLength(2);
    const patch = store.patches.find(([name]) => name === GEN_NAME)?.[1] as { status?: string; cleanedAt?: string };
    expect(patch.status).toBe('invalidated');
    expect(patch.cleanedAt).toBeTruthy();
  });

  it('skips generations already marked cleaned', async () => {
    const rec = recorder();

    await cleanupUatGenerations(
      PROJECT_ROOT,
      makeDeps(makeStore([generation({ cleanedAt: '2026-07-27T11:00:00.000Z' })]), rec),
    );

    expect(rec.repoArtifacts).toEqual([]);
  });
});

describe('monorepo cleanup is unaffected', () => {
  it('uses the single worktree/branch hooks when no per-repo hook is injected', async () => {
    const store = makeStore([generation({
      // What a monorepo generation reads back as: one synthesized repo entry.
      repos: [{
        repoKey: 'overdeck',
        repoPath: PROJECT_ROOT,
        branch: GEN_NAME,
        baseSha: 'abc123',
        worktreePath: GEN_FOLDER,
        mergeOrder: 0,
        promotedAt: null,
      }],
    })]);
    const rec = recorder();
    const deps = makeDeps(store, rec);
    // Drop the polyrepo hooks — this is the monorepo wiring.
    delete (deps as { removeRepoArtifacts?: unknown }).removeRepoArtifacts;
    delete (deps as { removeGenerationResidue?: unknown }).removeGenerationResidue;

    await cleanupUatGenerations(PROJECT_ROOT, deps);

    expect(rec.monoWorktrees).toEqual([GEN_FOLDER]);
    expect(rec.monoBranches).toEqual([GEN_NAME]);
    expect(rec.repoArtifacts).toEqual([]);
    const patch = store.patches.find(([name]) => name === GEN_NAME)?.[1] as { cleanedAt?: string };
    expect(patch.cleanedAt).toBeTruthy();
  });
});
