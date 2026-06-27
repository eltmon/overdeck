import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getGitHubConfig: vi.fn(),
  getReviewStatusSync: vi.fn(),
  issueService: {
    getIssues: vi.fn(),
  },
  listProjectsSync: vi.fn(),
  listSessionNames: vi.fn(),
  openPullRequests: [] as unknown[],
  resolveAgentGitInfo: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: mocks.getAgentRuntimeState,
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNames: mocks.listSessionNames,
}));

vi.mock('../../../../../src/dashboard/server/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));

vi.mock('../../../../../src/dashboard/server/services/git-info.js', () => ({
  resolveAgentGitInfo: mocks.resolveAgentGitInfo,
}));

vi.mock('../../../../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: mocks.getGitHubConfig,
}));

vi.mock('../../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: vi.fn(async () => mocks.issueService),
}));

import type { ResourceAllocatedIssue } from '../../../../../src/dashboard/server/services/resource-discovery.js';
import {
  discoverResourceAllocatedIssues,
  groupResourceAllocatedIssuesByProject,
  isDiscoverableAgentSession,
  resetResourceAllocatedIssuesCacheForTests,
  sanitizeResourceAllocatedIssues,
} from '../../../../../src/dashboard/server/services/resource-discovery.js';

beforeEach(() => {
  vi.clearAllMocks();
  resetResourceAllocatedIssuesCacheForTests();
  mocks.issueService.getIssues.mockReturnValue([]);
  mocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
    state: 'idle',
    lastActivity: '2026-06-27T00:00:00.000Z',
  }));
  mocks.getGitHubConfig.mockReturnValue({ repos: [] });
  mocks.getReviewStatusSync.mockReturnValue(null);
  mocks.listProjectsSync.mockReturnValue([
    { key: 'overdeck', config: { name: 'overdeck', path: '/tmp/overdeck', issue_prefix: 'PAN' } },
  ]);
  mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
  mocks.openPullRequests = [];
  mocks.resolveAgentGitInfo.mockResolvedValue({
    actualBranch: null,
    branchDrifted: false,
    workspaceMissing: false,
  });
  mocks.resolveProjectFromIssueSync.mockImplementation((issueId: string) => ({
    projectKey: 'overdeck',
    projectName: 'overdeck',
    projectPath: '/tmp/overdeck',
    issueId,
  }));
  mocks.execFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, result?: { stdout: string }) => void) => {
    if (command === 'gh' && args[0] === 'pr') {
      callback(null, { stdout: JSON.stringify(mocks.openPullRequests) });
      return;
    }
    callback(null, { stdout: '' });
  });
});

describe('resource-discovery grouping', () => {
  it('groups issues by project and sorts project names and issue ids', () => {
    const issues: ResourceAllocatedIssue[] = [
      {
        issueId: 'PAN-200',
        title: 'Second',
        projectName: 'overdeck',
        branch: 'feature/pan-200',
        status: 'idle',
        stateLabel: 'Allocated',
        agentStatus: null,
        hasPlanning: false,
        hasPrd: false,
        hasState: false,
        isShadow: false,
        isRally: false,
        readyForMerge: false,
        resourceSources: ['workspace'],
        resourceDetails: {
          hasWorkspace: true,
          workspacePaths: ['/tmp/workspaces/feature-pan-200'],
          localBranchCount: 0,
          localBranchNames: [],
          remoteBranchCount: 0,
          remoteBranchNames: [],
          tmuxSessionCount: 0,
          tmuxSessionNames: [],
          prs: [],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 0,
          dockerContainerNames: [],
        },
      },
      {
        issueId: 'AAA-1',
        title: 'Other project',
        projectName: 'aaa-project',
        branch: 'feature/aaa-1',
        status: 'idle',
        stateLabel: 'Allocated',
        agentStatus: null,
        hasPlanning: false,
        hasPrd: false,
        hasState: false,
        isShadow: false,
        isRally: true,
        childCount: 3,
        completedCount: 1,
        inProgressCount: 1,
        readyForMerge: false,
        resourceSources: ['branch'],
        resourceDetails: {
          hasWorkspace: false,
          workspacePaths: [],
          localBranchCount: 1,
          localBranchNames: ['feature/aaa-1'],
          remoteBranchCount: 0,
          remoteBranchNames: [],
          tmuxSessionCount: 0,
          tmuxSessionNames: [],
          prs: [],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 0,
          dockerContainerNames: [],
        },
      },
      {
        issueId: 'PAN-100',
        title: 'First',
        projectName: 'overdeck',
        branch: 'feature/pan-100',
        status: 'running',
        stateLabel: 'In Progress',
        agentStatus: 'active',
        hasPlanning: true,
        hasPrd: true,
        hasState: true,
        isShadow: false,
        isRally: false,
        readyForMerge: false,
        resourceSources: ['tmux', 'pr'],
        resourceDetails: {
          hasWorkspace: true,
          workspacePaths: ['/tmp/workspaces/feature-pan-100'],
          localBranchCount: 1,
          localBranchNames: ['feature/pan-100'],
          remoteBranchCount: 1,
          remoteBranchNames: ['origin/feature/pan-100'],
          tmuxSessionCount: 1,
          tmuxSessionNames: ['agent-pan-100'],
          prs: [
            {
              number: 12,
              title: 'PAN-100 PR',
              url: 'https://example.test/pr/12',
              state: 'OPEN',
              isDraft: false,
            },
          ],
          hasVbrief: true,
          hasBeads: true,
          dockerContainerCount: 1,
          dockerContainerNames: ['pan-100-db'],
        },
      },
    ];

    const grouped = groupResourceAllocatedIssuesByProject(issues);

    expect(grouped.map((project) => project.name)).toEqual(['aaa-project', 'overdeck']);
    expect(grouped[1]?.features.map((feature) => feature.issueId)).toEqual(['PAN-100', 'PAN-200']);
  });
});

describe('resource-discovery sanitization', () => {
  it('strips concrete infrastructure identifiers from the public resource-allocated response', () => {
    const sanitized = sanitizeResourceAllocatedIssues([
      {
        issueId: 'PAN-300',
        title: 'Sanitized',
        projectName: 'overdeck',
        branch: 'feature/pan-300',
        status: 'idle',
        stateLabel: 'Allocated',
        agentStatus: null,
        hasPlanning: false,
        hasPrd: false,
        hasState: false,
        isShadow: false,
        isRally: false,
        readyForMerge: false,
        resourceSources: ['workspace', 'branch', 'tmux', 'docker', 'pr'],
        resourceDetails: {
          hasWorkspace: true,
          workspacePaths: ['/tmp/workspaces/feature-pan-300'],
          localBranchCount: 1,
          localBranchNames: ['feature/pan-300'],
          remoteBranchCount: 1,
          remoteBranchNames: ['origin/feature/pan-300'],
          tmuxSessionCount: 1,
          tmuxSessionNames: ['agent-pan-300'],
          prs: [
            {
              number: 300,
              title: 'PAN-300 PR',
              url: 'https://example.test/pr/300',
              state: 'OPEN',
              isDraft: false,
            },
          ],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 1,
          dockerContainerNames: ['pan-300-db'],
        },
      },
    ]);

    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).workspacePaths).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).localBranchNames).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).remoteBranchNames).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).tmuxSessionNames).toBeUndefined();
    expect((sanitized[0]?.resourceDetails as Record<string, unknown>).dockerContainerNames).toBeUndefined();
    expect(sanitized[0]?.resourceDetails.prs[0]).toEqual({
      number: 300,
      title: 'PAN-300 PR',
      state: 'OPEN',
      isDraft: false,
    });
    expect(sanitized[0]?.resourceDetails.localBranchCount).toBe(1);
    expect(sanitized[0]?.resourceDetails.tmuxSessionCount).toBe(1);
  });
});

describe('resource-discovery terminal issue filtering', () => {
  it('excludes closed close-out residue unless the issue still has an open PR', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      {
        identifier: 'PAN-2054',
        title: 'Close-out residue',
        state: 'closed',
        rawTrackerState: 'CLOSED',
      },
    ]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-2054']));

    await expect(discoverResourceAllocatedIssues()).resolves.toEqual([]);

    resetResourceAllocatedIssuesCacheForTests();
    mocks.getGitHubConfig.mockReturnValue({ repos: [{ owner: 'eltmon', repo: 'overdeck' }] });
    mocks.openPullRequests = [
      {
        number: 2054,
        title: 'PAN-2054 PR',
        url: 'https://github.com/eltmon/overdeck/pull/2054',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'PAN-2054',
        baseRefName: 'main',
      },
    ];

    const withOpenPr = await discoverResourceAllocatedIssues();

    expect(mocks.getGitHubConfig).toHaveBeenCalled();
    expect(mocks.execFile).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['pr', 'list']),
      expect.any(Object),
      expect.any(Function),
    );
    expect(withOpenPr.map((issue) => issue.issueId)).toEqual(['PAN-2054']);
    expect(withOpenPr[0]?.resourceSources).toContain('pr');
  });
});

describe('resource-discovery session prefix allowlist', () => {
  it('maps strike sessions to their issue so strike work surfaces in the tree (PAN-1682)', () => {
    expect(isDiscoverableAgentSession('strike-pan-1682')).toBe(true);
  });

  it('still recognizes the pre-existing agent/planning/specialist/review prefixes', () => {
    expect(isDiscoverableAgentSession('agent-pan-100')).toBe(true);
    expect(isDiscoverableAgentSession('planning-pan-100')).toBe(true);
    expect(isDiscoverableAgentSession('specialist-pan-100')).toBe(true);
    expect(isDiscoverableAgentSession('review-pan-100')).toBe(true);
  });

  it('ignores unrelated tmux sessions', () => {
    expect(isDiscoverableAgentSession('conv-371')).toBe(false);
    expect(isDiscoverableAgentSession('overdeck')).toBe(false);
    expect(isDiscoverableAgentSession('0')).toBe(false);
  });
});

describe('resource-discovery cache test hooks', () => {
  it('allows cache state to be reset between tests', () => {
    expect(() => resetResourceAllocatedIssuesCacheForTests()).not.toThrow();
  });
});
