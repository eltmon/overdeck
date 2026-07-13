import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  findSpecByIssue: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getBeadsRollupService: vi.fn(),
  getGitHubConfig: vi.fn(),
  issueService: {
    getIssues: vi.fn(),
  },
  listProjectsSync: vi.fn(),
  listSessionNames: vi.fn(),
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

vi.mock('node:fs/promises', () => ({
  readdir: mocks.readdir,
  stat: mocks.stat,
}));

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: mocks.getAgentRuntimeState,
}));

vi.mock('../../../../../src/dashboard/server/services/beads-rollup-singleton.js', () => ({
  getBeadsRollupService: mocks.getBeadsRollupService,
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNames: mocks.listSessionNames,
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
  mocks.loadReadyForMergeFlags.mockReturnValue(new Map());
  mocks.listProjectsSync.mockReturnValue([
    { key: 'overdeck', config: { name: 'overdeck', path: '/tmp/overdeck', issue_prefix: 'PAN' } },
  ]);
  mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
  mocks.listConversations.mockReturnValue([]);
  mocks.openPullRequests = [];
  mocks.getBeadsRollupService.mockReturnValue({ getProjectRollups: () => null });
  mocks.readdir.mockResolvedValue([]);
  mocks.stat.mockRejectedValue(new Error('no such file'));
  mocks.findSpecByIssue.mockReturnValue(Effect.fail('no spec'));
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
          branchAheadOfMain: false,
          conversations: [],
        },
        beadTotals: null,
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
          branchAheadOfMain: false,
          conversations: [],
        },
        beadTotals: null,
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
          branchAheadOfMain: false,
          conversations: [],
        },
        beadTotals: null,
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
          branchAheadOfMain: false,
          conversations: [],
        },
        beadTotals: null,
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

describe('resource-discovery review-status batching', () => {
  it('loads review status only for active tree candidates instead of every terminal tracker issue', async () => {
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
    expect(discovered.map((issue) => issue.issueId)).toEqual(activeIds);
  });

  it('loads ready-for-merge status for a terminal issue that still has an open PR', async () => {
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
        const ref = args[1] ?? '';
        if (ref.includes('feature/*')) {
          callback(null, { stdout: 'feature/pan-9001\nfeature/pan-9002\nfeature/pan-9003\n' });
        } else if (ref.includes('bypass/*')) {
          callback(null, { stdout: 'bypass/pan-9002\n' });
        } else {
          callback(null, { stdout: '' });
        }
        return;
      }
      if (command === 'git' && args[0] === 'merge-base') {
        const branch = args[2];
        // pan-9001 is fully merged into main; everything else is ahead.
        if (branch === 'feature/pan-9001') {
          callback(null, { stdout: '' });
        } else {
          callback(new Error('not an ancestor'), { stdout: '' });
        }
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
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9002', title: 'Bypass', state: 'in_progress', rawTrackerState: 'In Progress' },
    ]);

    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9002');

    expect(issue).toBeDefined();
    expect(issue!.resourceSources).toContain('branch');
    expect(issue!.resourceDetails.branchAheadOfMain).toBe(true);
    expect(issue!.resourceDetails.localBranchCount).toBe(2);
  });

  it('records branchAheadOfMain false for a feature branch fully merged into main', async () => {
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
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9003', title: 'Conv issue', state: 'in_progress', rawTrackerState: 'In Progress' },
    ]);
    mocks.listConversations.mockReturnValue([makeConversation({})]);

    const discovered = await discoverResourceAllocatedIssues();
    const issue = discovered.find((entry) => entry.issueId === 'PAN-9003');

    expect(issue).toBeDefined();
    expect(issue!.resourceSources).toContain('conversation');
    expect(issue!.resourceDetails.conversations).toEqual([
      { title: 'Conversation title', status: 'active' },
    ]);
  });

  it('ignores conversations with a null issueId', async () => {
    mocks.listConversations.mockReturnValue([makeConversation({ issueId: null })]);

    const discovered = await discoverResourceAllocatedIssues();
    expect(discovered.map((entry) => entry.issueId)).toEqual([]);
  });

  it('admits an inactive issue when it has a linked conversation (PAN-2602)', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9003', title: 'Conv issue inactive', state: 'open', rawTrackerState: 'OPEN' },
    ]);
    mocks.listConversations.mockReturnValue([makeConversation({})]);

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual(['PAN-9003']);
    expect(discovered[0]?.resourceSources).toContain('conversation');
  });
});

describe('resource-discovery bead rollup signal', () => {
  beforeEach(() => {
    resetResourceAllocatedIssuesCacheForTests();
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9004', title: 'Bead rollup issue', state: 'open', rawTrackerState: 'OPEN' },
    ]);
  });

  function setBeadRollups(
    rollups: Record<string, { total: number; closed: number; inProgress: number; lastUpdated: string | null }>,
  ) {
    mocks.getBeadsRollupService.mockReturnValue({
      getProjectRollups: () => ({ rollups: new Map(Object.entries(rollups)), stale: false }),
    });
  }

  it('admits an inactive issue with recent partial bead completion', async () => {
    setBeadRollups({
      'pan-9004': { total: 3, closed: 1, inProgress: 0, lastUpdated: '2026-07-12T00:00:00Z' },
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual(['PAN-9004']);
    expect(discovered[0]?.beadTotals).toEqual({
      total: 3,
      closed: 1,
      inProgress: 0,
      lastUpdated: '2026-07-12T00:00:00Z',
    });
  });

  it('excludes an inactive issue when beads are fully closed', async () => {
    setBeadRollups({
      'pan-9004': { total: 3, closed: 3, inProgress: 0, lastUpdated: '2026-07-12T00:00:00Z' },
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual([]);
  });

  it('excludes an inactive issue when partial bead completion is stale', async () => {
    setBeadRollups({
      'pan-9004': { total: 3, closed: 1, inProgress: 0, lastUpdated: '2026-06-20T00:00:00Z' },
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual([]);
  });

  it('admits an inactive issue with in-progress beads', async () => {
    setBeadRollups({
      'pan-9004': { total: 2, closed: 0, inProgress: 1, lastUpdated: '2026-06-20T00:00:00Z' },
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual(['PAN-9004']);
    expect(discovered[0]?.beadTotals?.inProgress).toBe(1);
  });

  it('does not admit a terminal issue even with recent partial bead completion', async () => {
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9004', title: 'Bead rollup issue', state: 'closed', rawTrackerState: 'CLOSED' },
    ]);
    setBeadRollups({
      'pan-9004': { total: 3, closed: 1, inProgress: 0, lastUpdated: '2026-07-12T00:00:00Z' },
    });

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual([]);
  });
});

describe('resource-discovery vbrief recency signal', () => {
  beforeEach(() => {
    resetResourceAllocatedIssuesCacheForTests();
    mocks.issueService.getIssues.mockReturnValue([
      { identifier: 'PAN-9005', title: 'Vbrief recency issue', state: 'open', rawTrackerState: 'OPEN' },
    ]);
    mocks.findSpecByIssue.mockReturnValue(Effect.succeed({ path: '/state/specs/pan-9005.vbrief.json' }));
  });

  it('admits an inactive issue when its vBRIEF spec was touched recently', async () => {
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

  it('excludes an inactive issue when its vBRIEF spec is stale', async () => {
    mocks.readdir.mockImplementation(async (path: string, options?: { withFileTypes?: boolean }) => {
      if (typeof path === 'string' && path.endsWith('/workspaces') && options?.withFileTypes) {
        return [{ name: 'feature-pan-9005', isDirectory: () => true }];
      }
      return [];
    });
    mocks.stat.mockResolvedValue({ mtimeMs: Date.parse('2026-06-20T00:00:00Z') } as any);

    const discovered = await discoverResourceAllocatedIssues();

    expect(discovered.map((entry) => entry.issueId)).toEqual([]);
  });
});

describe('resource-discovery cache test hooks', () => {
  it('allows cache state to be reset between tests', () => {
    expect(() => resetResourceAllocatedIssuesCacheForTests()).not.toThrow();
  });
});
