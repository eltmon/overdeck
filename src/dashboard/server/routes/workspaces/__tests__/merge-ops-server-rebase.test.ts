import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubPullRequestState } from '../../../../../lib/github-app.js';

const PR_URL = 'https://github.com/eltmon/overdeck/pull/3102';
const HEAD_SHA = 'b'.repeat(40);

const mocks = vi.hoisted(() => ({
  completePendingOperation: vi.fn(),
  exec: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  execFile: vi.fn<[string, string[], any?], Promise<{ stdout: string; stderr: string }>>(),
  existsSync: vi.fn(() => true),
  getPullRequestState: vi.fn(),
  mergeReviewArtifact: vi.fn(),
  messageAgent: vi.fn(),
  postMergeLifecycle: vi.fn(),
  rebaseFeatureBranch: vi.fn(),
  reviewStatus: {} as Record<string, unknown>,
  sessionExists: vi.fn(),
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

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: mocks.existsSync,
}));
vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(() => Effect.succeed(null)),
  messageAgent: mocks.messageAgent,
  spawnAgent: vi.fn(),
}));
vi.mock('../../../../../lib/agents/agent-state.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../lib/agents/agent-state.js')>(),
  getAgentStateSync: vi.fn(() => null),
}));
vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleStateSync: vi.fn(() => ({
    hasLiveTmuxSession: true,
    canStartFresh: false,
    canResumeSession: false,
  })),
}));
vi.mock('../../../../../lib/cloister/merge-rebase.js', () => ({
  rebaseFeatureBranch: (...args: unknown[]) => mocks.rebaseFeatureBranch(...args),
}));
vi.mock('../../../../../lib/cloister/merge-agent.js', () => ({
  postMergeLifecycle: mocks.postMergeLifecycle,
  syncMainIntoWorkspace: vi.fn(),
}));
vi.mock('../../../../../lib/cloister/ship-log.js', () => ({ appendShipLog: vi.fn(), beginShipLog: vi.fn() }));
vi.mock('../../../../../lib/github-app.js', () => ({
  getCiCheckRunsStatePromise: vi.fn(async () => ({ green: true, total: 2, successCount: 2, verdict: 'success' })),
  getPullRequestState: (...args: unknown[]) => mocks.getPullRequestState(...args),
  isGitHubAppConfigured: vi.fn(() => true),
  isIntegrationPermissionError: vi.fn(() => false),
  parsePullRequestRef: vi.fn(() => ({ owner: 'eltmon', repo: 'overdeck', number: 3102 })),
  reportCommitStatus: vi.fn(async () => undefined),
  verifyAppCanMerge: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../../../../lib/merge-set.js', () => ({
  ensureMergeSetForIssueSync: vi.fn(() => ({ repos: [{ targetBranch: 'main', forge: 'github', artifactUrl: PR_URL }] })),
  getMergeSetSync: vi.fn(() => ({ repos: [{ targetBranch: 'main', forge: 'github', artifactUrl: PR_URL }] })),
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
    issueId: 'PAN-3110', reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'passed',
    mergeStatus: 'pending', readyForMerge: true,
  })),
  markWorkspaceStuck: vi.fn(),
  setReviewStatusSync: vi.fn(),
}));
vi.mock('../../../../../lib/tmux.js', () => ({ sessionExists: mocks.sessionExists }));
vi.mock('../../../../../lib/forge.js', () => ({
  getForgeAdapter: vi.fn(() => ({ commentOnArtifact: vi.fn(), mergeReviewArtifact: mocks.mergeReviewArtifact })),
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
vi.mock('../merge-strike.js', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../merge-strike.js')),
  recordCiGreenVerificationVerdict: vi.fn(),
}));
vi.mock('../../specialists.js', () => ({ _serverManagedMerges: new Set<string>() }));
vi.mock('../../../services/merge-queue-service.js', () => ({ setMergeQueueAdvanceHandler: vi.fn() }));

import { triggerMerge } from '../merge-ops.js';

function pullRequestState(overrides: Partial<GitHubPullRequestState> = {}): GitHubPullRequestState {
  return {
    owner: 'eltmon', repo: 'overdeck', number: 3102, url: PR_URL, state: 'OPEN', merged: false,
    mergeable: true, mergeableState: 'behind', draft: false, headSha: HEAD_SHA, baseBranch: 'main',
    checksPending: false, checksFailed: false, ...overrides,
  };
}

describe('triggerMerge server rebase escalation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.reviewStatus = {};
    mocks.existsSync.mockReturnValue(true);
    mocks.getPullRequestState.mockReturnValue(Effect.succeed(pullRequestState()));
    mocks.rebaseFeatureBranch.mockReturnValue(Effect.succeed({ success: true, newHead: HEAD_SHA }));
    mocks.mergeReviewArtifact.mockResolvedValue(undefined);
    mocks.messageAgent.mockResolvedValue({ delivered: true });
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mocks.exec.mockImplementation(async (command) => ({
      stdout: command.includes('git rev-parse HEAD') ? `${HEAD_SHA}\n` : command.includes('git rev-parse origin/') ? 'old-head\n' : '',
      stderr: '',
    }));
    mocks.execFile.mockImplementation(async (file, args) => {
      if (file === 'gh' && args[0] === 'pr' && args[1] === 'view') return { stdout: `${PR_URL}\n`, stderr: '' };
      if (file === 'git' && args[0] === 'merge-base') throw new Error('branch is behind');
      return { stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues a retry without clearing verdict readiness when the local workspace is missing', async () => {
    mocks.existsSync.mockReturnValue(false);

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual({
      success: false,
      statusCode: 500,
      error: 'Workspace does not exist',
      retryable: true,
    });
    expect(mocks.setReviewStatus).toHaveBeenCalledWith('PAN-3110', {
      mergeStatus: 'queued',
      mergeNotes: 'Workspace does not exist',
    });
    expect(mocks.setReviewStatus).not.toHaveBeenCalledWith(
      'PAN-3110',
      expect.objectContaining({ readyForMerge: false }),
    );
    expect(mocks.rebaseFeatureBranch).not.toHaveBeenCalled();
  });

  it('uses the server-side rebase for a behind branch without engaging the stopped agent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await triggerMerge('PAN-3110');
      expect(result).toEqual(expect.objectContaining({ success: true, mergeStatus: 'merged' }));
      expect(mocks.rebaseFeatureBranch).toHaveBeenCalledWith('/workspace/feature-pan-3110', 'feature/pan-3110', 'main', 'PAN-3110');
      expect(mocks.messageAgent).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not determine whether feature/pan-3110 contains origin/main'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('engages the work agent after a server-side conflict', async () => {
    mocks.rebaseFeatureBranch.mockReturnValue(Effect.fail({
      message: 'conflict',
      conflictedFiles: ['src/conflict.ts'],
    }));

    const resultPromise = triggerMerge('PAN-3110');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(mocks.messageAgent).toHaveBeenCalledWith('agent-pan-3110', expect.stringContaining('MERGE REQUESTED'));
    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(result).not.toHaveProperty('retryable');
    expect(mocks.setReviewStatus).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({ mergeStatus: 'failed', readyForMerge: false }));
  });

  it('queues a retry without clearing verdict readiness when the agent stops after a non-conflict failure', async () => {
    mocks.rebaseFeatureBranch.mockReturnValue(Effect.fail(new Error('git fetch failed')));

    const resultPromise = triggerMerge('PAN-3110');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result).toEqual(expect.objectContaining({ success: false, retryable: true }));
    expect(mocks.setReviewStatus).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({
      mergeStatus: 'queued',
      mergeNotes: expect.stringContaining('stopped before completing the rebase'),
    }));
    expect(mocks.setReviewStatus).not.toHaveBeenCalledWith('PAN-3110', expect.objectContaining({ readyForMerge: false }));
  });

  it('queues a retry when a non-conflict rebase times out with the agent still running', async () => {
    mocks.rebaseFeatureBranch.mockReturnValue(Effect.fail(new Error('git fetch failed')));
    mocks.sessionExists.mockReturnValue(Effect.succeed(true));

    const resultPromise = triggerMerge('PAN-3110');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    const result = await resultPromise;

    expect(result).toEqual(expect.objectContaining({ success: false, retryable: true }));
    expect(mocks.setReviewStatus).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({
      mergeStatus: 'queued',
      mergeNotes: expect.stringContaining('did not push the rebased branch within 30 minutes'),
    }));
    expect(mocks.setReviewStatus).not.toHaveBeenCalledWith(
      'PAN-3110',
      expect.objectContaining({ readyForMerge: false }),
    );
  });

  it('keeps failing CI as a non-retryable content failure', async () => {
    mocks.getPullRequestState.mockReturnValue(Effect.succeed(pullRequestState({ checksFailed: true })));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, statusCode: 409 }));
    expect(result).not.toHaveProperty('retryable');
    expect(mocks.rebaseFeatureBranch).not.toHaveBeenCalled();
    expect(mocks.setReviewStatus).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({ mergeStatus: 'failed', readyForMerge: false }));
  });
});
