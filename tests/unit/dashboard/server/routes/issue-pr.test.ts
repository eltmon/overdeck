/**
 * Route-level regression tests for GET /api/issues/:id/pr (PAN-830, pan-9yn5).
 *
 * Exercises `fetchIssuePullRequest()` and `fetchIssuePullRequestDiff()` — the
 * testable cores of the route handlers. The route shells out to `gh pr list`,
 * `gh pr view`, and `gh pr diff`, so we mock node:child_process exec; we also
 * mock the tracker resolution so non-GH and GH-resolved issues can be exercised
 * without touching projects.yaml.
 *
 * Cases covered:
 *   - Non-GitHub issue → metadata returns { pr: null } without shelling out
 *   - No PR for branch (gh pr list returns empty) → metadata returns { pr: null }
 *   - Happy path → metadata returns parsed pr; diff endpoint returns patch
 *   - gh pr view failure → metadata returns { pr: null, error }
 *   - gh pr diff failure → diff endpoint returns { diff: null, error }
 *
 * Same `vi.hoisted` + `vi.mock('node:child_process')` pattern as
 * approve-push.test.ts so the test stays insulated from the rest of issues.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExec = vi.fn();
const mockResolveGitHubIssue = vi.fn();

vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => {
    const cb = args[args.length - 1] as Function;
    const cmdArgs = args.slice(0, -1);
    const result = mockExec(...cmdArgs);
    Promise.resolve(result).then(
      (val: any) => cb(null, val),
      (err: Error) => cb(err),
    );
    return { unref: vi.fn() };
  },
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as Function;
    const file = args[0] as string;
    const cmdArgs = args[1] as string[];
    const command = `${file} ${cmdArgs.join(' ')}`;
    const result = mockExec(command);
    Promise.resolve(result).then(
      (val: any) => cb(null, val),
      (err: Error) => cb(err),
    );
    return { unref: vi.fn() };
  },
  spawn: vi.fn(),
}));

vi.mock('../../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssue: (...args: unknown[]) => mockResolveGitHubIssue(...args),
  resolveGitHubIssueSync: (...args: unknown[]) => mockResolveGitHubIssue(...args),
  resolveTrackerType: vi.fn(() => 'github'),
}));

vi.mock('../../../../../src/lib/github-app.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/github-app.js')>();
  return {
    ...actual,
    isGitHubAppConfigured: vi.fn(() => false),
  };
});

// Stub modules imported at issues.ts module scope that are unused by this test.
vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  extractTeamPrefix: vi.fn(),
  findProjectByTeam: vi.fn(),
}));
vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentStateAsync: vi.fn(),
  normalizeAgentId: vi.fn((s: string) => s),
}));
vi.mock('../../../../../src/lib/database/index.js', () => ({
  getDatabase: vi.fn(() => ({ prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })) })),
  resetDatabase: vi.fn(),
}));
vi.mock('../../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: vi.fn(),
}));

// Import the function under test after mocks.
import {
  fetchIssueCheckRuns,
  fetchIssuePullRequest,
  fetchIssuePullRequestDiff,
} from '../../../../../src/lib/overdeck/pull-requests.js';
import { clearIssuePrTabCacheForTests } from '../../../../../src/dashboard/server/services/pr-tab-cache.js';

beforeEach(() => {
  vi.clearAllMocks();
  clearIssuePrTabCacheForTests();
});

describe('fetchIssuePullRequest — GET /api/issues/:id/pr', () => {
  it('returns { pr: null } when the issue is not a GitHub issue', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
    const result = await fetchIssuePullRequest('PAN-830');
    expect(result.pr).toBeNull();
    expect(result.issueId).toBe('PAN-830');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns { pr: null } when no PR exists for the feature or strike branch', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    // Both branch probes miss: feature/ first, then the strike/ fallback (PAN-2883).
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await fetchIssuePullRequest('PAN-830');

    expect(result.pr).toBeNull();
    expect(mockExec).toHaveBeenCalledTimes(2);
    const [featureCmd] = mockExec.mock.calls[0]!;
    expect(featureCmd).toContain('gh pr list');
    expect(featureCmd).toContain('--head feature/pan-830');
    expect(featureCmd).toContain('eltmon/overdeck');
    const [strikeCmd] = mockExec.mock.calls[1]!;
    expect(strikeCmd).toContain('--head strike/pan-830');
  });

  it('returns the single feature PR after probing both convention heads', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    const prJson = {
      number: 642,
      title: 'feat: command deck',
      url: 'https://github.com/eltmon/overdeck/pull/642',
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'feature/pan-830',
      author: { login: 'panopticon-agent' },
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
      reviewDecision: null,
      reviewRequests: [],
      statusCheckRollup: [],
      additions: 5,
      deletions: 2,
      changedFiles: 1,
      files: [{ path: 'src/foo.ts', additions: 5, deletions: 2 }],
      labels: [],
      mergeable: 'MERGEABLE',
      body: '',
    };
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 642, state: 'OPEN', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(prJson), stderr: '' });

    const result = await fetchIssuePullRequest('PAN-830');

    expect(result.pr?.number).toBe(642);
    expect(result.pr?.title).toBe('feat: command deck');
    expect(mockExec).toHaveBeenCalledTimes(3);
    const [featureCmdCall, strikeCmdCall, viewCmdCall] = mockExec.mock.calls;
    expect(featureCmdCall![0]).toContain('--head feature/pan-830');
    expect(strikeCmdCall![0]).toContain('--head strike/pan-830');
    expect(viewCmdCall![0]).toContain('gh pr view 642');
    expect(viewCmdCall![0]).toContain('eltmon/overdeck');
  });

  it('prefers a merged strike PR over a closed feature PR', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    const strikePr = {
      number: 3152,
      title: 'fix: strike landing',
      url: 'https://github.com/eltmon/overdeck/pull/3152',
      state: 'MERGED',
      mergedAt: '2026-07-26T12:00:00Z',
      mergeCommit: { oid: '6ac4a3dc11' },
    };
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 3127, state: 'CLOSED', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 3152, state: 'MERGED', mergedAt: '2026-07-26T12:00:00Z' }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(strikePr), stderr: '' });

    const result = await fetchIssuePullRequest('PAN-830');

    expect(result.pr).toMatchObject({
      number: 3152,
      state: 'MERGED',
      mergedAt: '2026-07-26T12:00:00Z',
      mergeCommit: { oid: '6ac4a3dc11' },
    });
    expect(mockExec.mock.calls[2]![0]).toContain('gh pr view 3152');
  });

  it('prefers an open feature PR over a merged strike PR', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    const featurePr = {
      number: 3127,
      title: 'fix: active feature',
      url: 'https://github.com/eltmon/overdeck/pull/3127',
      state: 'OPEN',
    };
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 3127, state: 'OPEN', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 3152, state: 'MERGED', mergedAt: '2026-07-26T12:00:00Z' }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(featurePr), stderr: '' });

    const result = await fetchIssuePullRequest('PAN-830');

    expect(result.pr?.number).toBe(3127);
    expect(result.pr?.state).toBe('OPEN');
    expect(mockExec.mock.calls[2]![0]).toContain('gh pr view 3127');
  });

  it('returns error when gh pr view fails', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 642, state: 'OPEN', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockRejectedValueOnce(new Error('gh: not authenticated'));

    const result = await fetchIssuePullRequest('PAN-830');

    expect(result.pr).toBeNull();
    expect(result.error).toContain('gh pr view failed');
    expect(result.error).toContain('not authenticated');
  });
});

describe('fetchIssuePullRequestDiff — GET /api/issues/:id/pr/diff', () => {
  it('returns { diff: null } when the issue is not a GitHub issue', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
    const result = await fetchIssuePullRequestDiff('PAN-830');
    expect(result.diff).toBeNull();
    expect(result.issueId).toBe('PAN-830');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns patch text on the happy path', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 642, state: 'OPEN', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'diff --git a/foo b/foo\n+added\n', stderr: '' });

    const result = await fetchIssuePullRequestDiff('PAN-830');

    expect(result.diff).toContain('diff --git');
    expect(result.diff).toContain('+added');
    expect(mockExec).toHaveBeenCalledTimes(3);
    const [, , diffCmdCall] = mockExec.mock.calls;
    expect(diffCmdCall![0]).toContain('gh pr diff 642');
    expect(diffCmdCall![0]).toContain('eltmon/overdeck');
  });

  it('returns error when gh pr diff fails', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 642, state: 'OPEN', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockRejectedValueOnce(new Error('diff too large'));

    const result = await fetchIssuePullRequestDiff('PAN-830');

    expect(result.diff).toBeNull();
    expect(result.error).toContain('gh pr diff failed');
  });
});

describe('fetchIssueCheckRuns — GET /api/issues/:id/check-runs', () => {
  it('returns empty checks when the issue is not a GitHub issue', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });

    const result = await fetchIssueCheckRuns('PAN-830');

    expect(result.pr).toBeNull();
    expect(result.checkRuns).toEqual([]);
    expect(result.summary.total).toBe(0);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns empty checks when no PR exists for the feature or strike branch', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    // feature/ probe then strike/ fallback, both miss (PAN-2883).
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await fetchIssueCheckRuns('PAN-830');

    expect(result.pr).toBeNull();
    expect(result.checkRuns).toEqual([]);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it('returns normalized check runs and summary counts', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    const prJson = {
      number: 642,
      url: 'https://github.com/eltmon/overdeck/pull/642',
      headRefName: 'feature/pan-830',
      headRefOid: 'abc123def456',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'lint', conclusion: 'SUCCESS' }],
    };
    const checksJson = {
      total_count: 5,
      check_runs: [
        { id: 1, name: 'build', status: 'completed', conclusion: 'success', html_url: 'https://github/checks/1', app: { name: 'GitHub Actions' } },
        { id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://github/checks/2' },
        { id: 3, name: 'deploy', status: 'completed', conclusion: 'skipped' },
        { id: 4, name: 'uat', status: 'in_progress', conclusion: null },
        { id: 5, name: 'queue', status: 'queued', conclusion: null },
      ],
    };
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 642, state: 'OPEN', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(prJson), stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(checksJson), stderr: '' });

    const result = await fetchIssueCheckRuns('PAN-830');

    expect(result.pr?.number).toBe(642);
    expect(result.checkRuns).toHaveLength(5);
    expect(result.checkRuns[0]).toMatchObject({ name: 'build', status: 'completed', conclusion: 'success', app: 'GitHub Actions' });
    expect(result.summary).toMatchObject({ total: 5, passed: 1, failed: 1, skipped: 1, running: 1, pending: 1 });
    const [, , , apiCmdCall] = mockExec.mock.calls;
    expect(apiCmdCall![0]).toContain('gh api');
    expect(apiCmdCall![0]).toContain('repos/eltmon/overdeck/commits/abc123def456/check-runs');
  });

  it('returns PR metadata and an error when gh api fails', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 830,
    });
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 642, state: 'OPEN', mergedAt: null }]), stderr: '' })
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ number: 642, url: 'https://github/pull/642', headRefName: 'feature/pan-830', mergeable: 'UNKNOWN', statusCheckRollup: [] }), stderr: '' })
      .mockRejectedValueOnce(new Error('gh: not authenticated'));

    const result = await fetchIssueCheckRuns('PAN-830');

    expect(result.pr?.number).toBe(642);
    expect(result.checkRuns).toEqual([]);
    expect(result.error).toContain('gh api check-runs failed');
  });
});
