/**
 * Route-level regression tests for GET /api/issues/:id/discussions
 * (PAN-830, pan-1r7j).
 *
 * Exercises `fetchIssueDiscussions()` — the testable core of the route
 * handler. The route shells out to `gh pr list`, `gh api repos/.../issues/.../comments`,
 * `gh api repos/.../pulls/.../reviews`, and `gh api repos/.../pulls/.../comments`
 * so we mock node:child_process exec; we also mock the tracker resolution and
 * GitHub repo config so non-GH and GH-resolved issues can be exercised without
 * touching projects.yaml.
 *
 * Cases covered:
 *   - Linear-only issue with no GH repo mapping → returns Linear comments only
 *   - GitHub issue with PR → merges all 4 GH sources sorted chronologically
 *   - GitHub issue without PR → returns issue comments only
 *   - Empty COMMENTED reviews are filtered out
 *   - gh failures collected into `errors` (partial success)
 *   - Linear + GitHub-PR-only (Linear-tracked but PR exists in mapped repo)
 *
 * Same `vi.hoisted` + `vi.mock('node:child_process')` pattern as
 * issue-pr.test.ts so the test stays insulated from the rest of issues.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExec = vi.fn();
const mockResolveGitHubIssue = vi.fn();
const mockResolveTrackerType = vi.fn();
const mockGetGitHubConfig = vi.fn();

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
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
  };
});

vi.mock('../../../../../src/lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssue: (...args: unknown[]) => mockResolveGitHubIssue(...args),
    resolveTrackerType: (...args: unknown[]) => mockResolveTrackerType(...args),
  };
});

vi.mock('../../../../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: () => mockGetGitHubConfig(),
  getRallyConfig: vi.fn(),
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
import { fetchIssueDiscussions } from '../../../../../src/dashboard/server/routes/issues.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveTrackerType.mockReturnValue('github');
  mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
  mockGetGitHubConfig.mockReturnValue(null);
});

describe('fetchIssueDiscussions — GET /api/issues/:id/discussions', () => {
  it('returns Linear comments only when issue is Linear and no GH repo is mapped', async () => {
    mockResolveTrackerType.mockReturnValue('linear');
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });

    const linearGetIssueId = vi.fn().mockResolvedValue('uuid-1');
    const linearGetComments = vi.fn().mockResolvedValue([
      { author: 'eltmon', body: 'first', createdAt: '2026-04-20T00:00:00Z' },
      { author: 'eltmon', body: 'second', createdAt: '2026-04-21T00:00:00Z' },
    ]);

    const result = await fetchIssueDiscussions('MIN-449', {
      linearGetIssueId,
      linearGetComments,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.source).toBe('linear');
    expect(result.items[0]?.body).toBe('first');
    expect(result.items[1]?.body).toBe('second');
    expect(result.prNumber).toBeNull();
    expect(result.errors).toBeUndefined();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('merges all 4 GitHub sources for a GH issue with an open PR', async () => {
    mockResolveTrackerType.mockReturnValue('github');
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 830,
    });

    // gh api repos/.../issues/830/comments → issue conversation
    const issueCommentsJson = JSON.stringify([
      { id: 1, user: { login: 'alice' }, body: 'on the issue', created_at: '2026-04-20T00:00:00Z', html_url: 'u1' },
    ]);
    // gh pr list → 642
    const prListStdout = '642\n';
    // gh api repos/.../issues/642/comments → PR conversation
    const prConvJson = JSON.stringify([
      { id: 2, user: { login: 'bob' }, body: 'pr conv', created_at: '2026-04-22T00:00:00Z', html_url: 'u2' },
    ]);
    // gh api repos/.../pulls/642/reviews → review submissions
    const prReviewsJson = JSON.stringify([
      { id: 3, user: { login: 'carol' }, body: 'looks good', state: 'APPROVED', submitted_at: '2026-04-23T00:00:00Z', html_url: 'u3' },
      { id: 4, user: { login: 'carol' }, body: '', state: 'COMMENTED', submitted_at: '2026-04-23T01:00:00Z' }, // filtered
    ]);
    // gh api repos/.../pulls/642/comments → inline review comments
    const prRcJson = JSON.stringify([
      { id: 5, user: { login: 'carol' }, body: 'tweak me', created_at: '2026-04-21T00:00:00Z', html_url: 'u5', path: 'src/foo.ts', line: 42 },
    ]);

    mockExec
      .mockResolvedValueOnce({ stdout: issueCommentsJson, stderr: '' })
      .mockResolvedValueOnce({ stdout: prListStdout, stderr: '' })
      .mockResolvedValueOnce({ stdout: prConvJson, stderr: '' })
      .mockResolvedValueOnce({ stdout: prReviewsJson, stderr: '' })
      .mockResolvedValueOnce({ stdout: prRcJson, stderr: '' });

    const result = await fetchIssueDiscussions('PAN-830');

    expect(result.prNumber).toBe(642);
    expect(result.errors).toBeUndefined();
    // Sorted chronologically, COMMENTED-empty review filtered out
    expect(result.items.map((i) => i.source)).toEqual([
      'github-issue',           // 2026-04-20
      'github-pr-review-comment', // 2026-04-21
      'github-pr-conversation', // 2026-04-22
      'github-pr-review',       // 2026-04-23 (APPROVED only; empty COMMENTED dropped)
    ]);
    const inline = result.items.find((i) => i.source === 'github-pr-review-comment');
    expect(inline?.filePath).toBe('src/foo.ts');
    expect(inline?.line).toBe(42);
    expect(inline?.prNumber).toBe(642);
    const review = result.items.find((i) => i.source === 'github-pr-review');
    expect(review?.reviewState).toBe('APPROVED');
  });

  it('returns issue comments only when no PR exists for the branch', async () => {
    mockResolveTrackerType.mockReturnValue('github');
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 830,
    });

    mockExec
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' }) // issue comments empty
      .mockResolvedValueOnce({ stdout: '', stderr: '' }); // gh pr list empty

    const result = await fetchIssueDiscussions('PAN-830');

    expect(result.items).toEqual([]);
    expect(result.prNumber).toBeNull();
    // gh pr list was called, but no further `pr conv/reviews/comments` calls
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it('collects gh failures into errors[] and returns partial data', async () => {
    mockResolveTrackerType.mockReturnValue('github');
    mockResolveGitHubIssue.mockReturnValue({
      isGitHub: true,
      owner: 'eltmon',
      repo: 'panopticon-cli',
      number: 830,
    });

    mockExec
      .mockRejectedValueOnce(new Error('gh: not authenticated')) // issue comments
      .mockResolvedValueOnce({ stdout: '642\n', stderr: '' })    // gh pr list ok
      .mockRejectedValueOnce(new Error('rate limit'))            // pr conversation
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })       // pr reviews ok
      .mockRejectedValueOnce(new Error('boom'));                 // pr review comments

    const result = await fetchIssueDiscussions('PAN-830');

    expect(result.prNumber).toBe(642);
    expect(result.items).toEqual([]);
    expect(result.errors?.length).toBe(3);
    expect(result.errors?.some((e) => e.includes('gh issue comments failed'))).toBe(true);
    expect(result.errors?.some((e) => e.includes('gh pr conversation failed'))).toBe(true);
    expect(result.errors?.some((e) => e.includes('gh pr review comments failed'))).toBe(true);
  });

  it('looks up PR via project-mapped repo for Linear-tracked issues', async () => {
    mockResolveTrackerType.mockReturnValue('linear');
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
    mockGetGitHubConfig.mockReturnValue({
      repos: [{ owner: 'eltmon', repo: 'panopticon-cli', prefix: 'PAN' }],
    });

    const linearGetIssueId = vi.fn().mockResolvedValue('uuid-1');
    const linearGetComments = vi.fn().mockResolvedValue([
      { author: 'eltmon', body: 'on linear', createdAt: '2026-04-20T00:00:00Z' },
    ]);

    mockExec
      .mockResolvedValueOnce({ stdout: '642\n', stderr: '' })   // gh pr list found
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })       // pr conversation empty
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' })       // pr reviews empty
      .mockResolvedValueOnce({ stdout: '[]', stderr: '' });      // pr review comments empty

    const result = await fetchIssueDiscussions('PAN-830', {
      linearGetIssueId,
      linearGetComments,
    });

    expect(result.prNumber).toBe(642);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.source).toBe('linear');
    expect(mockExec).toHaveBeenCalledTimes(4);
    const [listCmd] = mockExec.mock.calls[0]!;
    expect(listCmd).toContain('gh pr list');
    expect(listCmd).toContain('eltmon/panopticon-cli');
  });

  it('skips Linear fetch when deps are not provided (no Linear client wired)', async () => {
    mockResolveTrackerType.mockReturnValue('linear');
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });

    const result = await fetchIssueDiscussions('MIN-1');

    expect(result.items).toEqual([]);
    expect(result.prNumber).toBeNull();
    expect(result.errors).toBeUndefined();
    expect(mockExec).not.toHaveBeenCalled();
  });
});
