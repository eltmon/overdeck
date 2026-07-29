import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

import { PLANNED_BACKLOG_SPEC_ONLY_REASON } from '../../../../../src/lib/pipeline-membership.js';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  findDraftPrd: vi.fn(),
  findSpecByIssue: vi.fn(),
  getPipelineMembershipForProjects: vi.fn(),
  membershipSnapshotResults: [] as Array<{ project: { name: string; path: string }; memberships: unknown[] }>,
  getAgentRuntimeState: vi.fn(),
  getRuntimeCensus: vi.fn(),
  getGitHubConfig: vi.fn(),
  issueService: {
    getIssues: vi.fn(),
  },
  listProjectsSync: vi.fn(),
  listSessionNames: vi.fn(),
  listWorkspaces: vi.fn(),
  listConversations: vi.fn(),
  loadReadyForMergeFlags: vi.fn(),
  openPullRequests: [] as unknown[],
  readdir: vi.fn(),
  resolveAgentGitInfo: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('../../../../../src/dashboard/server/services/pipeline-membership.js', () => ({
  getPipelineMembershipForProjects: mocks.getPipelineMembershipForProjects,
  getPipelineMembershipResultsForProjects: async (configs: Array<{ name: string; path: string }>) => [{
    project: configs[0],
    memberships: await mocks.getPipelineMembershipForProjects(configs),
  }],
  refreshMembershipSnapshotsForProjects: async (configs: Array<{ name: string; path: string }>) => {
    try {
      const memberships = await mocks.getPipelineMembershipForProjects(configs);
      for (const project of configs) {
        mocks.membershipSnapshotResults = mocks.membershipSnapshotResults
          .filter((result) => result.project.path !== project.path);
        mocks.membershipSnapshotResults.push({ project, memberships });
      }
    } catch {
      // Preserve the prior snapshot, or remain cold when no gather succeeded.
    }
  },
  readPipelineMembershipSnapshotsForProjects: (configs: Array<{ name: string; path: string }>) =>
    configs.map((project) => mocks.membershipSnapshotResults.find((result) => result.project.path === project.path)
      ?? { project, error: new Error('Pipeline membership snapshot is loading') }),
}));

vi.mock('../../../../../src/lib/pipeline-membership-gather.js', () => ({
  listOpenPullRequestsSnapshot: vi.fn(async () => mocks.openPullRequests),
}));

vi.mock('node:fs/promises', () => ({
  readdir: mocks.readdir,
  stat: mocks.stat,
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

vi.mock('../../../../../src/lib/workspaces/resolver.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
}));

vi.mock('../../../../../src/lib/runtime-census.js', () => ({
  getRuntimeCensus: mocks.getRuntimeCensus,
}));

vi.mock('../../../../../src/dashboard/server/review-status.js', () => ({
  loadReadyForMergeFlags: mocks.loadReadyForMergeFlags,
}));

vi.mock('../../../../../src/dashboard/server/services/git-info.js', () => ({
  resolveAgentGitInfo: mocks.resolveAgentGitInfo,
}));

vi.mock('../../../../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: mocks.getGitHubConfig,
}));

vi.mock('../../../../../src/lib/overdeck/conversations.js', () => ({
  listConversations: mocks.listConversations,
}));

vi.mock('../../../../../src/lib/pan-dir/specs.js', () => ({
  findSpecByIssue: mocks.findSpecByIssue,
}));

vi.mock('../../../../../src/lib/prd-locations.js', () => ({
  findDraftPrd: mocks.findDraftPrd,
}));

vi.mock('../../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: vi.fn(async () => mocks.issueService),
}));

import type { ResourceAllocatedIssue } from '../../../../../src/dashboard/server/services/resource-discovery.js';
import {
  discoverResourceAllocatedIssues,
  getCachedResourceAllocatedIssues,
  getResourceDetailIdentifiers,
  groupResourceAllocatedIssuesByProject,
  isDiscoverableAgentSession,
  refreshResourceAllocatedProjects,
  resetResourceAllocatedIssuesCacheForTests,
  sanitizeResourceAllocatedIssues,
} from '../../../../../src/dashboard/server/services/resource-discovery.js';

function membership(issueId: string, bucket = 'in_flight', reasons = ['test resolver verdict']) {
  return {
    issueId,
    inPipeline: true,
    bucket,
    reasons,
    labelDrift: null,
    lenses: { L1_openPr: false, L2_unmergedBranch: true, L3_issueOpen: true, L4_phaseLabel: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetResourceAllocatedIssuesCacheForTests();
  mocks.issueService.getIssues.mockReturnValue([]);
  mocks.getAgentRuntimeState.mockReturnValue(Effect.succeed({
    state: 'idle',
    lastActivity: '2026-06-27T00:00:00.000Z',
  }));
  mocks.getGitHubConfig.mockReturnValue({ repos: [] });
  mocks.loadReadyForMergeFlags.mockReturnValue(new Map());
  mocks.listProjectsSync.mockReturnValue([
    { key: 'overdeck', config: { name: 'overdeck', path: '/tmp/overdeck', issue_prefix: 'PAN', github_repo: 'eltmon/overdeck' } },
  ]);
  mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
  mocks.listWorkspaces.mockReturnValue([]);
  mocks.getRuntimeCensus.mockImplementation(async () => ({
    sessionNames: new Set(await Effect.runPromise(mocks.listSessionNames())),
  }));
  mocks.listConversations.mockReturnValue([]);
  mocks.openPullRequests = [];
  mocks.readdir.mockResolvedValue([]);
  mocks.stat.mockRejectedValue(new Error('no such file'));
  mocks.findDraftPrd.mockReturnValue(Effect.succeed(null));
  mocks.findSpecByIssue.mockReturnValue(Effect.fail('no spec'));
  mocks.getPipelineMembershipForProjects.mockResolvedValue([]);
  mocks.membershipSnapshotResults = [];
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

describe('resource-discovery snapshot ownership', () => {
  it('keeps request-side list and detail reads free of discovery work', async () => {
    await expect(getCachedResourceAllocatedIssues()).resolves.toEqual([]);
    await expect(getResourceDetailIdentifiers('PAN-1')).resolves.toBeNull();

    expect(mocks.issueService.getIssues).not.toHaveBeenCalled();
    expect(mocks.listSessionNames).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('reuses the membership snapshot for lifecycle-only resource refreshes', async () => {
    const overdeckProject = { name: 'overdeck', path: '/tmp/overdeck', issue_prefix: 'PAN', github_repo: 'eltmon/overdeck' };

    await refreshResourceAllocatedProjects([overdeckProject], { refreshMembership: false });

    expect(mocks.getPipelineMembershipForProjects).not.toHaveBeenCalled();
  });

  it('publishes refreshed projects independently into one combined snapshot', async () => {
    const overdeckProject = { name: 'overdeck', path: '/tmp/overdeck', issue_prefix: 'PAN', github_repo: 'eltmon/overdeck' };
    const mynProject = { name: 'mind-your-now', path: '/tmp/myn', issue_prefix: 'MIN', gitlab_repo: 'eltmon/mind-your-now' };
    mocks.listProjectsSync.mockReturnValue([
      { key: 'overdeck', config: overdeckProject },
      { key: 'mind-your-now', config: mynProject },
    ]);
    mocks.resolveProjectFromIssueSync.mockImplementation((issueId: string) => issueId.startsWith('MIN-')
      ? { projectKey: 'mind-your-now', projectName: 'mind-your-now', projectPath: '/tmp/myn' }
      : { projectKey: 'overdeck', projectName: 'overdeck', projectPath: '/tmp/overdeck' });
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-1', title: 'Overdeck work', state: 'open' },
      { identifier: 'MIN-1', title: 'MYN work', state: 'open' },
    ]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1', 'agent-min-1']));
    mocks.getPipelineMembershipForProjects.mockImplementation(async (configs: Array<{ path: string }>) => [
      membership(configs[0]?.path === mynProject.path ? 'MIN-1' : 'PAN-1'),
    ]);

    await refreshResourceAllocatedProjects([overdeckProject]);
    expect((await getCachedResourceAllocatedIssues()).map((issue) => issue.issueId)).toEqual(['PAN-1']);

    await refreshResourceAllocatedProjects([mynProject]);
    expect((await getCachedResourceAllocatedIssues()).map((issue) => issue.issueId)).toEqual(['MIN-1', 'PAN-1']);
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
          hasXbrief: false,
          hasTasks: false,
          dockerContainerCount: 0,
          dockerContainerNames: [],
          branchAheadOfMain: false,
          conversations: [],
        },
        taskTotals: null,
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
          hasXbrief: false,
          hasTasks: false,
          dockerContainerCount: 0,
          dockerContainerNames: [],
          branchAheadOfMain: false,
          conversations: [],
        },
        taskTotals: null,
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
          hasXbrief: true,
          hasTasks: true,
          dockerContainerCount: 1,
          dockerContainerNames: ['pan-100-db'],
          branchAheadOfMain: false,
          conversations: [],
        },
        taskTotals: null,
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
          hasXbrief: false,
          hasTasks: false,
          dockerContainerCount: 1,
          dockerContainerNames: ['pan-300-db'],
          branchAheadOfMain: false,
          conversations: [],
        },
        taskTotals: null,
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
  it('preserves live close-out residue as annotation-only resource drift', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      {
        identifier: 'PAN-2054',
        title: 'Close-out residue',
        state: 'closed',
        rawTrackerState: 'CLOSED',
      },
    ]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-2054']));
    mocks.getPipelineMembershipForProjects.mockResolvedValue([{
      issueId: 'PAN-2054', inPipeline: false, bucket: 'clean_terminal', reasons: ['closed'], labelDrift: null,
      lenses: { L1_openPr: false, L2_unmergedBranch: false, L3_issueOpen: false, L4_phaseLabel: null },
    }]);

    await expect(discoverResourceAllocatedIssues()).resolves.toEqual([
      expect.objectContaining({
        issueId: 'PAN-2054', pipelineBucket: 'clean_terminal', resourceDrift: true,
      }),
    ]);

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
    mocks.getPipelineMembershipForProjects.mockResolvedValue([{
      issueId: 'PAN-2054',
      inPipeline: true,
      bucket: 'zombie_pr',
      reasons: ['open PR'],
      labelDrift: null,
      lenses: { L1_openPr: true, L2_unmergedBranch: false, L3_issueOpen: false, L4_phaseLabel: null },
    }]);

    const withOpenPr = await discoverResourceAllocatedIssues();

    expect(withOpenPr.map((issue) => issue.issueId)).toEqual(['PAN-2054']);
    expect(withOpenPr[0]?.resourceSources).toContain('pr');
    expect(withOpenPr[0]?.pipelineBucket).toBe('zombie_pr');
  });
});

describe('resource-discovery planned backlog annotation', () => {
  it('marks only spec-lens planned backlog rows as spec-only planned', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-2822', title: 'Spec-only planned', state: 'open', rawTrackerState: 'OPEN' },
      { identifier: 'PAN-2823', title: 'Branch-backed planned', state: 'open', rawTrackerState: 'OPEN' },
      { identifier: 'PAN-2824', title: 'Active work', state: 'in_progress', rawTrackerState: 'In Progress' },
    ]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed([
      'agent-pan-2822',
      'agent-pan-2823',
      'agent-pan-2824',
    ]));
    mocks.getPipelineMembershipForProjects.mockResolvedValue([
      membership('PAN-2822', 'planned_backlog', [PLANNED_BACKLOG_SPEC_ONLY_REASON]),
      membership('PAN-2823', 'planned_backlog', [
        'open issue with an unmerged convention branch (feature/ or strike/) but no PR — needs a PR or disposition',
      ]),
      membership('PAN-2824', 'in_flight', ['open issue with an open PR — active work']),
    ]);

    const discovered = await discoverResourceAllocatedIssues();
    const annotations = Object.fromEntries(
      discovered.map((issue) => [issue.issueId, issue.specOnlyPlanned]),
    );

    expect(annotations).toEqual({
      'PAN-2822': true,
      'PAN-2823': false,
      'PAN-2824': false,
    });
  });
});

describe('resource-discovery mixed tracker projects', () => {
  it('admits a live GitLab-only project resource when canonical membership is unavailable', async () => {
    const overdeckProject = { name: 'overdeck', path: '/tmp/overdeck', issue_prefix: 'PAN', github_repo: 'eltmon/overdeck' };
    const mynProject = { name: 'mind-your-now', path: '/tmp/myn', issue_prefix: 'MIN', gitlab_repo: 'eltmon/mind-your-now' };
    mocks.listProjectsSync.mockReturnValue([
      { key: 'overdeck', config: overdeckProject },
      { key: 'mind-your-now', config: mynProject },
    ]);
    mocks.resolveProjectFromIssueSync.mockImplementation((issueId: string) => issueId.startsWith('MIN-')
      ? { projectKey: 'mind-your-now', projectName: 'mind-your-now', projectPath: '/tmp/myn' }
      : { projectKey: 'overdeck', projectName: 'overdeck', projectPath: '/tmp/overdeck' });
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-1966', title: 'GitHub work', state: 'open', rawTrackerState: 'OPEN' },
      { identifier: 'MIN-1', title: 'Linear work', state: 'open', rawTrackerState: 'Started' },
    ]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-pan-1966', 'agent-min-1']));
    mocks.getPipelineMembershipForProjects.mockImplementation(async (configs: Array<{ path: string }>) => {
      if (configs[0]?.path === mynProject.path) throw new Error('membership unavailable');
      return [{
        issueId: 'PAN-1966', inPipeline: true, bucket: 'in_flight', reasons: ['open issue'], labelDrift: null,
        lenses: { L1_openPr: false, L2_unmergedBranch: false, L3_issueOpen: true, L4_phaseLabel: null },
      }];
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((issue) => issue.issueId)).toEqual(['MIN-1', 'PAN-1966']);
    expect(discovered.find((issue) => issue.issueId === 'MIN-1')).toMatchObject({
      projectName: 'mind-your-now',
      pipelineBucket: undefined,
      resourceDrift: undefined,
    });
  });

  it('does not treat resolved empty membership as unavailable', async () => {
    const project = {
      name: 'mind-your-now', path: '/tmp/myn', issue_prefix: 'MIN', gitlab_repo: 'eltmon/mind-your-now',
    };
    mocks.listProjectsSync.mockReturnValue([{ key: 'mind-your-now', config: project }]);
    mocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'mind-your-now', projectName: 'mind-your-now', projectPath: '/tmp/myn',
    });
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'MIN-1', title: 'Linear work', state: 'open', rawTrackerState: 'Started' },
    ]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['agent-min-1']));
    mocks.getPipelineMembershipForProjects.mockResolvedValue([]);

    await expect(discoverResourceAllocatedIssues()).resolves.toEqual([]);
  });
});

describe('resource-discovery review-status batching', () => {
  it('loads review status annotations but excludes tracker-state-only candidates', async () => {
    const terminalIssues = Array.from({ length: 1000 }, (_, index) => ({
      identifier: `PAN-${10_000 + index}`,
      title: `Terminal ${index}`,
      state: 'closed',
      rawTrackerState: 'CLOSED',
    }));
    const activeIssues = Array.from({ length: 10 }, (_, index) => ({
      identifier: `PAN-${20_000 + index}`,
      title: `Active ${index}`,
      state: 'in_progress',
      rawTrackerState: 'In Progress',
    }));
    mocks.issueService.getIssues.mockReturnValue([...terminalIssues, ...activeIssues]);

    const discovered = await discoverResourceAllocatedIssues();

    const activeIds = activeIssues.map((issue) => issue.identifier);
    expect(mocks.loadReadyForMergeFlags).toHaveBeenCalledTimes(1);
    expect(mocks.loadReadyForMergeFlags).toHaveBeenCalledWith(activeIds);
    expect(discovered).toEqual([]);
  });

  it('loads ready-for-merge status for a terminal issue that still has an open PR', async () => {
    mocks.getPipelineMembershipForProjects.mockResolvedValue([membership('PAN-2054', 'zombie_pr')]);
    mocks.issueService.getIssues.mockReturnValue([
      {
        identifier: 'PAN-2054',
        title: 'Closed with open PR',
        state: 'closed',
        rawTrackerState: 'CLOSED',
      },
    ]);
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
    mocks.loadReadyForMergeFlags.mockReturnValue(new Map([['PAN-2054', true]]));

    const discovered = await discoverResourceAllocatedIssues();

    expect(mocks.loadReadyForMergeFlags).toHaveBeenCalledWith(['PAN-2054']);
    expect(discovered.map((issue) => issue.issueId)).toEqual(['PAN-2054']);
    expect(discovered[0]?.readyForMerge).toBe(true);
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

describe('resource-discovery branch-ahead signal', () => {
  beforeEach(() => {
    resetResourceAllocatedIssuesCacheForTests();
    mocks.execFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, result?: { stdout: string }) => void) => {
      if (command === 'git' && args[0] === 'for-each-ref') {
        const isNoMerged = args.includes('--no-merged=main');
        const branches = isNoMerged
          ? [
              'feature/pan-9002', 'feature/pan-9003', 'bypass/pan-9002',
              'origin/feature/pan-9002', 'origin/feature/pan-9003', 'origin/bypass/pan-9002',
            ]
          : [
              'feature/pan-9001', 'feature/pan-9002', 'feature/pan-9003', 'bypass/pan-9002',
              'origin/feature/pan-9001', 'origin/feature/pan-9002', 'origin/feature/pan-9003', 'origin/bypass/pan-9002',
            ];
        callback(null, { stdout: `${branches.join('\n')}\n` });
        return;
      }
      if (command === 'gh' && args[0] === 'pr') {
        callback(null, { stdout: JSON.stringify(mocks.openPullRequests) });
        return;
      }
      callback(null, { stdout: '' });
    });
  });

  it('records branchAheadOfMain true for a bypass branch with unmerged work', async () => {
    mocks.getPipelineMembershipForProjects.mockResolvedValue([membership('PAN-9002')]);
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9002', title: 'Bypass', state: 'in_progress', rawTrackerState: 'In Progress' },
    ]);

    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9002');

    expect(issue).toBeDefined();
    expect(issue!.resourceSources).toContain('branch');
    expect(issue!.resourceDetails.branchAheadOfMain).toBe(true);
    expect(issue!.resourceDetails.localBranchCount).toBe(2);
    expect(mocks.execFile.mock.calls.filter(([command, args]) =>
      command === 'git' && args[0] === 'for-each-ref')).toHaveLength(2);
  });

  it('records branchAheadOfMain false for a feature branch fully merged into main', async () => {
    mocks.getPipelineMembershipForProjects.mockResolvedValue([membership('PAN-9001')]);
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9001', title: 'Merged', state: 'in_progress', rawTrackerState: 'In Progress' },
    ]);

    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9001');

    expect(issue).toBeDefined();
    expect(issue!.resourceSources).toContain('branch');
    expect(issue!.resourceDetails.branchAheadOfMain).toBe(false);
  });

  it('admits an inactive issue when a branch is ahead of main (PAN-2602)', async () => {
    mocks.getPipelineMembershipForProjects.mockResolvedValue([membership('PAN-9003')]);
    resetResourceAllocatedIssuesCacheForTests();
    // Re-use the branch mock but give the issue a non-active tracker state.
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9003', title: 'Inactive with branch', state: 'open', rawTrackerState: 'OPEN' },
    ]);

    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9003');

    expect(issue).toBeDefined();
    expect(issue!.resourceSources).toContain('branch');
    expect(issue!.resourceDetails.branchAheadOfMain).toBe(true);
  });
});

describe('resource-discovery conversation signal', () => {
  beforeEach(() => {
    resetResourceAllocatedIssuesCacheForTests();
  });

  function makeConversation(overrides: Partial<{ issueId: string | null; archivedAt: string | null; status: string }>): unknown {
    return {
      id: 1,
      name: 'conv-pan-9003',
      tmuxSession: 'conv-pan-9003',
      status: 'active',
      cwd: '/tmp/overdeck',
      issueId: 'PAN-9003',
      createdAt: '2026-07-01T00:00:00Z',
      endedAt: null,
      lastAttachedAt: null,
      claudeSessionId: null,
      title: 'Conversation title',
      titleSource: null,
      titleSeed: null,
      totalCost: 0,
      totalTokens: 0,
      archivedAt: null,
      model: null,
      effort: null,
      forkStatus: null,
      forkError: null,
      harness: null,
      deliveryMethod: null,
      spawnError: null,
      handoffDocPath: null,
      handoffTargetConvId: null,
      forkFallbackReason: null,
      clearedToConvId: null,
      forkRequest: null,
      forkRetryCount: 0,
      ...overrides,
    };
  }

  it('tags a non-archived conversation with an issueId as a conversation resource source', async () => {
    mocks.getPipelineMembershipForProjects.mockResolvedValue([membership('PAN-9003')]);
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9003', title: 'Conv issue', state: 'in_progress', rawTrackerState: 'In Progress' },
    ]);
    mocks.listConversations.mockReturnValue([makeConversation({})]);

    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9003');

    expect(issue).toBeDefined();
    expect(issue!.resourceSources).toContain('conversation');
    expect(issue!.resourceDetails.conversations).toEqual([
      { id: 1, name: 'conv-pan-9003', title: 'Conversation title', status: 'active' },
    ]);
  });

  it('ignores conversations with a null issueId', async () => {
    mocks.listConversations.mockReturnValue([makeConversation({ issueId: null })]);

    const discovered = await discoverResourceAllocatedIssues();
    expect(discovered.map((entry) => entry.issueId)).toEqual([]);
  });

  it('does not let a linked conversation override a clean resolver verdict', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9003', title: 'Conv issue inactive', state: 'open', rawTrackerState: 'OPEN' },
    ]);
    mocks.listConversations.mockReturnValue([makeConversation({})]);

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered).toEqual([]);
  });
});

describe('resource-discovery PRD signal', () => {
  beforeEach(() => {
    resetResourceAllocatedIssuesCacheForTests();
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9004', title: 'PRD issue', state: 'open', rawTrackerState: 'OPEN' },
    ]);
    mocks.getPipelineMembershipForProjects.mockResolvedValue([membership('PAN-9004', 'planned')]);
  });

  it('adds the canonical PRD source and detail flag when a draft exists', async () => {
    mocks.findDraftPrd.mockReturnValue(Effect.succeed({
      path: '/state/drafts/PAN-9004.md',
      format: 'pan-draft',
      status: 'draft',
    }));

    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9004');

    expect(issue?.resourceSources).toEqual(expect.arrayContaining(['tracker', 'prd']));
    expect(issue?.resourceDetails.hasPrd).toBe(true);
    expect(issue?.hasPrd).toBe(true);
  });

  it('omits the PRD source and reports false when no draft exists', async () => {
    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9004');

    expect(issue?.resourceSources).toContain('tracker');
    expect(issue?.resourceSources).not.toContain('prd');
    expect(issue?.resourceDetails.hasPrd).toBe(false);
  });
});

describe('resource-discovery xbrief recency signal', () => {
  beforeEach(() => {
    resetResourceAllocatedIssuesCacheForTests();
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9005', title: 'Xbrief recency issue', state: 'open', rawTrackerState: 'OPEN' },
    ]);
    mocks.findSpecByIssue.mockReturnValue(Effect.succeed({ path: '/state/specs/pan-9005.xbrief.json' }));
  });

  it('admits an inactive issue when its xBRIEF spec was touched recently', async () => {
    mocks.getPipelineMembershipForProjects.mockResolvedValue([{
      issueId: 'PAN-9005', inPipeline: true, bucket: 'planned', reasons: ['xBRIEF spec'], labelDrift: null,
      lenses: { L1_openPr: false, L2_unmergedBranch: false, L3_issueOpen: true, L4_phaseLabel: null },
    }]);
    mocks.readdir.mockImplementation(async (path: string, options?: { withFileTypes?: boolean }) => {
      if (typeof path === 'string' && path.endsWith('/workspaces') && options?.withFileTypes) {
        return [{ name: 'feature-pan-9005', isDirectory: () => true }];
      }
      return [];
    });
    mocks.stat.mockResolvedValue({ mtimeMs: Date.parse('2026-07-12T00:00:00Z') } as any);

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual(['PAN-9005']);
    expect(discovered[0]?.resourceSources).toContain('vbrief');
  });

  it('excludes stale xBRIEF residue when the resolver reports no pipeline membership', async () => {
    mocks.readdir.mockImplementation(async (path: string, options?: { withFileTypes?: boolean }) => {
      if (typeof path === 'string' && path.endsWith('/workspaces') && options?.withFileTypes) {
        return [{ name: 'feature-pan-9005', isDirectory: () => true }];
      }
      return [];
    });
    mocks.stat.mockResolvedValue({ mtimeMs: Date.parse('2026-06-20T00:00:00Z') } as any);

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered).toEqual([]);
  });
});

describe('resource-discovery cache test hooks', () => {
  it('allows cache state to be reset between tests', () => {
    expect(() => resetResourceAllocatedIssuesCacheForTests()).not.toThrow();
  });
});

describe('resource-discovery workspaces resolver (PAN-1990)', () => {
  it('prefers the workspaces resolver over the directory scan when rows exist for the project', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9010', title: 'Resolver-backed issue', state: 'open', rawTrackerState: 'OPEN' },
    ]);
    mocks.getPipelineMembershipForProjects.mockResolvedValue([
      membership('PAN-9010'),
    ]);
    mocks.listWorkspaces.mockReturnValue([
      {
        id: 'ws-uuid-1', projectId: 'overdeck', kind: 'issue', name: 'feature-pan-9010',
        path: '/tmp/overdeck/workspaces/feature-pan-9010', branchName: 'feature/pan-9010',
        parentBranch: null, parentBranchGuessed: false, isGitRepository: true,
        issueId: 'PAN-9010', layoutConfig: null, isFavorite: false, isArchived: false,
        title: null, createdAt: 0, lastAccessedAt: 0,
      },
    ]);
    mocks.readdir.mockImplementation(async (path: string) => {
      if (typeof path === 'string' && path.endsWith('/workspaces')) {
        throw new Error('directory scan must not run when the resolver has rows');
      }
      return [];
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual(['PAN-9010']);
    expect(discovered[0]?.resourceSources).toContain('workspace');
  });

  it('falls back to the directory scan when the resolver has no rows for the project', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9011', title: 'Fallback issue', state: 'open', rawTrackerState: 'OPEN' },
    ]);
    mocks.getPipelineMembershipForProjects.mockResolvedValue([
      membership('PAN-9011'),
    ]);
    mocks.listWorkspaces.mockReturnValue([]); // not yet backfilled for this project
    mocks.readdir.mockImplementation(async (path: string, options?: { withFileTypes?: boolean }) => {
      if (typeof path === 'string' && path.endsWith('/workspaces') && options?.withFileTypes) {
        return [{ name: 'feature-pan-9011', isDirectory: () => true }];
      }
      return [];
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual(['PAN-9011']);
    expect(discovered[0]?.resourceSources).toContain('workspace');
  });
});
