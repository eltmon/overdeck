import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReviewStatus: Record<string, any> = {};
const mockCalls = {
  setReviewStatus: [] as Array<[issueId: string, update: any]>,
  completePendingOperation: [] as Array<[issueId: string, detail: unknown]>,
  mergeReviewArtifact: [] as Array<unknown>,
};

const { execFileImpl, execImpl, existsSyncImpl, mockShouldSkipDispatchAsMerged, mockFindSpecByIssue, mockResolveGitHubIssueSync } = vi.hoisted(() => ({
  execFileImpl: vi.fn(),
  execImpl: vi.fn(),
  existsSyncImpl: vi.fn(() => true),
  mockShouldSkipDispatchAsMerged: vi.fn(),
  mockFindSpecByIssue: vi.fn(() => Effect.succeed({ status: 'active' })),
  mockResolveGitHubIssueSync: vi.fn(() => ({ isGitHub: true, owner: 'eltmon', repo: 'overdeck' })),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncImpl,
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  execFileImpl[Symbol.for('nodejs.util.promisify.custom')] = execFileImpl;
  execImpl[Symbol.for('nodejs.util.promisify.custom')] = execImpl;
  return {
    ...actual,
    exec: execImpl,
    execFile: execFileImpl,
  };
});

vi.mock('../../../../../src/lib/agents.js', () => ({
  messageAgent: vi.fn(),
  getAgentState: vi.fn(() => Effect.succeed(null)),
  getAgentStateSync: vi.fn(() => null),
  getAgentRuntimeStateSync: vi.fn(),
  listRunningAgentsSync: vi.fn(() => []),
  spawnAgent: vi.fn(),
  spawnRun: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
}));

vi.mock('../../../../../src/lib/beads-query.js', () => ({
  queryBeadsForIssue: vi.fn(() => []),
}));

vi.mock('../../../../../src/lib/cloister/merge-agent.js', () => ({
  syncMainIntoWorkspace: vi.fn(),
  postMergeLifecycle: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../../../../../src/lib/git/operations.js', () => ({
  gitPush: vi.fn(),
  MainDivergedError: class MainDivergedError extends Error {},
}));

vi.mock('../../../../../src/lib/git-activity.js', () => ({
  listGitOperationsSync: vi.fn(() => []),
}));

vi.mock('../../../../../src/lib/overdeck/merge.js', () => {
  const queue: string[] = [];
  return {
    enqueueMerge: vi.fn((_projectKey: string, issueId: string) => { queue.push(issueId); return queue.length; }),
    getCurrentMerge: vi.fn(() => null),
    markMergeProcessing: vi.fn(),
    dequeueMerge: vi.fn(),
    getAllActiveQueues: vi.fn(() => []),
  };
});

vi.mock('../../../../../src/lib/projects.js', () => ({
  findProjectByTeamSync: vi.fn(() => ({ root: '/tmp/project', key: 'pan' })),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectPath: '/tmp/project', key: 'pan' })),
}));

vi.mock('../../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn((issueId: string) => mockReviewStatus[issueId] ?? null),
  loadReviewStatuses: vi.fn(() => mockReviewStatus),
  setReviewStatusSync: vi.fn((issueId: string, update: any) => {
    mockReviewStatus[issueId] = { ...(mockReviewStatus[issueId] ?? {}), ...update };
  }),
  reviewGatesPassedSync: vi.fn(() => false),
  markWorkspaceStuck: vi.fn(),
}));

vi.mock('../../../../../src/lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: vi.fn(() => ({ hasLiveTmuxSession: true })),
}));

vi.mock('../../../../../src/lib/vbrief/io.js', () => ({
  findPlan: vi.fn(),
}));

vi.mock('../../../../../src/lib/github-app.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/github-app.js')>();
  return {
    ...actual,
    isGitHubAppConfigured: vi.fn(() => false),
    getPullRequestState: vi.fn(() => Effect.succeed({
      state: 'OPEN',
      merged: false,
      mergeable: true,
      mergeableState: 'clean',
      draft: false,
      headSha: 'abc1234',
      baseBranch: 'main',
      checksPending: false,
      checksFailed: false,
    })),
    verifyAppCanMerge: vi.fn(async () => ({
      configured: true,
      canMerge: false,
      missing: ['contents:write'],
      detail: 'Missing contents:write',
    })),
  };
});

vi.mock('../../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: vi.fn(),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn(() => Effect.succeed(false)),
  sessionExistsSync: vi.fn(() => false),
  sendKeysAsync: vi.fn(),
  sendKeys: vi.fn(),
  killSession: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock('../../../../../src/lib/cloister/merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: (...args: Parameters<typeof mockShouldSkipDispatchAsMerged>) => mockShouldSkipDispatchAsMerged(...args),
  verifyMergedBeforeLifecycle: vi.fn(),
}));

vi.mock('../../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: vi.fn(async () => false),
}));

vi.mock('../../../../../src/lib/pan-dir/specs.js', () => ({
  findSpecByIssue: (...args: Parameters<typeof mockFindSpecByIssue>) => mockFindSpecByIssue(...args),
}));

vi.mock('../../../../../src/lib/concurrency.js', () => ({
  withConcurrencyLimit: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../../../../src/dashboard/server/services/merge-queue-service.js', () => ({
  setMergeQueueTriggerHandler: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/services/domain-services.js', () => ({
  EventStoreService: { Default: 'EventStoreService' },
}));

vi.mock('../../../../../src/dashboard/server/http-helpers.js', () => ({
  jsonResponse: vi.fn((body: unknown) => body),
}));

vi.mock('../../../../../src/dashboard/server/routes/http-handler.js', () => ({
  httpHandler: vi.fn((handler: any) => handler),
}));

vi.mock('../../../../../src/dashboard/server/routes/specialists.js', () => ({
  _serverManagedMerges: new Set<string>(),
}));

vi.mock('../../../../../src/dashboard/server/routes/workspaces.js', () => ({
  completePendingOperation: vi.fn((issueId: string, detail: unknown) => {
    mockCalls.completePendingOperation.push([issueId, detail]);
  }),
  getPendingOperation: vi.fn(() => null),
  getProjectPath: vi.fn(() => '/tmp/project'),
  getWorkspaceInfoForIssue: vi.fn(() => ({
    isRemote: false,
    localPath: '/tmp/project/workspaces/feature-pan-2420',
  })),
  readJsonBody: vi.fn(),
  setPendingOperation: vi.fn(),
  setReviewStatus: vi.fn((issueId: string, update: any) => {
    mockCalls.setReviewStatus.push([issueId, update]);
    mockReviewStatus[issueId] = { ...(mockReviewStatus[issueId] ?? {}), ...update };
  }),
}));

vi.mock('../../../../../src/lib/merge-set.js', () => ({
  getMergeSetSync: vi.fn(() => null),
  ensureMergeSetForIssueSync: vi.fn(() => ({
    repos: [{
      repoKey: 'overdeck',
      targetBranch: 'main',
      forge: 'github',
    }],
  })),
  upsertMergeSetSync: vi.fn(),
  withRepoStateSync: vi.fn((mergeSet: any) => mergeSet),
}));

vi.mock('../../../../../src/lib/forge.js', () => ({
  getForgeAdapter: vi.fn(() => ({
    mergeReviewArtifact: vi.fn(async (input: any) => {
      mockCalls.mergeReviewArtifact.push(input);
      throw new Error('GitHub merge failed: 403 {"message":"Resource not accessible by integration"}');
    }),
    commentOnArtifact: vi.fn(),
  })),
}));

vi.mock('../../../../../src/lib/cloister/verification-runner.js', () => ({
  runVerificationForIssue: vi.fn(() => Effect.succeed({ outcome: 'passed' })),
}));

vi.mock('../../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../../../../src/lib/paths.js', () => ({
  AGENTS_DIR: '/tmp/agents',
  OVERDECK_HOME: '/tmp/overdeck',
}));

vi.mock('../../../../../src/lib/cloister/agent-idle.js', () => ({
  isAgentIdleForNudge: vi.fn(() => false),
}));

vi.mock('../../../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({})),
  loadCloisterConfigSync: vi.fn(() => ({})),
}));

vi.mock('../../../../../src/lib/cloister/deacon-canonical-state.js', () => ({
  getAutoCloseOutCanonicalState: vi.fn(() => null),
  sweepAutoCloseOutCache: vi.fn(),
}));

vi.mock('../../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: (...args: Parameters<typeof mockResolveGitHubIssueSync>) => mockResolveGitHubIssueSync(...args),
}));

import { reconcileStaleMergeStatus } from '../../../../../src/lib/cloister/deacon-merge.js';
import { postMergeLifecycle } from '../../../../../src/lib/cloister/merge-agent.js';
import { triggerMerge } from '../../../../../src/dashboard/server/routes/workspaces/merge-ops.js';

describe('PAN-2420 end-to-end: 403 permission failure then out-of-band merge terminalizes with no respawn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveGitHubIssueSync.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'overdeck' });
    Object.keys(mockReviewStatus).forEach(key => delete mockReviewStatus[key]);
    mockCalls.setReviewStatus.length = 0;
    mockCalls.completePendingOperation.length = 0;
    mockCalls.mergeReviewArtifact.length = 0;

    // Default execFile behavior: gh pr view returns PR URL; git commands succeed.
    execFileImpl.mockImplementation((cmd: string, args: string[]) => {
      const joined = `${cmd} ${args.join(' ')}`;
      if (joined.includes('gh pr view')) {
        return Promise.resolve({ stdout: 'https://github.com/eltmon/overdeck/pull/2420\n' });
      }
      if (joined.includes('git rev-parse')) {
        return Promise.resolve({ stdout: 'abc1234\n' });
      }
      if (joined.includes('git merge-base')) {
        return Promise.resolve({ stdout: '' });
      }
      return Promise.resolve({ stdout: '' });
    });
    execImpl.mockResolvedValue({ stdout: '' });
  });

  it('records merge_status=failed with mergeNotes naming the missing scope on 403 permission error', async () => {
    mockReviewStatus['pan-2420'] = {
      readyForMerge: true,
      mergeStatus: 'ready',
      prUrl: 'https://github.com/eltmon/overdeck/pull/2420',
    };

    const result = await triggerMerge('pan-2420');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain('contents:write');

    const failedUpdate = mockCalls.setReviewStatus.find(([, update]) => update.mergeStatus === 'failed');
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate![1].mergeNotes).toContain('contents:write');
    expect(failedUpdate![1].mergeNotes).toContain('Grant these scopes');
    expect(failedUpdate![1].readyForMerge).toBe(false);

    const completed = mockCalls.completePendingOperation.find(([id]) => id === 'pan-2420');
    expect(completed?.[1]).toContain('contents:write');
  });

  it('reconciler terminalizes the issue when GitHub confirms the PR merged out-of-band', async () => {
    mockReviewStatus['pan-2421'] = { mergeStatus: 'failed', readyForMerge: false };

    execFileImpl.mockImplementation((cmd: string, args: string[]) => {
      const joined = `${cmd} ${args.join(' ')}`;
      if (joined.includes('gh pr list')) {
        return Promise.resolve({
          stdout: JSON.stringify([{
            number: 2421,
            mergedAt: '2026-07-06T20:00:00Z',
            mergeCommit: { sha: 'def5678' },
          }]),
        });
      }
      if (joined.includes('git rev-parse')) {
        return Promise.resolve({ stdout: 'abc1234\n' });
      }
      return Promise.resolve({ stdout: '' });
    });

    const actions = await reconcileStaleMergeStatus();

    expect(actions.some(a => a.includes('Reconciled stale mergeStatus'))).toBe(true);
    expect(mockReviewStatus['pan-2421'].mergeStatus).toBe('merged');
    expect(postMergeLifecycle).toHaveBeenCalledWith(
      'pan-2421',
      '/tmp/project',
      'feature/pan-2421',
      { skipDeploy: true },
    );
  });
});
