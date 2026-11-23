/**
 * The ready set for GitHub, GitLab and polyrepo projects (PAN-4753 WI-4,
 * PAN-3657). Forge listings and per-MR facts are fixtures; nothing here runs
 * `gh` or `glab`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrFacts } from '../../cloister/pr-facts.js';
import type { ProjectConfig } from '../../projects.js';
import { fetchRepoMergeRequests, type GlabMrRow } from '../derived-issue-state.js';
import type { GhPrRow } from '../pr-listing.js';
import {
  _resetReadySetCacheForTests,
  listReadyIssuesForProject,
  memberReposForProject,
  mergedIssueIdsForProject,
  ReadySetUnavailableError,
  type ReadySetDeps,
  type ReadySetRepo,
} from '../ready-set.js';

/** An open, approved, green, mergeable GitHub row. */
function ghRow(branch: string, number: number, overrides: Partial<GhPrRow> = {}): GhPrRow {
  return {
    number, url: `https://github.com/eltmon/x/pull/${number}`, state: 'OPEN', title: `PR ${number}`,
    headRefName: branch, headRefOid: `sha-${number}`, isDraft: false, mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED', mergedAt: null,
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...overrides,
  };
}

/**
 * A GitLab list row as `projects/:id/merge_requests` returns it: no `approved`
 * and no `head_pipeline` (the list endpoint omits both).
 */
function mr(branch: string, iid: number, overrides: Partial<GlabMrRow> = {}): GlabMrRow {
  return {
    iid, web_url: `https://gitlab.com/eltmon/mind-your-now-api/-/merge_requests/${iid}`, state: 'opened',
    source_branch: branch, draft: false, has_conflicts: false, detailed_merge_status: 'mergeable',
    sha: `mrsha-${iid}`, title: `MR ${iid}`, merged_at: null, ...overrides,
  };
}

/** The facts `readGitLabMrFacts` returns for an approved, green, mergeable MR. */
function mrFacts(issueId: string, overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId, forge: 'gitlab', url: null, number: 1, exists: true, open: true, merged: false, closed: false,
    draft: false, headSha: null, headBranch: null, reviewDecision: 'APPROVED', approved: true,
    changesRequested: false, mergeable: true, mergeableState: 'mergeable', checks: 'green', testChecks: 'none',
    ...overrides,
  };
}

/** The facts `readGitHubMemberReadyFacts` returns for a GitHub member PR. */
function ghFacts(issueId: string, overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId, forge: 'github', url: null, number: null, exists: true, open: true, merged: false, closed: false,
    draft: false, headSha: null, headBranch: null, reviewDecision: null, approved: false,
    changesRequested: false, mergeable: true, mergeableState: 'mergeable', checks: 'green', testChecks: 'none',
    ...overrides,
  };
}

const GITLAB_MONO = { name: 'gl', path: '/repos/gl', gitlab_repo: 'eltmon/gl' } as ProjectConfig;
const POLY = { name: 'myn', path: '/repos/myn', workspace: { type: 'polyrepo' } } as ProjectConfig;
const POLY_REPOS: ReadySetRepo[] = [
  { repoKey: 'fe', repoPath: '/repos/myn/frontend', forge: 'gitlab', branchPrefix: 'feature/' },
  { repoKey: 'api', repoPath: '/repos/myn/api', forge: 'gitlab', branchPrefix: 'feature/' },
  { repoKey: 'skills', repoPath: '/repos/myn/myn-skills', forge: 'github', branchPrefix: 'feature/' },
];

function gitlabMono(rows: GlabMrRow[], facts: ReadySetDeps['gitlabMrFacts']): ReadySetDeps {
  return {
    projectConfig: () => GITLAB_MONO,
    forgeOf: () => 'gitlab',
    readMergeRequests: async () => rows,
    ...(facts ? { gitlabMrFacts: facts } : {}),
  };
}

/** A not-approved GitHub member facts stub, so a test that does not care about
 * the GitHub member's own facts never reaches the real `gh`. */
async function notApprovedGithubFacts(issueId: string, row: GhPrRow): Promise<PrFacts> {
  return ghFacts(issueId, {
    url: row.url ?? null, number: row.number ?? null, headSha: row.headRefOid ?? null, headBranch: row.headRefName ?? null,
    approved: false,
  });
}

function poly(
  mrs: Record<string, GlabMrRow[] | null>,
  prs: Record<string, GhPrRow[] | null>,
  facts: ReadySetDeps['gitlabMrFacts'],
  githubFacts?: ReadySetDeps['githubPrFacts'],
): ReadySetDeps {
  return {
    projectConfig: () => POLY,
    forgeOf: () => 'gitlab',
    memberRepos: () => POLY_REPOS,
    readMergeRequests: async (repoPath) => (repoPath in mrs ? mrs[repoPath]! : []),
    readOpenPullRequests: async (repoPath) => (repoPath in prs ? prs[repoPath]! : []),
    readAllPullRequests: async (repoPath) => (repoPath in prs ? prs[repoPath]! : []),
    ...(facts ? { gitlabMrFacts: facts } : {}),
    githubPrFacts: githubFacts ?? notApprovedGithubFacts,
  };
}

beforeEach(() => {
  _resetReadySetCacheForTests();
});

describe('listReadyIssuesForProject — GitHub monorepo (unchanged)', () => {
  it('keeps approved, green, mergeable feature PRs and drops the rest', async () => {
    const githubPrFacts = vi.fn();
    const ready = await listReadyIssuesForProject('/repos/gh', {
      projectConfig: () => null,
      forgeOf: () => 'github',
      listPullRequests: async () => [
        ghRow('feature/pan-1', 1),
        ghRow('feature/pan-2', 2, { reviewDecision: 'REVIEW_REQUIRED' }),
        ghRow('feature/pan-3', 3, { isDraft: true }),
        ghRow('feature/pan-4', 4, { mergeable: 'CONFLICTING' }),
        ghRow('strike/pan-5', 5),
      ],
      githubPrFacts,
    });
    expect(ready).toEqual([{ issueId: 'PAN-1', title: 'PR 1', pr: 1 }]);
    expect(githubPrFacts).not.toHaveBeenCalled();
  });
});

describe('listReadyIssuesForProject — GitLab monorepo', () => {
  it('is ready when the MR facts say approved, green and mergeable', async () => {
    const facts = vi.fn(async (issueId: string) => mrFacts(issueId));
    const ready = await listReadyIssuesForProject('/repos/gl', gitlabMono([mr('feature/min-1', 11)], facts));
    expect(ready).toEqual([{ issueId: 'MIN-1', title: 'MR 11', pr: 11 }]);
    expect(facts).toHaveBeenCalledWith('MIN-1', expect.objectContaining({ iid: 11 }));
  });

  it('is not ready without a named approver, a green pipeline, or mergeability', async () => {
    const byIssue: Record<string, Partial<PrFacts>> = {
      'MIN-1': { approved: false },
      'MIN-2': { checks: 'pending' },
      'MIN-3': { mergeable: null },
    };
    const ready = await listReadyIssuesForProject('/repos/gl', gitlabMono(
      [mr('feature/min-1', 1), mr('feature/min-2', 2), mr('feature/min-3', 3)],
      async (issueId) => mrFacts(issueId, byIssue[issueId]),
    ));
    expect(ready).toEqual([]);
  });

  it('rules out draft, conflicting and merged MRs from the listing without a facts read', async () => {
    const facts = vi.fn(async (issueId: string) => mrFacts(issueId));
    const ready = await listReadyIssuesForProject('/repos/gl', gitlabMono([
      mr('feature/min-1', 1, { draft: true }),
      mr('feature/min-2', 2, { has_conflicts: true }),
      mr('feature/min-3', 3, { state: 'merged', merged_at: '2026-11-14T10:00:00Z' }),
      mr('main', 4),
    ], facts));
    expect(ready).toEqual([]);
    expect(facts).not.toHaveBeenCalled();
  });

  it('throws, never answers "not ready", when the listing or an MR read fails', async () => {
    await expect(listReadyIssuesForProject('/repos/gl', {
      projectConfig: () => GITLAB_MONO, forgeOf: () => 'gitlab', readMergeRequests: async () => null,
    })).rejects.toBeInstanceOf(ReadySetUnavailableError);
    await expect(listReadyIssuesForProject('/repos/gl', gitlabMono(
      [mr('feature/min-1', 1)],
      async (issueId) => mrFacts(issueId, { approved: false, error: 'GitLab MR approvals read failed for !1: 502' }),
    ))).rejects.toThrow(/approvals read failed/);
  });
});

describe('listReadyIssuesForProject — the per-MR facts cache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads an MR head once per minute, again after a push, and never keeps a failed read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
    let fail = false;
    const facts = vi.fn(async (issueId: string) => (fail ? mrFacts(issueId, { error: 'view failed' }) : mrFacts(issueId)));
    let rows = [mr('feature/min-1', 1)];
    const deps: ReadySetDeps = { ...gitlabMono([], facts), readMergeRequests: async () => rows };

    await listReadyIssuesForProject('/repos/gl', deps);
    await listReadyIssuesForProject('/repos/gl', deps);
    expect(facts).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await listReadyIssuesForProject('/repos/gl', deps);
    expect(facts).toHaveBeenCalledTimes(2);

    rows = [mr('feature/min-1', 1, { sha: 'pushed' })];
    await listReadyIssuesForProject('/repos/gl', deps);
    expect(facts).toHaveBeenCalledTimes(3);

    rows = [mr('feature/min-1', 1, { sha: 'pushed-again' })];
    fail = true;
    await expect(listReadyIssuesForProject('/repos/gl', deps)).rejects.toBeInstanceOf(ReadySetUnavailableError);
    fail = false;
    await expect(listReadyIssuesForProject('/repos/gl', deps)).resolves.toHaveLength(1);
    expect(facts).toHaveBeenCalledTimes(5);
  });
});

describe('listReadyIssuesForProject — polyrepo', () => {
  it('is ready only when every member repo PR/MR for the issue is ready', async () => {
    const ready = await listReadyIssuesForProject('/repos/myn', poly(
      {
        '/repos/myn/frontend': [mr('feature/min-1', 1), mr('feature/min-2', 2)],
        '/repos/myn/api': [mr('feature/min-1', 7), mr('feature/min-2', 8)],
      },
      { '/repos/myn/myn-skills': [ghRow('feature/min-2', 30, { reviewDecision: null })] },
      async (issueId) => mrFacts(issueId),
    ));
    // MIN-2's GitHub member PR has no approval, so MIN-2 is not ready.
    expect(ready).toEqual([{ issueId: 'MIN-1', title: 'MR 1', pr: 1 }]);
  });

  it("one repo's draft MR makes the issue not ready", async () => {
    const ready = await listReadyIssuesForProject('/repos/myn', poly(
      {
        '/repos/myn/frontend': [mr('feature/min-1', 1)],
        '/repos/myn/api': [mr('feature/min-1', 7, { draft: true })],
      },
      {},
      async (issueId) => mrFacts(issueId),
    ));
    expect(ready).toEqual([]);
  });

  it('a member repo whose listing fails makes the whole set unavailable', async () => {
    await expect(listReadyIssuesForProject('/repos/myn', poly(
      { '/repos/myn/frontend': [mr('feature/min-1', 1)], '/repos/myn/api': null },
      {},
      async (issueId) => mrFacts(issueId),
    ))).rejects.toBeInstanceOf(ReadySetUnavailableError);
  });

  it('memberReposForProject keeps writable repos with their own forge and branch prefix', () => {
    const config = {
      name: 'myn', path: '/repos/myn', gitlab_repo: 'eltmon/mind-your-now',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'fe', path: 'frontend', branch_prefix: 'feature/' },
          { name: 'skills', path: 'myn-skills', branch_prefix: 'feat/', remote: 'github' },
          { name: 'vendor', path: 'vendor', readonly: true },
        ],
      },
    } as unknown as ProjectConfig;
    expect(memberReposForProject('/repos/myn', config)).toEqual([
      { repoKey: 'fe', repoPath: '/repos/myn/frontend', forge: 'gitlab', branchPrefix: 'feature/' },
      { repoKey: 'skills', repoPath: '/repos/myn/myn-skills', forge: 'github', branchPrefix: 'feat/' },
    ]);
  });
});

describe('listReadyIssuesForProject — polyrepo GitHub members (PAN-5638)', () => {
  it("is ready when the member PR's own facts show a marker approval", async () => {
    const row = ghRow('feature/min-1', 30, { reviewDecision: null });
    const facts = vi.fn(async (issueId: string, r: GhPrRow) => ghFacts(issueId, { headSha: r.headRefOid ?? null, approved: true }));
    const ready = await listReadyIssuesForProject('/repos/myn', poly({}, { '/repos/myn/myn-skills': [row] }, undefined, facts));
    expect(ready).toEqual([{ issueId: 'MIN-1', title: 'PR 30', pr: 30 }]);
    expect(facts).toHaveBeenCalledTimes(1);
    expect(facts).toHaveBeenCalledWith('MIN-1', row);
  });

  it('is not ready when the member PR facts show no approval, or a newer head', async () => {
    const notApproved = await listReadyIssuesForProject('/repos/myn', poly(
      {}, { '/repos/myn/myn-skills': [ghRow('feature/min-1', 30, { reviewDecision: null })] }, undefined,
      async (issueId, r) => ghFacts(issueId, { headSha: r.headRefOid ?? null, approved: false }),
    ));
    expect(notApproved).toEqual([]);

    const staleHead = await listReadyIssuesForProject('/repos/myn', poly(
      {}, { '/repos/myn/myn-skills': [ghRow('feature/min-2', 31, { reviewDecision: null })] }, undefined,
      async (issueId) => ghFacts(issueId, { headSha: 'other', approved: true }),
    ));
    expect(staleHead).toEqual([]);
  });

  it('rules a row in or out from the listing without a facts read', async () => {
    const facts = vi.fn();
    const ready = await listReadyIssuesForProject('/repos/myn', poly({}, {
      '/repos/myn/myn-skills': [
        ghRow('feature/min-1', 1, { reviewDecision: 'APPROVED' }),
        ghRow('feature/min-2', 2, { isDraft: true }),
        ghRow('feature/min-3', 3, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }),
        ghRow('feature/min-4', 4, { mergeable: 'CONFLICTING' }),
        ghRow('feature/min-5', 5, { reviewDecision: 'CHANGES_REQUESTED' }),
      ],
    }, undefined, facts));
    expect(ready).toEqual([{ issueId: 'MIN-1', title: 'PR 1', pr: 1 }]);
    expect(facts).not.toHaveBeenCalled();
  });

  it('throws, never answers "not ready", when a member PR read fails', async () => {
    await expect(listReadyIssuesForProject('/repos/myn', poly(
      {}, { '/repos/myn/myn-skills': [ghRow('feature/min-1', 30, { reviewDecision: null })] }, undefined,
      async (issueId) => ghFacts(issueId, { error: 'gh pr view failed' }),
    ))).rejects.toBeInstanceOf(ReadySetUnavailableError);
  });
});

describe('listReadyIssuesForProject — the per-member-PR-head facts cache (GitHub, PAN-5638)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a member PR head once per minute, again after a push, and never keeps a failed read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
    let fail = false;
    const facts = vi.fn(async (issueId: string, row: GhPrRow) => (fail
      ? ghFacts(issueId, { error: 'view failed' })
      : ghFacts(issueId, { headSha: row.headRefOid ?? null, approved: true })));
    let rows = [ghRow('feature/min-1', 30, { reviewDecision: null })];
    const deps: ReadySetDeps = {
      projectConfig: () => POLY,
      forgeOf: () => 'gitlab',
      memberRepos: () => POLY_REPOS,
      readMergeRequests: async () => [],
      readOpenPullRequests: async (repoPath) => (repoPath === '/repos/myn/myn-skills' ? rows : []),
      githubPrFacts: facts,
    };

    await listReadyIssuesForProject('/repos/myn', deps);
    await listReadyIssuesForProject('/repos/myn', deps);
    expect(facts).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await listReadyIssuesForProject('/repos/myn', deps);
    expect(facts).toHaveBeenCalledTimes(2);

    rows = [ghRow('feature/min-1', 30, { reviewDecision: null, headRefOid: 'pushed' })];
    await listReadyIssuesForProject('/repos/myn', deps);
    expect(facts).toHaveBeenCalledTimes(3);

    rows = [ghRow('feature/min-1', 30, { reviewDecision: null, headRefOid: 'pushed-again' })];
    fail = true;
    await expect(listReadyIssuesForProject('/repos/myn', deps)).rejects.toBeInstanceOf(ReadySetUnavailableError);
    fail = false;
    await expect(listReadyIssuesForProject('/repos/myn', deps)).resolves.toHaveLength(1);
    expect(facts).toHaveBeenCalledTimes(5);
  });
});

describe('mergedIssueIdsForProject', () => {
  it('GitHub monorepo: merged feature PRs only', async () => {
    const ids = await mergedIssueIdsForProject('/repos/gh', {
      projectConfig: () => null,
      forgeOf: () => 'github',
      readAllPullRequests: async () => [
        ghRow('feature/pan-1', 1, { state: 'MERGED', mergedAt: '2026-11-14T10:00:00Z' }),
        ghRow('feature/pan-2', 2),
        ghRow('strike/pan-3', 3, { state: 'MERGED', mergedAt: '2026-11-14T10:00:00Z' }),
        ghRow('main', 4, { state: 'MERGED', mergedAt: '2026-11-14T10:00:00Z' }),
      ],
    });
    expect([...ids]).toEqual(['PAN-1']);
  });

  it('polyrepo: a merged MR or PR in any member repo', async () => {
    const ids = await mergedIssueIdsForProject('/repos/myn', poly(
      {
        '/repos/myn/frontend': [mr('feature/min-1', 1, { state: 'merged', merged_at: '2026-11-14T10:00:00Z' })],
        '/repos/myn/api': [mr('feature/min-2', 2)],
      },
      { '/repos/myn/myn-skills': [ghRow('feature/min-3', 3, { state: 'MERGED', mergedAt: '2026-11-14T10:00:00Z' })] },
      undefined,
    ));
    expect([...ids].sort()).toEqual(['MIN-1', 'MIN-3']);
  });

  it('throws when a listing cannot be read', async () => {
    await expect(mergedIssueIdsForProject('/repos/gl', {
      projectConfig: () => GITLAB_MONO, forgeOf: () => 'gitlab', readMergeRequests: async () => null,
    })).rejects.toBeInstanceOf(ReadySetUnavailableError);
  });
});

describe('fetchRepoMergeRequests (the GitLab listing)', () => {
  const page = (n: number, start: number) => Array.from({ length: n }, (_, i) => mr(`feature/min-${start + i}`, start + i));

  it('reads every open page, then the newest merged page', async () => {
    const queries: string[] = [];
    const rows = await fetchRepoMergeRequests(async (query) => {
      queries.push(query);
      if (query.startsWith('state=opened') && query.endsWith('page=1')) return page(100, 1);
      if (query.startsWith('state=opened') && query.endsWith('page=2')) return page(3, 101);
      return [mr('feature/min-900', 900, { state: 'merged', merged_at: '2026-11-14T10:00:00Z' })];
    });
    expect(queries).toEqual([
      'state=opened&per_page=100&page=1',
      'state=opened&per_page=100&page=2',
      'state=merged&order_by=updated_at&per_page=100',
    ]);
    expect(rows).toHaveLength(104);
  });

  it('fails the whole listing when any page fails', async () => {
    await expect(fetchRepoMergeRequests(async (query) => {
      if (query.includes('page=2')) throw new Error('502');
      return page(100, 1);
    })).rejects.toThrow('502');
  });
});
