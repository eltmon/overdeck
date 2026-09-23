import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubPullRequestState } from '../../../../../lib/github-app.js';

const PR_URL = 'https://github.com/eltmon/overdeck/pull/3102';
const HEAD_SHA = 'b'.repeat(40);

const mocks = vi.hoisted(() => ({
  completePendingOperation: vi.fn(),
  evaluateIssueMergeGate: vi.fn(),
  exec: vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>(),
  execFile: vi.fn<[string, string[], any?], Promise<{ stdout: string; stderr: string }>>(),
  existsSync: vi.fn(() => true),
  getPullRequestState: vi.fn(),
  mergeReviewArtifact: vi.fn(),
  messageAgent: vi.fn(),
  postMergeLifecycle: vi.fn(),
  rebaseFeatureBranch: vi.fn(),
  sessionExists: vi.fn(),
  setMergeRun: vi.fn(),
}));

// PAN-3917: config-yaml's defaults import lib/agents/tier-table, which still
// reaches the record plane W3 is deleting. Stub the one constant it needs.
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
  findProjectByPathSync: vi.fn(() => null),
  listProjectsSync: vi.fn(() => []),
  resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/project' })),
}));
// PAN-3917: merge readiness is the forge's answer, not a review-status record.
vi.mock('../../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: vi.fn(async (issueId: string) => ({
    issueId,
    state: 'ready',
    pr: { url: PR_URL, number: 3102, reviewState: 'approved', checks: 'green', mergeable: true },
  })),
}));
vi.mock('../../../../../lib/tmux.js', () => ({  // PAN-3917 (W6): the backend inventory's tmux fallback reads the pane list
  // synchronously; these tests have no tmux server, so it reads as empty.
  listSessionsSync: () => [],
  listPaneValuesSync: () => [],
 sessionExists: mocks.sessionExists }));
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
}));
vi.mock('../../../services/merge-queue-service.js', () => ({
  setMergeQueueAdvanceHandler: vi.fn(),
  setMergeRun: (issueId: string, patch: Record<string, unknown>) => mocks.setMergeRun(issueId, patch),
  getMergeRun: () => null,
  clearMergeRun: vi.fn(),
}));

// #4016/#4021/#4036: the forge-facts merge gate is exercised by its own tests
// (pr-facts, merge-gate, merge-queue-advance); here it lets the merge through.
vi.mock('../../../../../lib/cloister/merge-gate.js', () => ({
  evaluateIssueMergeGate: mocks.evaluateIssueMergeGate,
}));

vi.mock('../../specialists.js', () => ({ _serverManagedMerges: new Set<string>() }));

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
    mocks.existsSync.mockReturnValue(true);
    mocks.evaluateIssueMergeGate.mockResolvedValue({ ready: true, facts: { headBranch: 'feature/pan-3110' } });
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
      if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') return { stdout: JSON.stringify([{ url: PR_URL, state: 'OPEN' }]), stderr: '' };
      if (file === 'git' && args[0] === 'merge-base') throw new Error('branch is behind');
      return { stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses before claiming the merge slot when the forge-facts merge gate says no (#4021/#4036)', async () => {
    mocks.evaluateIssueMergeGate.mockResolvedValue({
      ready: false,
      reason: `no CI test job reported on PR HEAD ${HEAD_SHA} (verification.tests: ci)`,
      facts: { headBranch: 'feature/pan-3110' },
    });

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual({
      success: false,
      statusCode: 400,
      error: `Cannot merge: no CI test job reported on PR HEAD ${HEAD_SHA} (verification.tests: ci)`,
      state: 'ready',
    });
    expect(mocks.setMergeRun).not.toHaveBeenCalled();
    expect(mocks.rebaseFeatureBranch).not.toHaveBeenCalled();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('queues a retry when the local workspace is missing', async () => {
    mocks.existsSync.mockReturnValue(false);

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual({
      success: false,
      statusCode: 500,
      error: 'Workspace does not exist',
      retryable: true,
    });
    expect(mocks.setMergeRun).toHaveBeenCalledWith('PAN-3110', {
      phase: 'queued',
      notes: 'Workspace does not exist',
    });
    expect(mocks.rebaseFeatureBranch).not.toHaveBeenCalled();
  });

  it('uses the server-side rebase for a behind branch without engaging the stopped agent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await triggerMerge('PAN-3110');
      expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'merged' }));
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
    expect(mocks.setMergeRun).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({ phase: 'failed' }));
  });

  it('queues a retry when the agent stops after a non-conflict failure', async () => {
    mocks.rebaseFeatureBranch.mockReturnValue(Effect.fail(new Error('git fetch failed')));

    const resultPromise = triggerMerge('PAN-3110');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result).toEqual(expect.objectContaining({ success: false, retryable: true }));
    expect(mocks.setMergeRun).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({
      phase: 'queued',
      notes: expect.stringContaining('stopped before completing the rebase'),
    }));
  });

  it('queues a retry when a non-conflict rebase times out with the agent still running', async () => {
    mocks.rebaseFeatureBranch.mockReturnValue(Effect.fail(new Error('git fetch failed')));
    mocks.sessionExists.mockReturnValue(Effect.succeed(true));

    const resultPromise = triggerMerge('PAN-3110');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    const result = await resultPromise;

    expect(result).toEqual(expect.objectContaining({ success: false, retryable: true }));
    expect(mocks.setMergeRun).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({
      phase: 'queued',
      notes: expect.stringContaining('did not push the rebased branch within 30 minutes'),
    }));
  });

  it('keeps failing CI as a non-retryable content failure', async () => {
    mocks.getPullRequestState.mockReturnValue(Effect.succeed(pullRequestState({ checksFailed: true })));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, statusCode: 409 }));
    expect(result).not.toHaveProperty('retryable');
    expect(mocks.rebaseFeatureBranch).not.toHaveBeenCalled();
    expect(mocks.setMergeRun).toHaveBeenCalledWith('PAN-3110', expect.objectContaining({ phase: 'failed' }));
  });
});
