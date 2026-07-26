/**
 * Tests for polyrepo UAT generation assembly (PAN-3093).
 *
 * All git and store I/O is faked per repo — no live git. The behaviours that
 * distinguish polyrepo assembly from N independent assemblies are the ones
 * pinned hardest here: a feature that fails in one repo is held out of ALL
 * repos, and the branches that already merged it are rebuilt without it.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assemblePolyrepoUatGeneration,
  compositeBaseAnchor,
  type PolyrepoAssembleDeps,
  type PolyrepoAssembleInput,
} from '../../../../src/lib/cloister/uat-polyrepo-engine.js';
import type {
  ConflictContext,
  ConflictResolutionResult,
  GenerationGitDeps,
  GenerationStorePort,
  ReadyFeature,
} from '../../../../src/lib/cloister/uat-generation-engine.js';
import type { UatGeneration } from '../../../../src/lib/overdeck/merge-sync.js';
import type { ResolvedProjectRepo } from '../../../../src/lib/project-repos.js';

const PROJECT_ROOT = '/tmp/myn';

function repo(repoKey: string, mergeOrder: number): ResolvedProjectRepo {
  return {
    projectKey: 'mind-your-now',
    projectPath: PROJECT_ROOT,
    repoKey,
    repoPath: `${PROJECT_ROOT}/${repoKey}`,
    forge: 'github',
    sourceBranch: 'unused',
    targetBranch: 'main',
    mergeOrder,
    required: true,
  };
}

function feature(
  issueId: string,
  repoKeys: string[],
  overrides: Partial<ReadyFeature> = {},
): ReadyFeature {
  const branch = `feature/${issueId.toLowerCase()}`;
  return {
    issueId,
    title: `${issueId} title`,
    branch,
    repoContributions: repoKeys.map((repoKey, i) => ({
      repoKey,
      repoPath: `${PROJECT_ROOT}/${repoKey}`,
      branch,
      targetBranch: 'main',
      mergeOrder: i,
    })),
    ...overrides,
  };
}

interface FakeRepoGit extends GenerationGitDeps {
  /** Feature branches merged into this repo's branch, in order. */
  merged: string[];
  /** Every worktree creation, so a replay is observable. */
  worktreeCreations: string[];
  pushes: string[];
}

interface FakeRepoOptions {
  baseSha?: string;
  /** Feature branches whose merge reports a conflict. */
  conflictOn?: string[];
  /** Feature branches whose merge fails outright (not a conflict). */
  failOn?: string[];
  failWorktree?: boolean;
  failPush?: boolean;
}

function makeRepoGit(repoKey: string, options: FakeRepoOptions = {}): FakeRepoGit {
  const merged: string[] = [];
  const worktreeCreations: string[] = [];
  const pushes: string[] = [];

  return {
    merged,
    worktreeCreations,
    pushes,
    fetchMain: async () => options.baseSha ?? `${repoKey}-base-sha-0000000`,
    createWorktree: async (_branch, path) => {
      if (options.failWorktree) throw new Error(`worktree boom in ${repoKey}`);
      worktreeCreations.push(path);
      // A rebuild resets the branch to base — drop everything merged so far.
      merged.length = 0;
    },
    branchHeadSha: async (branch) => `${repoKey}-${branch.replace(/\W/g, '')}-head`,
    mergeBranch: async (branch) => {
      if (options.failOn?.includes(branch)) {
        return { ok: false as const, conflict: false, reason: `merge exploded in ${repoKey}` };
      }
      if (options.conflictOn?.includes(branch)) {
        return { ok: false as const, conflict: true, reason: 'conflict' };
      }
      merged.push(branch);
      return { ok: true as const };
    },
    abortMerge: async () => {},
    push: async (branchName) => {
      if (options.failPush) throw new Error(`push boom in ${repoKey}`);
      pushes.push(branchName);
    },
  };
}

function makeStore(initial: UatGeneration[] = []): GenerationStorePort & { rows: Map<string, UatGeneration> } {
  const rows = new Map<string, UatGeneration>(initial.map((g) => [g.name, g]));
  return {
    rows,
    insert: (gen) => { rows.set(gen.name, { ...gen, createdAt: '', updatedAt: '' } as UatGeneration); },
    update: (name, patch) => {
      const existing = rows.get(name);
      if (existing) rows.set(name, { ...existing, ...patch } as UatGeneration);
    },
    listNames: () => [...rows.keys()],
    listChain: (projectRoot, statuses) =>
      [...rows.values()].filter(
        (g) => g.projectRoot === projectRoot && (!statuses || statuses.includes(g.status)),
      ),
  };
}

function input(overrides: Partial<PolyrepoAssembleInput> = {}): PolyrepoAssembleInput {
  return {
    projectRoot: PROJECT_ROOT,
    label: 'min',
    dateIso: '2026-07-27T00:00:00.000Z',
    features: [feature('MIN-901', ['fe', 'api']), feature('MIN-902', ['api'])],
    repos: [repo('fe', 0), repo('api', 1), repo('infra', 2)],
    ...overrides,
  };
}

function deps(
  repoGit: Map<string, GenerationGitDeps>,
  store: GenerationStorePort,
  extra: Partial<PolyrepoAssembleDeps> = {},
): PolyrepoAssembleDeps {
  return { repoGit, store, ...extra };
}

describe('assemblePolyrepoUatGeneration — happy path', () => {
  it('branches every contributing repo off its own base and stores the composite anchor', async () => {
    const fe = makeRepoGit('fe', { baseSha: 'aaa1111aaa' });
    const api = makeRepoGit('api', { baseSha: 'bbb2222bbb' });
    const store = makeStore();

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', fe], ['api', api]]), store),
    );

    expect(gen.status).toBe('ready');
    expect(gen.repos!.map((r) => r.repoKey)).toEqual(['fe', 'api']);
    expect(gen.repos!.map((r) => r.baseSha)).toEqual(['aaa1111aaa', 'bbb2222bbb']);
    expect(gen.repos!.map((r) => r.branch)).toEqual([gen.name, gen.name]);
    expect(gen.repos!.map((r) => r.worktreePath)).toEqual([
      `${gen.worktreePath}/fe`,
      `${gen.worktreePath}/api`,
    ]);
    // Composite anchor uses short SHAs in merge order.
    expect(gen.baseSha).toBe('fe@aaa1111 api@bbb2222');
    expect(store.rows.get(gen.name)!.baseSha).toBe('fe@aaa1111 api@bbb2222');
  });

  it('merges each feature only into the repos it contributes to', async () => {
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');

    await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', fe], ['api', api]]), makeStore()),
    );

    expect(fe.merged).toEqual(['feature/min-901']);
    expect(api.merged).toEqual(['feature/min-901', 'feature/min-902']);
  });

  it('records per-repo contributions on each member', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api')]]), makeStore()),
    );

    const min901 = gen.members.find((m) => m.issueId === 'MIN-901')!;
    expect(min901.repos!.map((r) => r.repoKey)).toEqual(['fe', 'api']);
    expect(min901.repos!.map((r) => r.mergeOrderInRepo)).toEqual([1, 1]);

    const min902 = gen.members.find((m) => m.issueId === 'MIN-902')!;
    expect(min902.repos!.map((r) => r.repoKey)).toEqual(['api']);
    // Second merge into api.
    expect(min902.repos![0]!.mergeOrderInRepo).toBe(2);
  });

  it('pushes every contributing repo branch', async () => {
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', fe], ['api', api]]), makeStore()),
    );

    expect(fe.pushes).toEqual([gen.name]);
    expect(api.pushes).toEqual([gen.name]);
  });

  it('supersedes older ready generations for the project', async () => {
    const older = {
      name: 'uat/min-older-0726', projectRoot: PROJECT_ROOT, status: 'ready',
      worktreePath: '', baseSha: '', members: [], heldOut: [], resolutions: [],
      stackStartedAt: null, cleanedAt: null, createdAt: '', updatedAt: '',
    } as unknown as UatGeneration;
    const store = makeStore([older]);

    await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api')]]), store),
    );

    expect(store.rows.get('uat/min-older-0726')!.status).toBe('superseded');
  });
});

describe('assemblePolyrepoUatGeneration — repos with no contribution', () => {
  it('creates no worktree and no branch for a repo no feature touches', async () => {
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');
    const infra = makeRepoGit('infra');

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', fe], ['api', api], ['infra', infra]]), makeStore()),
    );

    expect(gen.repos!.map((r) => r.repoKey)).not.toContain('infra');
    expect(infra.worktreeCreations).toEqual([]);
    expect(infra.pushes).toEqual([]);
  });

  it('fails when no repo has any contribution at all', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input({ features: [feature('MIN-901', [])] }),
      deps(new Map([['fe', makeRepoGit('fe')]]), makeStore()),
    );

    expect(gen.status).toBe('failed');
    expect(gen.repos).toEqual([]);
  });

  it('fails when a contributing repo has no injected git deps', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input(),
      // 'api' contributes but is missing from the map.
      deps(new Map([['fe', makeRepoGit('fe')]]), makeStore()),
    );

    expect(gen.status).toBe('failed');
  });
});

describe('assemblePolyrepoUatGeneration — global hold-out', () => {
  it('holds a feature out of EVERY repo when it cannot be resolved in one, rebuilding the others', async () => {
    // MIN-901 spans fe + api and merges cleanly in fe, but conflicts
    // unresolvably in api. It must not survive in fe either.
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { conflictOn: ['feature/min-901'] });
    const store = makeStore();

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      // No resolveConflict hook: every conflict is unresolvable.
      deps(new Map([['fe', fe], ['api', api]]), store),
    );

    expect(gen.status).toBe('ready');
    expect(gen.members.map((m) => m.issueId)).toEqual(['MIN-902']);
    // Not merged anywhere the generation actually publishes: api rebuilt
    // without it, and fe never got a published branch at all.
    expect(api.merged).not.toContain('feature/min-901');
    expect(fe.pushes).toEqual([]);
    expect(gen.members.flatMap((m) => m.repos ?? [])).not.toContainEqual(
      expect.objectContaining({ repoKey: 'fe' }),
    );

    expect(gen.heldOut).toHaveLength(1);
    expect(gen.heldOut[0]!.issueId).toBe('MIN-901');
    expect(gen.heldOut[0]!.reason).toContain('in api');
  });

  it('drops a repo entirely when the hold-out leaves it with no contribution', async () => {
    // MIN-901 is fe's only contribution. Once it is held out for conflicting in
    // api, fe has nothing to carry — it must not get a branch or a push.
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { conflictOn: ['feature/min-901'] });

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', fe], ['api', api]]), makeStore()),
    );

    expect(gen.repos!.map((r) => r.repoKey)).toEqual(['api']);
    expect(fe.pushes).toEqual([]);
    // Anchor covers only the repos that actually carry the generation.
    expect(gen.baseSha).toBe('api@api-bas');
  });

  it('rebuilds a still-contributing repo from base when a shared feature is held out', async () => {
    // MIN-903 keeps fe in the generation, so fe is rebuilt without MIN-901
    // rather than dropped.
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { conflictOn: ['feature/min-901'] });

    const gen = await assemblePolyrepoUatGeneration(
      input({
        features: [
          feature('MIN-901', ['fe', 'api']),
          feature('MIN-902', ['api']),
          feature('MIN-903', ['fe']),
        ],
      }),
      deps(new Map([['fe', fe], ['api', api]]), makeStore()),
    );

    expect(gen.status).toBe('ready');
    expect(gen.repos!.map((r) => r.repoKey)).toEqual(['fe', 'api']);
    // Rebuilt: MIN-901 gone, MIN-903 still there.
    expect(fe.merged).toEqual(['feature/min-903']);
    expect(fe.worktreeCreations.length).toBe(2);
    expect(gen.members.map((m) => m.issueId)).toEqual(['MIN-902', 'MIN-903']);
  });

  it('records the held-out feature exactly once even though assembly replays', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(
        new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api', { conflictOn: ['feature/min-901'] })]]),
        makeStore(),
      ),
    );

    expect(gen.heldOut.filter((h) => h.issueId === 'MIN-901')).toHaveLength(1);
  });

  it('keeps a feature that the conflict hook successfully resolves', async () => {
    const resolveConflict = vi.fn(
      async (): Promise<ConflictResolutionResult> => ({ files: ['src/x.ts'], commitSha: 'fixed-sha' }),
    );
    const api = makeRepoGit('api', { conflictOn: ['feature/min-902'] });

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', makeRepoGit('fe')], ['api', api]]), makeStore(), { resolveConflict }),
    );

    expect(gen.status).toBe('ready');
    expect(gen.members.map((m) => m.issueId)).toEqual(['MIN-901', 'MIN-902']);
    expect(gen.heldOut).toEqual([]);
    expect(gen.resolutions).toEqual([
      { issueIds: ['MIN-902'], files: ['src/x.ts'], commitSha: 'fixed-sha' },
    ]);
  });

  it('names the conflicting repo and its worktree in the hook context', async () => {
    const seen: ConflictContext[] = [];
    const resolveConflict = vi.fn(async (ctx: ConflictContext) => {
      seen.push(ctx);
      return { files: ['src/x.ts'], commitSha: 'fixed-sha' };
    });

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(
        new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api', { conflictOn: ['feature/min-902'] })]]),
        makeStore(),
        { resolveConflict },
      ),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.repoKey).toBe('api');
    expect(seen[0]!.worktreePath).toBe(`${gen.worktreePath}/api`);
  });

  it('holds out a feature whose merge fails for a non-conflict reason', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(
        new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api', { failOn: ['feature/min-902'] })]]),
        makeStore(),
      ),
    );

    expect(gen.members.map((m) => m.issueId)).toEqual(['MIN-901']);
    expect(gen.heldOut[0]!.issueId).toBe('MIN-902');
    expect(gen.heldOut[0]!.reason).toContain('merge exploded in api');
  });

  it('fails when every feature ends up held out', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(
        new Map([
          ['fe', makeRepoGit('fe')],
          ['api', makeRepoGit('api', { conflictOn: ['feature/min-901', 'feature/min-902'] })],
        ]),
        makeStore(),
      ),
    );

    expect(gen.status).toBe('failed');
    expect(gen.members).toEqual([]);
    expect(gen.heldOut.map((h) => h.issueId).sort()).toEqual(['MIN-901', 'MIN-902']);
  });
});

describe('assemblePolyrepoUatGeneration — failure paths', () => {
  it('marks the generation failed when a later repo fails to push', async () => {
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { failPush: true });

    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(new Map([['fe', fe], ['api', api]]), makeStore()),
    );

    expect(gen.status).toBe('failed');
    // repo A did land its branch; cleanup reaps it later.
    expect(fe.pushes).toEqual([gen.name]);
    expect(api.pushes).toEqual([]);
  });

  it('marks the generation failed when a worktree cannot be created', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input(),
      deps(
        new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api', { failWorktree: true })]]),
        makeStore(),
      ),
    );

    expect(gen.status).toBe('failed');
    expect(gen.members).toEqual([]);
  });

  it('fails with no members when the feature list is empty', async () => {
    const gen = await assemblePolyrepoUatGeneration(
      input({ features: [] }),
      deps(new Map([['fe', makeRepoGit('fe')]]), makeStore()),
    );

    expect(gen.status).toBe('failed');
    expect(gen.members).toEqual([]);
  });
});

describe('compositeBaseAnchor', () => {
  it('renders repoKey@shortSha in merge order regardless of input order', () => {
    const anchor = compositeBaseAnchor([
      { repoKey: 'api', repoPath: '', branch: '', baseSha: 'bbb2222bbbbbb', worktreePath: '', mergeOrder: 1 },
      { repoKey: 'fe', repoPath: '', branch: '', baseSha: 'aaa1111aaaaaa', worktreePath: '', mergeOrder: 0 },
    ]);

    expect(anchor).toBe('fe@aaa1111 api@bbb2222');
  });
});
