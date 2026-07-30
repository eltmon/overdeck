import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubPullRequestState } from '../../../../../lib/github-app.js';

const PR_URL = 'https://github.com/eltmon/overdeck/pull/3102';
const HEAD_SHA = 'a'.repeat(40);

const mocks = vi.hoisted(() => ({
  completePendingOperation: vi.fn(),
  ensureAgentReadyForMerge: vi.fn(),
  exec: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  execFile: vi.fn<[string, string[], any?], Promise<{ stdout: string; stderr: string }>>(),
  getPullRequestState: vi.fn(),
  mergeReviewArtifact: vi.fn(),
  postMergeLifecycle: vi.fn(),
  recordCiGreenVerificationVerdict: vi.fn(),
  reviewStatus: {} as Record<string, unknown>,
  setReviewStatus: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');
  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    mocks.exec(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((error: any) => callback(error, error.stdout || '', error.stderr || ''));
  }
  function execFile(file: string, args: string[], optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    mocks.execFile(file, args, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((error: any) => callback(error, error.stdout || '', error.stderr || ''));
  }
  (exec as any)[kCustom] = mocks.exec;
  (execFile as any)[kCustom] = mocks.execFile;
  return { exec, execFile };
});

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));

vi.mock('../../../../../lib/cloister/merge-agent.js', () => ({
  postMergeLifecycle: mocks.postMergeLifecycle,
  syncMainIntoWorkspace: vi.fn(),
}));

vi.mock('../../../../../lib/cloister/ship-log.js', () => ({
  appendShipLog: vi.fn(),
  beginShipLog: vi.fn(),
}));

vi.mock('../../../../../lib/github-app.js', () => ({
  getCiCheckRunsStatePromise: vi.fn(async () => ({
    green: true,
    total: 2,
    successCount: 2,
    verdict: 'success',
  })),
  getPullRequestState: (...args: unknown[]) => mocks.getPullRequestState(...args),
  isGitHubAppConfigured: vi.fn(() => true),
  isIntegrationPermissionError: vi.fn(() => false),
  parsePullRequestRef: vi.fn(() => ({ owner: 'eltmon', repo: 'overdeck', number: 3102 })),
  reportCommitStatus: vi.fn(async () => undefined),
  verifyAppCanMerge: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../../../../lib/merge-set.js', () => ({
  ensureMergeSetForIssueSync: vi.fn(() => ({
    repos: [{ targetBranch: 'main', forge: 'github', artifactUrl: PR_URL }],
  })),
  getMergeSetSync: vi.fn(() => ({
    repos: [{ targetBranch: 'main', forge: 'github', artifactUrl: PR_URL }],
  })),
}));

vi.mock('../../../../../lib/overdeck/merge.js', () => ({
  dequeueMerge: vi.fn(() => null),
  enqueueMerge: vi.fn(() => 1),
  getAllActiveQueues: vi.fn(() => []),
  getCurrentMerge: vi.fn(() => null),
  markMergeProcessing: vi.fn(),
}));

vi.mock('../../../../../lib/projects.js', () => ({
  findProjectByTeamSync: vi.fn(() => ({ workspace: { type: 'monorepo' }, quality_gates: {} })),
}));

vi.mock('../../../../../lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn(() => ({
    issueId: 'PAN-3110',
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    mergeStatus: 'pending',
    readyForMerge: true,
  })),
  markWorkspaceStuck: vi.fn(),
  setReviewStatusSync: vi.fn(),
}));

vi.mock('../../../../../lib/tmux.js', () => ({
  sessionExists: vi.fn(() => Effect.succeed(false)),
}));

vi.mock('../../../../../lib/forge.js', () => ({
  getForgeAdapter: vi.fn(() => ({
    commentOnArtifact: vi.fn(),
    mergeReviewArtifact: mocks.mergeReviewArtifact,
  })),
}));

vi.mock('../../workspaces.js', () => ({
  completePendingOperation: mocks.completePendingOperation,
  getPendingOperation: vi.fn(() => null),
  getProjectPath: vi.fn(() => '/project'),
  getWorkspaceInfoForIssue: vi.fn(() => ({ isRemote: false, localPath: '/workspace/feature-pan-3110' })),
  readJsonBody: vi.fn(),
  setPendingOperation: vi.fn(),
  setReviewStatus: (issueId: string, patch: Record<string, unknown>) => {
    mocks.reviewStatus = { ...mocks.reviewStatus, ...patch };
    mocks.setReviewStatus(issueId, patch);
  },
}));

vi.mock('../merge-strike.js', () => ({
  activeStrikeMerge: vi.fn(() => false),
  advanceMergeQueue: vi.fn(),
  ensureAgentReadyForMerge: mocks.ensureAgentReadyForMerge,
  mergeCompletionStatus: vi.fn(() => ({})),
  mergeVerificationOptions: vi.fn(() => ({})),
  normalMergeEligibility: vi.fn(() => null),
  rebaseWithAgentFallback: vi.fn(async () => {
    try {
      await mocks.ensureAgentReadyForMerge();
      return { success: true, newHead: HEAD_SHA };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error), retryable: true };
    }
  }),
  recordCiGreenVerificationVerdict: mocks.recordCiGreenVerificationVerdict,
  validateStrikeMergeRequest: vi.fn(() => null),
}));

vi.mock('../../specialists.js', () => ({ _serverManagedMerges: new Set<string>() }));
vi.mock('../../../services/merge-queue-service.js', () => ({ setMergeQueueAdvanceHandler: vi.fn() }));

import { triggerMerge } from '../merge-ops.js';

function pullRequestState(overrides: Partial<GitHubPullRequestState> = {}): GitHubPullRequestState {
  return {
    owner: 'eltmon',
    repo: 'overdeck',
    number: 3102,
    url: PR_URL,
    state: 'OPEN',
    merged: false,
    mergeable: true,
    mergeableState: 'clean',
    draft: false,
    headSha: HEAD_SHA,
    baseBranch: 'main',
    checksPending: false,
    checksFailed: false,
    ...overrides,
  };
}

describe('triggerMerge clean PR direct merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewStatus = {};
    mocks.getPullRequestState.mockReturnValue(Effect.succeed(pullRequestState()));
    mocks.mergeReviewArtifact.mockResolvedValue(undefined);
    mocks.ensureAgentReadyForMerge.mockRejectedValue(new Error('rebase flow reached'));
    mocks.exec.mockImplementation(async (command) => ({
      stdout: command.includes('git rev-parse HEAD') ? `${HEAD_SHA}\n` : '',
      stderr: '',
    }));
    mocks.execFile.mockImplementation(async (file, args) => {
      if (file === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return { stdout: `${PR_URL}\n`, stderr: '' };
      }
      if (file === 'git' && args[0] === 'merge-base') throw new Error('not rebased');
      return { stdout: '', stderr: '' };
    });
  });

  it('merges a clean PR without a work agent or rebase probe', async () => {
    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: true, mergeStatus: 'merged' }));
    expect(mocks.ensureAgentReadyForMerge).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['merge-base']),
      expect.anything(),
    );
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledWith(expect.objectContaining({
      url: PR_URL,
      method: 'squash',
    }));
  });

  it('uses the rebase flow when GitHub reports the PR behind', async () => {
    mocks.getPullRequestState.mockReturnValue(Effect.succeed(pullRequestState({ mergeableState: 'behind' })));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'rebase flow reached' }));
    expect(mocks.ensureAgentReadyForMerge).toHaveBeenCalledOnce();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('uses the rebase flow while clean PR checks are pending', async () => {
    mocks.getPullRequestState.mockReturnValue(Effect.succeed(pullRequestState({ checksPending: true })));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'rebase flow reached' }));
    expect(mocks.ensureAgentReadyForMerge).toHaveBeenCalledOnce();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('falls back to the rebase flow when the PR-state fetch fails', async () => {
    mocks.getPullRequestState.mockReturnValue(Effect.fail(new Error('GitHub unavailable')));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'rebase flow reached' }));
    expect(mocks.ensureAgentReadyForMerge).toHaveBeenCalledOnce();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });
});
