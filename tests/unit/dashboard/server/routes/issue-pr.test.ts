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
  resolveTrackerType: vi.fn(() => 'github'),
}));

// Stub modules imported at issues.ts module scope that are unused by this test.
vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(),
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
  fetchIssuePullRequest,
  fetchIssuePullRequestDiff,
} from '../../../../../src/dashboard/server/routes/issues.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchIssuePullRequest — GET /api/issues/:id/pr', () => {
  it('returns { pr: null } when the issue is not a GitHub issue', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
    const result = await fetchIssuePullRequest('PAN-830');
    expect(result.pr).toBeNull();
    expect(result.issueId).toBe('PAN-830');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns { pr: null } when no PR exists for the feature branch', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 830,
    });
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await fetchIssuePullRequest('PAN-830');

    expect(result.pr).toBeNull();
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [cmd] = mockExec.mock.calls[0]!;
    expect(cmd).toContain('gh pr list');
    expect(cmd).toContain('--head feature/pan-830');
    expect(cmd).toContain('eltmon/panopticon-cli');
  });

  it('returns parsed pr metadata on the happy path', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 830,
    });
    const prJson = {
      number: 642,
      title: 'feat: command deck',
      url: 'https://github.com/eltmon/panopticon-cli/pull/642',
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
      .mockResolvedValueOnce({ stdout: '642\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify(prJson), stderr: '' });

    const result = await fetchIssuePullRequest('PAN-830');

    expect(result.pr?.number).toBe(642);
    expect(result.pr?.title).toBe('feat: command deck');
    expect(mockExec).toHaveBeenCalledTimes(2);
    const [, viewCmdCall] = mockExec.mock.calls;
    expect(viewCmdCall![0]).toContain('gh pr view 642');
    expect(viewCmdCall![0]).toContain('eltmon/panopticon-cli');
  });

  it('returns error when gh pr view fails', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 830,
    });
    mockExec
      .mockResolvedValueOnce({ stdout: '642\n', stderr: '' })
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
      repo: 'panopticon-cli',
      number: 830,
    });
    mockExec
      .mockResolvedValueOnce({ stdout: '642\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'diff --git a/foo b/foo\n+added\n', stderr: '' });

    const result = await fetchIssuePullRequestDiff('PAN-830');

    expect(result.diff).toContain('diff --git');
    expect(result.diff).toContain('+added');
    expect(mockExec).toHaveBeenCalledTimes(2);
    const [, diffCmdCall] = mockExec.mock.calls;
    expect(diffCmdCall![0]).toContain('gh pr diff 642');
    expect(diffCmdCall![0]).toContain('eltmon/panopticon-cli');
  });

  it('returns error when gh pr diff fails', async () => {
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 830,
    });
    mockExec
      .mockResolvedValueOnce({ stdout: '642\n', stderr: '' })
      .mockRejectedValueOnce(new Error('diff too large'));

    const result = await fetchIssuePullRequestDiff('PAN-830');

    expect(result.diff).toBeNull();
    expect(result.error).toContain('gh pr diff failed');
  });
});
