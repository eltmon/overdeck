/**
 * Tests for two-phase polyrepo promote (PAN-3093).
 *
 * The property that matters most is all-or-nothing at the decision point: a
 * failure in ANY repo during phase A must leave every remote untouched. Phase B
 * is deliberately NOT transactional — undoing a landed merge would mean
 * force-pushing a member repo's main — so it is tested for resumability
 * instead: landed repos are stamped and a retry skips them.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  promoteUatGeneration,
  type PolyrepoRepoPromoteGit,
  type PreparedRepoMerge,
  type UatPromoteDeps,
} from '../../../../src/lib/cloister/uat-promote.js';
import type { UatGeneration, UatGenerationRepo } from '../../../../src/lib/overdeck/merge-sync.js';

const PROJECT_ROOT = '/tmp/myn';
const GEN_NAME = 'uat/min-otter-0727';

function repoRow(repoKey: string, mergeOrder: number, overrides: Partial<UatGenerationRepo> = {}): UatGenerationRepo {
  return {
    repoKey,
    repoPath: `${PROJECT_ROOT}/${repoKey}`,
    branch: GEN_NAME,
    baseSha: `${repoKey}-base`,
    worktreePath: `${PROJECT_ROOT}/workspaces/uat-min-otter-0727/${repoKey}`,
    mergeOrder,
    promotedAt: null,
    ...overrides,
  };
}

function generation(repos: UatGenerationRepo[], overrides: Partial<UatGeneration> = {}): UatGeneration {
  return {
    name: GEN_NAME,
    worktreePath: `${PROJECT_ROOT}/workspaces/uat-min-otter-0727`,
    projectRoot: PROJECT_ROOT,
    baseSha: repos.map((r) => `${r.repoKey}@${r.baseSha}`).join(' '),
    status: 'ready',
    repos,
    members: [
      { issueId: 'MIN-901', title: 'One', branch: 'feature/min-901', headSha: 'fe@a api@b', mergeOrder: 1 },
      { issueId: 'MIN-902', title: 'Two', branch: 'feature/min-902', headSha: 'api@c', mergeOrder: 2 },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    cleanedAt: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

interface FakeRepoGit extends PolyrepoRepoPromoteGit {
  published: string[];
  trials: string[];
  discards: string[];
}

interface FakeRepoOptions {
  /** Target head; defaults to the recorded base (no movement). */
  targetHead?: string;
  targetChanged?: string[];
  batchChanged?: string[];
  failTrialMerge?: boolean;
  failPublish?: boolean;
  failTargetHead?: boolean;
  /** Merge commit this repo's uat branch is already contained in, if any. */
  alreadyLanded?: string;
}

function makeRepoGit(repoKey: string, options: FakeRepoOptions = {}): FakeRepoGit {
  const published: string[] = [];
  const trials: string[] = [];
  const discards: string[] = [];

  return {
    published,
    trials,
    discards,
    targetHeadSha: async () => {
      if (options.failTargetHead) throw new Error(`fetch boom in ${repoKey}`);
      return options.targetHead ?? `${repoKey}-base`;
    },
    changedFilesSince: async () => options.targetChanged ?? [],
    batchChangedFiles: async () => options.batchChanged ?? [],
    trialMerge: async (branchName) => {
      if (options.failTrialMerge) throw new Error(`conflict in ${repoKey}`);
      trials.push(branchName);
      return { repoKey, handle: `/tmp/wt-${repoKey}`, mergeSha: `${repoKey}-merge-sha` };
    },
    publishPrepared: async (prepared: PreparedRepoMerge) => {
      if (options.failPublish) throw new Error(`push rejected in ${repoKey}`);
      published.push(prepared.mergeSha);
    },
    discardPrepared: async (prepared: PreparedRepoMerge) => { discards.push(prepared.handle); },
    findLandedMerge: async () => options.alreadyLanded ?? null,
  };
}

function makeDeps(
  gen: UatGeneration,
  repoGit: Map<string, PolyrepoRepoPromoteGit>,
  overrides: Partial<UatPromoteDeps> = {},
): UatPromoteDeps & { firePostMerge: ReturnType<typeof vi.fn>; promoted: Array<[string, string, string?]>; statuses: string[] } {
  const promoted: Array<[string, string, string?]> = [];
  const statuses: string[] = [];
  const firePostMerge = vi.fn(() => true);

  return {
    promoted,
    statuses,
    firePostMerge,
    // Never used on the polyrepo path; a call would mean the wrong branch ran.
    git: {
      fetchMain: async () => { throw new Error('monorepo git must not be used for a polyrepo generation'); },
      mergeIntoMain: async () => { throw new Error('monorepo git must not be used for a polyrepo generation'); },
      changedFilesSince: async () => { throw new Error('monorepo git must not be used'); },
      batchChangedFiles: async () => { throw new Error('monorepo git must not be used'); },
    },
    polyrepoGit: repoGit,
    markRepoPromoted: (_name, repoKey, at, mergeSha) => { promoted.push([repoKey, at, mergeSha]); },
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    store: {
      get: () => gen,
      insert: () => {},
      update: (_name, patch) => { if (patch.status) statuses.push(patch.status); },
      listNames: () => [gen.name],
      listChain: () => [],
    },
    teardownStack: async () => {},
    memberEligibility: () => ({ eligible: true }),
    ...overrides,
  } as UatPromoteDeps & { firePostMerge: ReturnType<typeof vi.fn>; promoted: Array<[string, string, string?]>; statuses: string[] };
}

describe('polyrepo promote — phase A is all-or-nothing', () => {
  it('publishes nothing when repo 2 of 3 fails its trial merge', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1), repoRow('infra', 2)]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { failTrialMerge: true });
    const infra = makeRepoGit('infra');
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api], ['infra', infra]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ reason: 'merge-failed' });
    expect((result as { message: string }).message).toContain('trial merge failed in api');
    expect((result as { message: string }).message).toContain('Nothing was published');

    // Not one repo published, including the one that trial-merged first.
    expect(fe.published).toEqual([]);
    expect(api.published).toEqual([]);
    expect(infra.published).toEqual([]);
    // repo 3 is never even attempted once repo 2 fails.
    expect(infra.trials).toEqual([]);
    // The generation stays promotable.
    expect(deps.statuses).not.toContain('promoted');
  });

  it('discards every prepared worktree when a later repo fails', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { failTrialMerge: true });
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(fe.discards).toEqual(['/tmp/wt-fe']);
  });

  it('rejects on a stale base in one repo before anything is prepared or pushed', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', {
      targetHead: 'api-moved',
      targetChanged: ['src/shared.ts'],
      batchChanged: ['src/shared.ts'],
    });
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result).toMatchObject({ success: false, reason: 'stale-base' });
    expect((result as { message: string }).message).toContain('api@api-base');
    expect(fe.published).toEqual([]);
    expect(api.published).toEqual([]);
  });

  it('proceeds when a repo base moved without touching batch files', async () => {
    const gen = generation([repoRow('api', 0)]);
    const api = makeRepoGit('api', {
      targetHead: 'api-moved',
      targetChanged: ['docs/unrelated.md'],
      batchChanged: ['src/a.ts'],
    });
    const deps = makeDeps(gen, new Map([['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(true);
    expect(api.published).toEqual(['api-merge-sha']);
  });

  it('fails without publishing when a repo target head cannot be read', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { failTargetHead: true });
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result).toMatchObject({ success: false, reason: 'merge-failed' });
    expect(fe.published).toEqual([]);
  });
});

describe('polyrepo promote — phase B publishes and resumes', () => {
  it('publishes every repo in merge order and stamps each one', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(true);
    expect(fe.published).toEqual(['fe-merge-sha']);
    expect(api.published).toEqual(['api-merge-sha']);
    expect(deps.promoted).toEqual([
      ['fe', '2026-07-27T12:00:00.000Z', 'fe-merge-sha'],
      ['api', '2026-07-27T12:00:00.000Z', 'api-merge-sha'],
    ]);
    expect(deps.statuses).toContain('promoted');
    expect((result as { mergeSha: string }).mergeSha).toBe('fe@fe-merg api@api-mer');
  });

  it('names landed and pending repos when a publish fails partway', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api', { failPublish: true });
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result).toMatchObject({ success: false, reason: 'merge-failed' });
    const message = (result as { message: string }).message;
    expect(message).toContain('published fe');
    expect(message).toContain('failed on api');
    expect(message).toContain('Still pending: api');
    expect(message).toContain('never rewound');

    // fe genuinely landed and is stamped, so the retry can skip it.
    expect(fe.published).toEqual(['fe-merge-sha']);
    expect(deps.promoted).toEqual([['fe', '2026-07-27T12:00:00.000Z', 'fe-merge-sha']]);
    // Not marked promoted — the operator can retry.
    expect(deps.statuses).not.toContain('promoted');
  });

  it('skips an already-landed repo on retry and publishes only the pending one', async () => {
    // State after the previous test's partial publish: fe carries both the
    // promote stamp and the merge it landed, which is what publishing writes.
    const gen = generation([
      repoRow('fe', 0, { promotedAt: '2026-07-27T12:00:00.000Z', mergeSha: 'fe-merge-sha' }),
      repoRow('api', 1),
    ]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(true);
    // fe is skipped entirely — not re-trial-merged, not re-published.
    expect(fe.trials).toEqual([]);
    expect(fe.published).toEqual([]);
    expect(api.published).toEqual(['api-merge-sha']);
    expect(deps.promoted).toEqual([['api', '2026-07-27T12:00:00.000Z', 'api-merge-sha']]);
  });

  it('finalizes a generation whose repos all already published', async () => {
    // The crash window: every repo landed and is stamped, but the process died
    // before finalization. Retry is the documented recovery, so this must
    // complete rather than error — otherwise the batch is on every remote yet
    // never promoted, never verified, and never handed to post-merge.
    const gen = generation([
      repoRow('fe', 0, { promotedAt: '2026-07-27T12:00:00.000Z', mergeSha: 'fe-merge-sha' }),
      repoRow('api', 1, { promotedAt: '2026-07-27T12:00:00.000Z', mergeSha: 'api-merge-sha' }),
    ]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(true);
    // Nothing is re-merged or re-pushed.
    expect(fe.trials).toEqual([]);
    expect(api.published).toEqual([]);
    // The composite ref is rebuilt from the STORED shas, not an in-memory list.
    expect((result as { mergeSha: string }).mergeSha).toBe('fe@fe-merg api@api-mer');
    expect(deps.statuses).toContain('promoted');
    expect(deps.firePostMerge).toHaveBeenCalledTimes(2);
  });
});

describe('polyrepo promote — per-repo merge evidence', () => {
  it('stamps each repo with the merge sha it published', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const stamped: Array<[string, string | undefined]> = [];
    const deps = makeDeps(gen, new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api')]]), {
      markRepoPromoted: (_n, repoKey, _at, mergeSha) => { stamped.push([repoKey, mergeSha]); },
    });

    await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(stamped).toEqual([['fe', 'fe-merge-sha'], ['api', 'api-merge-sha']]);
  });

  it('hands post-merge the per-repo merge commits, not the composite anchor', async () => {
    // A member's headSha is `fe@a api@b` — not a git ref — and the wrapper
    // project path is not a git repo, so passing it as verifiedMergedRef would
    // guarantee the lifecycle refuses.
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const deps = makeDeps(gen, new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api')]]));

    await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    const options = deps.firePostMerge.mock.calls[0]![1] as {
      verifiedMergedRef?: string;
      verifiedMergedRepos?: Array<{ repoKey: string; mergeSha: string; targetBranch: string; repoPath: string }>;
    };
    expect(options.verifiedMergedRef).toBeUndefined();
    expect(options.verifiedMergedRepos).toEqual([
      { repoKey: 'fe', repoPath: `${PROJECT_ROOT}/fe`, mergeSha: 'fe-merge-sha', targetBranch: 'main' },
      { repoKey: 'api', repoPath: `${PROJECT_ROOT}/api`, mergeSha: 'api-merge-sha', targetBranch: 'main' },
    ]);
  });

  it('carries each repo\'s own target branch through to post-merge evidence', async () => {
    const gen = generation([
      repoRow('fe', 0),
      repoRow('api', 1, { targetBranch: 'develop' }),
    ]);
    const deps = makeDeps(gen, new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api')]]));

    await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    const options = deps.firePostMerge.mock.calls[0]![1] as {
      verifiedMergedRepos?: Array<{ repoKey: string; targetBranch: string }>;
    };
    expect(options.verifiedMergedRepos!.find((r) => r.repoKey === 'api')!.targetBranch).toBe('develop');
  });
});

describe('polyrepo promote — post-merge handoff', () => {
  it('fires each member post-merge exactly once, only after every repo published', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const deps = makeDeps(gen, new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api')]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(deps.firePostMerge).toHaveBeenCalledTimes(2);
    expect(deps.firePostMerge.mock.calls.map((c) => c[0])).toEqual(['MIN-901', 'MIN-902']);
    expect((result as { postMergeStarted: string[] }).postMergeStarted).toEqual(['MIN-901', 'MIN-902']);
  });

  it('fires no post-merge when phase B failed partway', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const deps = makeDeps(
      gen,
      new Map([['fe', makeRepoGit('fe')], ['api', makeRepoGit('api', { failPublish: true })]]),
    );

    await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(deps.firePostMerge).not.toHaveBeenCalled();
  });

  it('fires no post-merge when a member is not merge-eligible', async () => {
    const gen = generation([repoRow('fe', 0)]);
    const fe = makeRepoGit('fe');
    const deps = makeDeps(gen, new Map([['fe', fe]]), {
      memberEligibility: (issueId: string) =>
        issueId === 'MIN-902' ? { eligible: false, reason: 'review pending' } : { eligible: true },
    });

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result).toMatchObject({ success: false, reason: 'member-not-ready' });
    expect(fe.published).toEqual([]);
    expect(deps.firePostMerge).not.toHaveBeenCalled();
  });
});

// The publish and the local stamp are two writes to two systems. Everything
// between them is a window where the remote has the merge and SQLite does not.
describe('polyrepo promote — recovering an unstamped but landed repo', () => {
  it('recovers a repo whose push landed but was never stamped, instead of rejecting as stale', async () => {
    // fe landed for real; its target has therefore moved over the batch's own
    // files, which is exactly what the stale-base check would otherwise reject.
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe', {
      alreadyLanded: 'fe-recovered-sha',
      targetHead: 'fe-moved',
      targetChanged: ['src/shared.ts'],
      batchChanged: ['src/shared.ts'],
    });
    const api = makeRepoGit('api');
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(true);
    // fe is neither re-trial-merged nor re-published.
    expect(fe.trials).toEqual([]);
    expect(fe.published).toEqual([]);
    expect(api.published).toEqual(['api-merge-sha']);
    // and it is stamped with the recovered merge commit.
    expect(deps.promoted).toContainEqual(['fe', '2026-07-27T12:00:00.000Z', 'fe-recovered-sha']);
  });

  it('finalizes when every repo turns out to have landed unstamped', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe', { alreadyLanded: 'fe-recovered' });
    const api = makeRepoGit('api', { alreadyLanded: 'api-recovered' });
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(true);
    expect(fe.published).toEqual([]);
    expect(api.published).toEqual([]);
    expect(deps.statuses).toContain('promoted');
    expect((result as { mergeSha: string }).mergeSha).toBe('fe@fe-reco api@api-rec');
  });

  it('stays promotable instead of finalizing when the stamp write throws', async () => {
    const gen = generation([repoRow('fe', 0)]);
    const fe = makeRepoGit('fe');
    const deps = makeDeps(gen, new Map([['fe', fe]]), {
      markRepoPromoted: () => { throw new Error('sqlite is gone'); },
    });

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    // The push happened and is never rolled back...
    expect(fe.published).toEqual(['fe-merge-sha']);
    // ...but the canonical row still says pending, so finalizing here would
    // mark the batch terminal on state that does not exist and fire post-merge
    // — and end the promotable life the documented retry depends on.
    expect(result).toMatchObject({ success: false, reason: 'merge-failed' });
    const message = (result as { message: string }).message;
    expect(message).toContain('LIVE on their target but could not be recorded');
    expect(message).toContain('stays promotable');
    expect(deps.statuses).not.toContain('promoted');
    expect(deps.firePostMerge).not.toHaveBeenCalled();
  });

  it('fails closed when it cannot establish whether a repo already landed', async () => {
    const gen = generation([repoRow('fe', 0), repoRow('api', 1)]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');
    // An unreachable remote makes "already landed?" unanswerable; treating that
    // as "pending" could republish a merge that is already live.
    api.findLandedMerge = async () => { throw new Error('fetch origin main failed'); };
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result).toMatchObject({ success: false, reason: 'merge-failed' });
    expect((result as { message: string }).message).toContain('could not establish whether api has already landed');
    expect(fe.published).toEqual([]);
    expect(api.published).toEqual([]);
  });

  it('recovers the merge sha for a row stamped before merge_sha capture existed', async () => {
    // The stamp is real and the merge IS on the target — findLandedMerge can
    // still name it, so the row is repaired rather than refused.
    const gen = generation([
      repoRow('fe', 0, { promotedAt: '2026-07-27T09:00:00.000Z', mergeSha: null }),
      repoRow('api', 1, { promotedAt: '2026-07-27T09:00:00.000Z', mergeSha: 'api-merge-sha' }),
    ]);
    const fe = makeRepoGit('fe', { alreadyLanded: 'fe-recovered' });
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', makeRepoGit('api')]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result.success).toBe(true);
    // The original stamp time is kept — only the missing evidence is filled in.
    expect(deps.promoted).toContainEqual(['fe', '2026-07-27T09:00:00.000Z', 'fe-recovered']);
    const options = deps.firePostMerge.mock.calls[0]![1] as {
      verifiedMergedRepos?: Array<{ repoKey: string; mergeSha: string }>;
    };
    expect(options.verifiedMergedRepos).toEqual([
      expect.objectContaining({ repoKey: 'fe', mergeSha: 'fe-recovered' }),
      expect.objectContaining({ repoKey: 'api', mergeSha: 'api-merge-sha' }),
    ]);
  });

  it('stays retryable instead of finalizing when a stamped row has no provable merge', async () => {
    // Same shape as above, except the probe comes back empty: the row claims a
    // promote it cannot back up. Finalizing would mark the batch promoted while
    // permanently unable to produce fe's merge evidence — post-merge would
    // refuse every member forever and `promoted` would block the retry that is
    // the only route to the missing sha.
    const gen = generation([
      repoRow('fe', 0, { promotedAt: '2026-07-27T09:00:00.000Z', mergeSha: null }),
      repoRow('api', 1, { promotedAt: '2026-07-27T09:00:00.000Z', mergeSha: 'api-merge-sha' }),
    ]);
    const fe = makeRepoGit('fe');
    const api = makeRepoGit('api');
    const deps = makeDeps(gen, new Map([['fe', fe], ['api', api]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result).toMatchObject({ success: false, reason: 'merge-failed' });
    const message = (result as { message: string }).message;
    expect(message).toContain('recorded as promoted but their merge cannot be proven');
    expect(message).toContain('fe');
    expect(message).toContain('stays promotable');
    // Not terminal, no lifecycle fired, and nothing published on the way out.
    expect(deps.statuses).not.toContain('promoted');
    expect(deps.firePostMerge).not.toHaveBeenCalled();
    expect(fe.published).toEqual([]);
    expect(api.published).toEqual([]);
  });

  it('refuses to finalize a stamped row whose repo has no promote git deps', async () => {
    // A stamp with no deps to check it against is unprovable for the same
    // reason, and `promotedAt` alone would keep it out of the pending set.
    const gen = generation([
      repoRow('fe', 0, { promotedAt: '2026-07-27T09:00:00.000Z', mergeSha: null }),
      repoRow('api', 1, { promotedAt: '2026-07-27T09:00:00.000Z', mergeSha: 'api-merge-sha' }),
    ]);
    const deps = makeDeps(gen, new Map([['api', makeRepoGit('api')]]));

    const result = await promoteUatGeneration(GEN_NAME, PROJECT_ROOT, deps);

    expect(result).toMatchObject({ success: false, reason: 'merge-failed' });
    expect((result as { message: string }).message).toContain('no promote git deps');
    expect(deps.statuses).not.toContain('promoted');
    expect(deps.firePostMerge).not.toHaveBeenCalled();
  });
});
