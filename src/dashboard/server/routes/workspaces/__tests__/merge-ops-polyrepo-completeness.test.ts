import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  completePendingOperation: vi.fn(),
  discoverArtifact: vi.fn(),
  exec: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  findMergedArtifact: vi.fn(),
  mergeReviewArtifact: vi.fn(),
  mergeSet: null as any,
  postMergeLifecycle: vi.fn(),
  setMergeRun: vi.fn(),
  upsertMergeSet: vi.fn(),
}));

// PAN-3917: config-yaml's defaults import lib/agents/tier-table, which still
// reaches the record plane W3 is deleting. Stub the one constant it needs.
// lib/agents pulls agents/spawn, which imports the removed `state-home`.
vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
}));
vi.mock('../../../../../lib/git-activity.js', () => ({ listGitOperationsSync: vi.fn(() => []) }));
vi.mock('../../../../../lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));

vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    mocks.exec(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (exec as any)[kCustom] = mocks.exec;
  return {
    exec,
    execFile: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('../../../../../lib/cloister/merge-agent.js', () => ({
  postMergeLifecycle: mocks.postMergeLifecycle,
  syncMainIntoWorkspace: vi.fn(),
}));

vi.mock('../../../../../lib/overdeck/merge.js', () => ({
  dequeueMerge: vi.fn(() => null),
  enqueueMerge: vi.fn(() => 1),
  getAllActiveQueues: vi.fn(() => []),
  getCurrentMerge: vi.fn(() => null),
  markMergeProcessing: vi.fn(),
}));

vi.mock('../../../../../lib/projects.js', () => ({
  findProjectByTeamSync: vi.fn(() => ({
    workspace: {
      type: 'polyrepo',
      repos: [
        { name: 'repo-a', path: 'repo-a' },
        { name: 'repo-b', path: 'repo-b' },
      ],
    },
    quality_gates: {},
  })),
  findProjectByPathSync: vi.fn(() => null),
  listProjectsSync: vi.fn(() => []),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/project' })),
}));

// PAN-3917: merge readiness is the forge's answer, not a review-status record.
vi.mock('../../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: vi.fn(async (issueId: string) => ({
    issueId,
    state: 'ready',
    pr: { url: 'https://github.com/eltmon/overdeck/pull/1', number: 1, reviewState: 'approved', checks: 'green', mergeable: true },
  })),
}));

vi.mock('../../../../../lib/tmux.js', () => ({
  // PAN-3917 (W6): the backend inventory's tmux fallback reads the pane list
  // synchronously; these tests have no tmux server, so it reads as empty.
  listSessionsSync: () => [],
  listPaneValuesSync: () => [],
  sessionExists: vi.fn(),
}));

vi.mock('../../workspaces.js', () => ({
  completePendingOperation: mocks.completePendingOperation,
  getPendingOperation: vi.fn(() => null),
  getProjectPath: vi.fn(() => '/project'),
  getWorkspaceInfoForIssue: vi.fn(() => ({ isRemote: false, localPath: '/workspace' })),
  readJsonBody: vi.fn(),
  setPendingOperation: vi.fn(),
}));

vi.mock('../merge-strike.js', () => ({
  activeStrikeMerge: vi.fn(() => false),
  advanceMergeQueue: vi.fn(async () => {}),
  ensureAgentReadyForMerge: vi.fn(),
  forgeMergeGateRefusal: vi.fn(async () => null),
  mergeVerificationOptions: vi.fn(() => ({})),
  normalMergeEligibility: vi.fn(() => null),
  validateStrikeMergeRequest: vi.fn(() => null),
}));

vi.mock('../../specialists.js', () => ({
  _serverManagedMerges: new Set<string>(),
}));

vi.mock('../../../services/merge-queue-service.js', () => ({
  setMergeQueueAdvanceHandler: vi.fn(),
  setMergeRun: (issueId: string, patch: Record<string, unknown>) => mocks.setMergeRun(issueId, patch),
  getMergeRun: () => null,
  clearMergeRun: vi.fn(),
}));

vi.mock('../../../../../lib/merge-set.js', () => ({
  ensureMergeSetForIssueSync: vi.fn(() => mocks.mergeSet),
  getMergeSetSync: vi.fn(() => mocks.mergeSet),
  patchMergeSetRepoSync: vi.fn((_issueId: string, repoKey: string, expected: any, patch: any) => {
    const current = mocks.mergeSet?.repos.find((repo: any) => repo.repoKey === repoKey);
    if (!current
      || current.sourceBranch !== expected.sourceBranch
      || current.targetBranch !== expected.targetBranch
      || current.artifactUrl !== expected.artifactUrl
      || current.artifactId !== expected.artifactId) return false;
    mocks.mergeSet = {
      ...mocks.mergeSet,
      repos: mocks.mergeSet.repos.map((repo: any) => (
        repo.repoKey === repoKey ? { ...repo, ...patch } : repo
      )),
    };
    return true;
  }),
  patchMergeSetReposSync: vi.fn((_issueId: string, patches: any[]) => {
    const matches = patches.every(({ repoKey, expected }) => {
      const current = mocks.mergeSet?.repos.find((repo: any) => repo.repoKey === repoKey);
      return current
        && current.sourceBranch === expected.sourceBranch
        && current.targetBranch === expected.targetBranch
        && current.artifactUrl === expected.artifactUrl
        && current.artifactId === expected.artifactId;
    });
    if (!matches) return false;
    mocks.mergeSet = {
      ...mocks.mergeSet,
      repos: mocks.mergeSet.repos.map((repo: any) => {
        const planned = patches.find(({ repoKey }) => repoKey === repo.repoKey);
        return planned ? { ...repo, ...planned.patch } : repo;
      }),
    };
    return true;
  }),
  upsertMergeSetSync: (mergeSet: any) => {
    mocks.mergeSet = mergeSet;
    mocks.upsertMergeSet(mergeSet);
  },
  withRepoArtifactUrlSync: vi.fn((mergeSet: any, repoKey: string, artifactUrl: string, artifactId?: string) => ({
    ...mergeSet,
    repos: mergeSet.repos.map((repo: any) => (
      repo.repoKey === repoKey ? { ...repo, artifactUrl, artifactId } : repo
    )),
  })),
  withRepoStateSync: vi.fn((mergeSet: any, repoKey: string, patch: Record<string, unknown>) => ({
    ...mergeSet,
    repos: mergeSet.repos.map((repo: any) => (
      repo.repoKey === repoKey ? { ...repo, ...patch } : repo
    )),
  })),
}));

vi.mock('../../../../../lib/forge.js', () => ({
  getForgeAdapter: vi.fn(() => ({
    discoverArtifact: mocks.discoverArtifact,
    findMergedArtifact: mocks.findMergedArtifact,
    mergeReviewArtifact: mocks.mergeReviewArtifact,
  })),
}));

import { triggerMerge } from '../merge-ops.js';

function repo(repoKey: string, patch: Record<string, unknown> = {}) {
  return {
    repoKey,
    repoPath: `/project/${repoKey}`,
    forge: 'github',
    sourceBranch: 'feature/pan-2467',
    targetBranch: 'main',
    artifactUrl: undefined,
    artifactId: undefined,
    repoReview: 'passed',
    repoTests: 'passed',
    rebaseStatus: 'passed',
    repoVerification: 'passed',
    repoMerge: 'pending',
    mergeOrder: repoKey === 'repo-a' ? 0 : 1,
    required: true,
    ...patch,
  };
}

function mergeSet(repos: ReturnType<typeof repo>[]) {
  return {
    issueId: 'PAN-2467',
    projectKey: 'overdeck',
    projectPath: '/project',
    workspaceType: 'polyrepo',
    status: 'ready',
    createdAt: '2026-07-25T00:00:00Z',
    updatedAt: '2026-07-25T00:00:00Z',
    repos,
  };
}

describe('coordinated polyrepo merge completeness gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discoverArtifact.mockResolvedValue(null);
    mocks.findMergedArtifact.mockResolvedValue(null);
    mocks.mergeReviewArtifact.mockResolvedValue(undefined);
    mocks.exec.mockImplementation(async (command) => ({
      stdout: command.includes('rev-list --count')
        ? '2\n'
        : command.includes('rev-parse') ? 'current-head-sha\n' : '',
      stderr: '',
    }));
  });

  it('blocks the merge before lifecycle when a required sibling is stranded', async () => {
    mocks.mergeSet = mergeSet([
      repo('repo-a', { artifactUrl: 'https://github.com/org/repo-a/pull/1' }),
      repo('repo-b'),
    ]);
    mocks.exec.mockImplementation(async (command) => ({
      stdout: command.includes('rev-list --count')
        ? '2\n'
        : command.includes('rev-parse') ? 'current-head-sha\n' : '',
      stderr: '',
    }));

    const result = await triggerMerge('PAN-2467');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      statusCode: 409,
      error: expect.stringContaining('repo-b has 2 commits'),
    }));
    // PAN-3917: the blocker is reported on the merge run and in the response,
    // not written to a record as `blockerReasons`.
    expect(mocks.setMergeRun).toHaveBeenCalledWith('PAN-2467', expect.objectContaining({
      phase: 'failed',
      notes: expect.stringContaining('repo-b'),
    }));
    expect(mocks.mergeSet.status).toBe('failed');
    expect(mocks.postMergeLifecycle).not.toHaveBeenCalled();
  });

  it('completes when the remaining required repo has no changes', async () => {
    mocks.mergeSet = mergeSet([
      repo('repo-a', { repoMerge: 'skipped' }),
      repo('repo-b'),
    ]);
    mocks.exec.mockImplementation(async (command) => ({
      stdout: command.includes('rev-list --count') ? '0\n' : '',
      stderr: '',
    }));

    const result = await triggerMerge('PAN-2467');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      statusCode: 200,
      outcome: 'merged',
    }));
    expect(mocks.mergeSet.status).toBe('merged');
    expect(mocks.postMergeLifecycle).toHaveBeenCalledTimes(1);
  });

  it('self-heals a fully forge-merged set without issuing another merge request', async () => {
    mocks.mergeSet = mergeSet([
      repo('repo-a', {
        artifactUrl: 'https://github.com/org/repo-a/pull/1',
        repoMerge: 'failed',
      }),
      repo('repo-b', {
        artifactUrl: 'https://github.com/org/repo-b/pull/2',
        repoMerge: 'pending',
      }),
    ]);
    mocks.findMergedArtifact.mockImplementation(async ({ cwd }: { cwd: string }) => ({
      forge: 'github',
      created: false,
      id: cwd.endsWith('repo-a') ? '1' : '2',
      url: cwd.endsWith('repo-a')
        ? 'https://github.com/org/repo-a/pull/1'
        : 'https://github.com/org/repo-b/pull/2',
    }));

    const result = await triggerMerge('PAN-2467');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      statusCode: 200,
      message: 'No changed repos remain for PAN-2467',
      outcome: 'merged',
      repos: [],
    }));
    expect(mocks.mergeSet.repos).toEqual([
      expect.objectContaining({ repoKey: 'repo-a', repoMerge: 'merged' }),
      expect.objectContaining({ repoKey: 'repo-b', repoMerge: 'merged' }),
    ]);
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
    expect(mocks.postMergeLifecycle).toHaveBeenCalledTimes(1);
  });

  it('merges and verifies only repos that remain unmerged after forge refresh', async () => {
    mocks.mergeSet = mergeSet([
      repo('repo-a', {
        artifactUrl: 'https://github.com/org/repo-a/pull/1',
        repoMerge: 'failed',
      }),
      repo('repo-b', {
        artifactUrl: 'https://github.com/org/repo-b/pull/2',
        repoMerge: 'pending',
      }),
    ]);
    mocks.findMergedArtifact.mockImplementation(async ({ cwd }: { cwd: string }) => (
      cwd.endsWith('repo-a')
        ? {
            forge: 'github',
            created: false,
            id: '1',
            url: 'https://github.com/org/repo-a/pull/1',
          }
        : null
    ));

    const result = await triggerMerge('PAN-2467');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      outcome: 'merged',
      repos: [{ repo: 'repo-b', success: true, message: 'Merged via github' }],
    }));
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledTimes(1);
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://github.com/org/repo-b/pull/2',
    }));
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://github.com/org/repo-a/pull/1',
    }));
    expect(mocks.mergeSet.repos).toEqual([
      expect.objectContaining({ repoKey: 'repo-a', repoVerification: 'passed', repoMerge: 'merged' }),
      expect.objectContaining({ repoKey: 'repo-b', repoVerification: 'skipped', repoMerge: 'merged' }),
    ]);
  });
});
