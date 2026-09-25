import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState, IssueState } from '@overdeck/contracts';
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
  derivedState: 'ready' as IssueState,
  runVerificationForIssue: vi.fn(),
  setMergeRun: vi.fn(),
  mergeRun: null as { phase: string } | null,
  mergeGate: vi.fn(),
  getCurrentMerge: vi.fn((..._args: unknown[]): string | null => null),
  enqueueMerge: vi.fn(() => 1),
}));

vi.mock('../../../../../lib/git-activity.js', () => ({ listGitOperations: vi.fn(() => []) }));
vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
}));
// config-yaml's defaults import lib/agents/tier-table, which still
// reaches the record plane W3 is deleting. Stub the one constant it needs.
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

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));

vi.mock('../../../../../lib/cloister/merge-agent.js', () => ({
  postMergeLifecycle: mocks.postMergeLifecycle,
  syncMainIntoWorkspace: vi.fn(),
}));

vi.mock('../../../../../lib/cloister/ship-log.js', () => ({
  appendShipLog: vi.fn(),
  beginShipLog: vi.fn(),
}));

vi.mock('../../../../../lib/cloister/verification-runner.js', () => ({
  runVerificationForIssue: (...args: unknown[]) => mocks.runVerificationForIssue(...args),
}));

vi.mock('../../../../../lib/github-app.js', () => ({
  getCiCheckRunsState: vi.fn(async () => ({
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
  ensureMergeSetForIssue: vi.fn(() => ({
    repos: [{ targetBranch: 'main', forge: 'github', artifactUrl: PR_URL }],
  })),
  getMergeSet: vi.fn(() => ({
    repos: [{ targetBranch: 'main', forge: 'github', artifactUrl: PR_URL }],
  })),
}));

vi.mock('../../../../../lib/overdeck/merge.js', () => ({
  dequeueMerge: vi.fn(() => null),
  enqueueMerge: (...args: unknown[]) => mocks.enqueueMerge(...args),
  getAllActiveQueues: vi.fn(() => []),
  getCurrentMerge: (...args: unknown[]) => mocks.getCurrentMerge(...args),
  markMergeProcessing: vi.fn(),
}));

vi.mock('../../../../../lib/projects.js', () => ({
  findProjectByTeam: vi.fn(() => ({ workspace: { type: 'monorepo' }, quality_gates: {} })),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

// PAN-3917: readiness is derived from the forge, not read off a record.
vi.mock('../../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: vi.fn(async (issueId: string): Promise<DerivedIssueState> => ({
    issueId,
    state: mocks.derivedState,
    pr: { url: PR_URL, number: 3102, reviewState: 'approved', checks: 'green', mergeable: true },
  })),
}));

vi.mock('../../../../../lib/tmux.js', () => ({
  // PAN-3917 (W6): the backend inventory's tmux fallback reads the pane list
  // synchronously; these tests have no tmux server, so it reads as empty.
  listSessionsSync: () => [],
  listSessions: () => Effect.succeed([]),
  listPaneValuesSync: () => [],
  listPaneValues: async () => [],
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
}));

// #3983: the Merge button's readiness is the real merge door — the real
// `normalMergeEligibility` and `forgeMergeGateRefusal` — over a stubbed gate.
vi.mock('../../../../../lib/cloister/merge-gate.js', () => ({
  evaluateIssueMergeGate: (...args: unknown[]) => mocks.mergeGate(...args),
}));
vi.mock('../../../../../lib/agents/agent-state.js', () => ({
  clearYieldForResume: vi.fn(),
  decideResumeGate: vi.fn(() => ({ decision: 'proceed' })),
  getAgentResumeGateBlockReason: vi.fn(() => null),
  getAgentState: vi.fn(() => null),
  saveAgentStateSync: vi.fn(),
}));
vi.mock('../../../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: vi.fn(() => ({ hasLiveTmuxSession: false, canResumeSession: false, canStartFresh: false })),
}));

vi.mock('../merge-strike.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../merge-strike.js')>();
  return {
  // The real gate binding, pin and start checks (#3983, #4066 review).
  normalMergeEligibility: actual.normalMergeEligibility,
  forgeMergeGate: actual.forgeMergeGate,
  forgeMergeGateRefusal: actual.forgeMergeGateRefusal,
  mergeTargetRefusal: actual.mergeTargetRefusal,
  automaticMergeHead: actual.automaticMergeHead,
  automaticMergePin: actual.automaticMergePin,
  automaticMergeStartRefusal: actual.automaticMergeStartRefusal,
  activeStrikeMerge: vi.fn(() => false),
  advanceMergeQueue: vi.fn(async () => {}),
  ensureAgentReadyForMerge: mocks.ensureAgentReadyForMerge,
  mergeVerificationOptions: vi.fn(() => ({})),
  rebaseWithAgentFallback: vi.fn(async () => {
    try {
      await mocks.ensureAgentReadyForMerge();
      return { success: true, newHead: HEAD_SHA };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error), retryable: true };
    }
  }),
  validateStrikeMergeRequest: vi.fn(() => null),
  };
});

vi.mock('../../specialists.js', () => ({ _serverManagedMerges: new Set<string>() }));
vi.mock('../../../services/merge-queue-service.js', () => ({
  setMergeQueueAdvanceHandler: vi.fn(),
  setMergeRun: (issueId: string, patch: Record<string, unknown>) => mocks.setMergeRun(issueId, patch),
  getMergeRun: () => mocks.mergeRun,
  clearMergeRun: vi.fn(),
}));

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
    mocks.derivedState = 'ready';
    mocks.mergeRun = null;
    mocks.getCurrentMerge.mockReturnValue(null);
    mocks.mergeGate.mockResolvedValue({ ready: true, facts: { headBranch: 'feature/pan-3110', headSha: HEAD_SHA, url: PR_URL } });
    mocks.runVerificationForIssue.mockReturnValue(Effect.succeed({ outcome: 'passed' }));
    mocks.getPullRequestState.mockResolvedValue(pullRequestState());
    mocks.mergeReviewArtifact.mockResolvedValue(undefined);
    mocks.ensureAgentReadyForMerge.mockRejectedValue(new Error('rebase flow reached'));
    mocks.exec.mockImplementation(async (command) => ({
      stdout: command.includes('git rev-parse HEAD') ? `${HEAD_SHA}\n` : '',
      stderr: '',
    }));
    mocks.execFile.mockImplementation(async (file, args) => {
      if (file === 'gh' && args[0] === 'pr' && args[1] === 'list') {
        return { stdout: JSON.stringify([{ url: PR_URL, state: 'OPEN' }]), stderr: '' };
      }
      if (file === 'git' && args[0] === 'merge-base') throw new Error('not rebased');
      return { stdout: '', stderr: '' };
    });
  });

  it('merges a clean PR without a work agent or rebase probe', async () => {
    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'merged' }));
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
    // A manual merge is not pinned.
    expect(mocks.mergeReviewArtifact.mock.calls[0]?.[0]).not.toHaveProperty('matchHeadCommit');
  });

  it('pins an automatic merge to the verified head commit (#3983)', async () => {
    const result = await triggerMerge('PAN-3110', { kind: 'normal', expectedHeadSha: HEAD_SHA });

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'merged' }));
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledWith(expect.objectContaining({
      url: PR_URL,
      matchHeadCommit: HEAD_SHA,
    }));
  });

  // #4066 review: the live PR head moved after the approval. The direct path
  // merges only the approved head, never the newer push.
  it('refuses an automatic direct merge when the live PR head is not the approved head', async () => {
    const pushed = 'c'.repeat(40);
    mocks.getPullRequestState.mockResolvedValue(pullRequestState({ headSha: pushed }));

    const result = await triggerMerge('PAN-3110', { kind: 'normal', expectedHeadSha: HEAD_SHA });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      statusCode: 409,
      error: `Cannot merge automatically: the PR head is ${pushed.slice(0, 12)}, not the approved head ${HEAD_SHA.slice(0, 12)}`,
    }));
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('pins the approved head, never a worktree HEAD the work agent moved', async () => {
    mocks.exec.mockImplementation(async (command) => ({
      stdout: command.includes('git rev-parse HEAD') ? `${'d'.repeat(40)}\n` : '',
      stderr: '',
    }));

    const result = await triggerMerge('PAN-3110', { kind: 'normal', expectedHeadSha: HEAD_SHA });

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'merged' }));
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledWith(expect.objectContaining({ matchHeadCommit: HEAD_SHA }));
  });

  // #4066 review: the gate must be tied to the PR the merge lands.
  it('refuses when the PR the gate passed is not the PR the merge would land', async () => {
    mocks.mergeGate.mockResolvedValue({
      ready: true,
      facts: { headBranch: 'feature/pan-3110', headSha: HEAD_SHA, url: 'https://github.com/eltmon/overdeck/pull/9999' },
    });

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, statusCode: 409 }));
    expect(result.error).toContain('the merge gate passed https://github.com/eltmon/overdeck/pull/9999');
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('refuses a gate that passed a strike PR for a normal merge', async () => {
    mocks.mergeGate.mockResolvedValue({
      ready: true,
      facts: { headBranch: 'strike/pan-3110', headSha: HEAD_SHA, url: PR_URL },
    });

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Cannot merge: the open pull request is on strike/pan-3110, not feature/pan-3110',
    }));
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  // #4066 review: a queued automatic merge would later start with no pin and
  // no policy re-check. It is deferred to the executor instead.
  it('defers an automatic merge while another merge holds the slot, without queueing it', async () => {
    mocks.getCurrentMerge.mockReturnValue('PAN-1');

    const result = await triggerMerge('PAN-3110', { kind: 'normal', expectedHeadSha: HEAD_SHA });

    expect(result).toEqual(expect.objectContaining({ success: false, deferred: true, statusCode: 409 }));
    expect(mocks.enqueueMerge).not.toHaveBeenCalled();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('still queues a manual merge while another merge holds the slot', async () => {
    mocks.getCurrentMerge.mockReturnValue('PAN-1');

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'queued' }));
    expect(mocks.enqueueMerge).toHaveBeenCalledWith('pan', 'PAN-3110');
  });

  it('uses the rebase flow when GitHub reports the PR behind', async () => {
    mocks.getPullRequestState.mockResolvedValue(pullRequestState({ mergeableState: 'behind' }));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'rebase flow reached' }));
    expect(mocks.ensureAgentReadyForMerge).toHaveBeenCalledOnce();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('uses the rebase flow while clean PR checks are pending', async () => {
    mocks.getPullRequestState.mockResolvedValue(pullRequestState({ checksPending: true }));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'rebase flow reached' }));
    expect(mocks.ensureAgentReadyForMerge).toHaveBeenCalledOnce();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('falls back to the rebase flow when the PR-state fetch fails', async () => {
    mocks.getPullRequestState.mockRejectedValue(new Error('GitHub unavailable'));

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'rebase flow reached' }));
    expect(mocks.ensureAgentReadyForMerge).toHaveBeenCalledOnce();
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  // #3983: the derived state reads approval only from GitHub's reviewDecision,
  // which is empty without branch protection, so a PR approved by a verdict
  // marker naming its head derives `in-review`. The Merge button merges it on
  // the gate's word.
  it('merges from the Merge button when the gate proves a head approval the derived state cannot see', async () => {
    mocks.derivedState = 'in-review';

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'merged' }));
    // #4066 review: bound to the feature PR, which also skips the facts cache.
    expect(mocks.mergeGate).toHaveBeenCalledWith('PAN-3110', {}, { preferBranch: 'feature/pan-3110' });
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledOnce();
  });

  it('refuses from the Merge button when the approval does not name the head', async () => {
    mocks.derivedState = 'in-review';
    mocks.mergeGate.mockResolvedValue({
      ready: false,
      reason: `PR is not approved at PR HEAD ${HEAD_SHA}`,
      facts: { headBranch: 'feature/pan-3110', headSha: HEAD_SHA, url: PR_URL },
    });

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      statusCode: 400,
      error: `Cannot merge: PR is not approved at PR HEAD ${HEAD_SHA}`,
    }));
    expect(mocks.mergeReviewArtifact).not.toHaveBeenCalled();
  });

  it('still refuses an already merged issue from the derived state', async () => {
    mocks.derivedState = 'merged';

    const result = await triggerMerge('PAN-3110');

    expect(result).toEqual(expect.objectContaining({ success: false, error: 'Already merged' }));
    expect(mocks.mergeGate).not.toHaveBeenCalled();
  });
});
