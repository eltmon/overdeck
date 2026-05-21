/**
 * Tests for tracker priority in transitionIssueState (PAN-489)
 *
 * Verifies that projects with github_repo use GitHub Issues,
 * not Linear — even when issue_prefix is also set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// Mock projects module
vi.mock('../projects.js', () => ({
  findProjectByPath: vi.fn(),
  getIssuePrefix: vi.fn(),
}));

// Mock tracker factory
vi.mock('../tracker/factory.js', () => ({
  createTracker: vi.fn(),
  createTrackerFromConfig: vi.fn(),
}));

// Mock config
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => ({ trackers: { linear: { apiKey: 'fake-key' } } })),
}));

import { findProjectByPath, getIssuePrefix } from '../projects.js';
import { createTracker, createTrackerFromConfig } from '../tracker/factory.js';
import { transitionIssueToInReview } from '../agents.js';

const mockFindProjectByPath = vi.mocked(findProjectByPath);
const mockGetIssuePrefix = vi.mocked(getIssuePrefix);
const mockCreateTracker = vi.mocked(createTracker);
const mockCreateTrackerFromConfig = vi.mocked(createTrackerFromConfig);

const mockTracker = {
  // transitionIssue is Effect-returning post-PAN-1249; production calls via Effect.runPromise.
  transitionIssue: vi.fn().mockReturnValue(Effect.succeed(undefined)),
  getIssue: vi.fn(),
  listIssues: vi.fn(),
  updateIssue: vi.fn(),
  createIssue: vi.fn(),
  addComment: vi.fn(),
  getComment: vi.fn(),
};

describe('transitionIssueState bare numeric ID guard (PAN-489)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips transition and logs warning for bare numeric issueId', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await transitionIssueToInReview('484', '/some/workspace');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bare numeric ID'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"484"'));
    expect(mockCreateTracker).not.toHaveBeenCalled();
    expect(mockCreateTrackerFromConfig).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('does not skip transition for properly-prefixed issueId', async () => {
    mockFindProjectByPath.mockReturnValue({
      name: 'panopticon-cli',
      path: '/projects/panopticon-cli',
      github_repo: 'eltmon/panopticon-cli',
    } as any);
    mockGetIssuePrefix.mockReturnValue(undefined);
    mockCreateTracker.mockReturnValue(mockTracker as any);

    await transitionIssueToInReview('PAN-484', '/projects/panopticon-cli/workspaces/feature-pan-484');

    expect(mockCreateTracker).toHaveBeenCalled();
  });
});

describe('transitionIssueState tracker priority (PAN-489)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTracker.mockReturnValue(mockTracker as any);
    mockCreateTrackerFromConfig.mockReturnValue(mockTracker as any);
  });

  it('uses GitHub when project has github_repo, even with issue_prefix set', async () => {
    mockFindProjectByPath.mockReturnValue({
      name: 'panopticon-cli',
      path: '/projects/panopticon-cli',
      github_repo: 'eltmon/panopticon-cli',
      issue_prefix: 'PAN',
    } as any);
    mockGetIssuePrefix.mockReturnValue('PAN');

    await transitionIssueToInReview('PAN-484', '/projects/panopticon-cli/workspaces/feature-pan-484');

    expect(mockCreateTracker).toHaveBeenCalledWith({ type: 'github', owner: 'eltmon', repo: 'panopticon-cli' });
    expect(mockCreateTrackerFromConfig).not.toHaveBeenCalled();
    expect(mockTracker.transitionIssue).toHaveBeenCalledWith('PAN-484', 'in_review');
  });

  it('uses Linear when project has issue_prefix but no github_repo (gitlab+linear project)', async () => {
    mockFindProjectByPath.mockReturnValue({
      name: 'mind-your-now',
      path: '/projects/myn',
      gitlab_repo: 'eltmon/mind-your-now',
      issue_prefix: 'MIN',
    } as any);
    mockGetIssuePrefix.mockReturnValue('MIN');

    await transitionIssueToInReview('MIN-100', '/projects/myn/workspaces/feature-min-100');

    expect(mockCreateTrackerFromConfig).toHaveBeenCalledWith(expect.anything(), 'linear');
    expect(mockCreateTracker).not.toHaveBeenCalled();
    expect(mockTracker.transitionIssue).toHaveBeenCalledWith('MIN-100', 'in_review');
  });

  it('uses GitHub for project with only github_repo (no issue_prefix)', async () => {
    mockFindProjectByPath.mockReturnValue({
      name: 'krux',
      path: '/projects/krux',
      github_repo: 'eltmon/krux',
    } as any);
    mockGetIssuePrefix.mockReturnValue(undefined);

    await transitionIssueToInReview('KRUX-3', '/projects/krux/workspaces/feature-krux-3');

    expect(mockCreateTracker).toHaveBeenCalledWith({ type: 'github', owner: 'eltmon', repo: 'krux' });
    expect(mockTracker.transitionIssue).toHaveBeenCalledWith('KRUX-3', 'in_review');
  });

  it('throws when no project config found for workspace', async () => {
    mockFindProjectByPath.mockReturnValue(null);

    await expect(
      transitionIssueToInReview('PAN-999', '/unknown/workspace')
    ).rejects.toThrow(/no project config found/);
  });

  it('throws when project has no tracker configured', async () => {
    mockFindProjectByPath.mockReturnValue({
      name: 'papers-please',
      path: '/projects/papers-please',
    } as any);
    mockGetIssuePrefix.mockReturnValue(undefined);

    await expect(
      transitionIssueToInReview('PP-1', '/projects/papers-please/workspaces/feature-pp-1')
    ).rejects.toThrow(/no tracker configured/);
  });
});
