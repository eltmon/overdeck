/**
 * PAN-4597: `listOpenPullRequestsForProject` is the approval refresher's
 * forge read — the project's open, non-draft PRs/MRs by issue, from the same
 * cached listings the board derives from (GitHub via `gh`, GitLab via `glab`,
 * never both for one project).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../projects.js';

const mocks = vi.hoisted(() => ({
  runGh: vi.fn(),
  findProjectByPath: vi.fn<(projectPath: string) => ProjectConfig | null>(),
  execFileAsync: vi.fn(),
}));

vi.mock('../../github-quota/run-gh.js', () => ({
  runGh: mocks.runGh,
}));

vi.mock('../../projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects.js')>();
  return { ...actual, findProjectByPath: mocks.findProjectByPath };
});

// Both the `git remote` check (pr-cache-policy.js, the gh path's gate) and the
// `glab api` call (the gitlab path) go through `promisify(execFile)` from
// 'node:child_process'; one mock answers both by inspecting the file argument.
vi.mock('node:child_process', () => {
  function execFile(): void {
    throw new Error('execFile callback form is not used in open-pr-listing tests');
  }
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = mocks.execFileAsync;
  return { execFile };
});

import { listOpenPullRequestsForProject } from '../derived-issue-state.js';

beforeEach(() => {
  mocks.runGh.mockReset();
  mocks.findProjectByPath.mockReset();
  mocks.execFileAsync.mockReset();
  mocks.execFileAsync.mockImplementation((file: string) => {
    if (file === 'git') return Promise.resolve({ stdout: 'origin\n', stderr: '' });
    throw new Error(`unexpected exec: ${file}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listOpenPullRequestsForProject — GitHub (PAN-4597)', () => {
  const PROJECT = '/fake/open-pr-listing-github';

  beforeEach(() => {
    // No registered project: forgeForProject defaults to github, and
    // shouldListPullRequests skips the tracker check and only asks git.
    mocks.findProjectByPath.mockReturnValue(null);
  });

  it('returns open, non-draft PRs keyed by the issue in their feature branch', async () => {
    mocks.runGh.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10, url: 'https://github.com/eltmon/overdeck/pull/10', state: 'OPEN',
          mergeable: 'MERGEABLE', reviewDecision: 'APPROVED',
          statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
          headRefName: 'feature/pan-10', headRefOid: 'a'.repeat(40), isDraft: false,
        },
        {
          number: 11, url: 'https://github.com/eltmon/overdeck/pull/11', state: 'OPEN',
          mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED',
          headRefName: 'feature/pan-11', headRefOid: 'b'.repeat(40), isDraft: true,
        },
        {
          number: 12, url: 'https://github.com/eltmon/overdeck/pull/12', state: 'MERGED',
          mergedAt: '2026-10-01T00:00:00Z', headRefName: 'feature/pan-12', headRefOid: 'c'.repeat(40), isDraft: false,
        },
        {
          number: 13, url: 'https://github.com/eltmon/overdeck/pull/13', state: 'CLOSED',
          headRefName: 'feature/pan-13', headRefOid: 'd'.repeat(40), isDraft: false,
        },
      ]),
    });

    const open = await listOpenPullRequestsForProject(PROJECT);

    expect(open).toEqual([
      { issueId: 'PAN-10', pr: expect.objectContaining({ number: 10, headSha: 'a'.repeat(40) }) },
    ]);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);
  });
});

describe('listOpenPullRequestsForProject — GitLab (PAN-4597)', () => {
  const PROJECT = '/fake/open-pr-listing-gitlab';

  beforeEach(() => {
    mocks.findProjectByPath.mockReturnValue({
      name: 'gl-project', path: PROJECT, gitlab_repo: 'group/repo',
    } as ProjectConfig);
  });

  it('reads the merge request listing instead of gh', async () => {
    mocks.execFileAsync.mockImplementation((file: string) => {
      if (file === 'glab') {
        return Promise.resolve({
          stdout: JSON.stringify([
            {
              iid: 20, web_url: 'https://gitlab.com/group/repo/-/merge_requests/20', state: 'opened',
              source_branch: 'feature/pan-20', draft: false, detailed_merge_status: 'mergeable',
              approved: true, sha: 'e'.repeat(40),
            },
            {
              iid: 21, web_url: 'https://gitlab.com/group/repo/-/merge_requests/21', state: 'opened',
              source_branch: 'feature/pan-21', draft: true, sha: 'f'.repeat(40),
            },
            {
              iid: 22, web_url: 'https://gitlab.com/group/repo/-/merge_requests/22', state: 'merged',
              source_branch: 'feature/pan-22', sha: 'g'.repeat(40),
            },
          ]),
          stderr: '',
        });
      }
      throw new Error(`unexpected exec: ${file}`);
    });

    const open = await listOpenPullRequestsForProject(PROJECT);

    expect(open).toEqual([
      { issueId: 'PAN-20', pr: expect.objectContaining({ number: 20, headSha: 'e'.repeat(40) }) },
    ]);
    // The gitlab path never touches gh — the merge request listing is read instead.
    expect(mocks.runGh).not.toHaveBeenCalled();
  });
});
