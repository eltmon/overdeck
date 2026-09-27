import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState, IssueState } from '@overdeck/contracts';
import type { GitHubPullRequestState } from '../../../../../lib/github-app.js';

// PAN-3668's shape: the merge set stored the first, closed PR; the open one is newer.
const STALE_URL = 'https://github.com/eltmon/overdeck/pull/3670';
const PR_URL = 'https://github.com/eltmon/overdeck/pull/4251';
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
  upsertMergeSet: vi.fn(),
  storedUrl: '',
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
  parsePullRequestRef: vi.fn(() => ({ owner: 'eltmon', repo: 'overdeck', number: 4251 })),
  reportCommitStatus: vi.fn(async () => undefined),
  verifyAppCanMerge: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../../../../lib/merge-set.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/merge-set.js')>();
  const storedSet = () => ({
    issueId: 'PAN-3668',
    repos: [{ repoKey: 'overdeck', targetBranch: 'main', forge: 'github', artifactUrl: mocks.storedUrl }],
  });
  return {
    ensureMergeSetForIssue: vi.fn(storedSet),
    getMergeSet: vi.fn(storedSet),
    upsertMergeSet: (...args: unknown[]) => mocks.upsertMergeSet(...args),
    withRepoArtifactUrl: actual.withRepoArtifactUrl,
  };
});

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
    pr: { url: PR_URL, number: 4251, reviewState: 'approved', checks: 'green', mergeable: true },
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

vi.mock('../../../../../lib/forge.js', async (importOriginal) => ({
  getForgeAdapter: vi.fn(() => ({
    commentOnArtifact: vi.fn(),
    mergeReviewArtifact: mocks.mergeReviewArtifact,
  })),
  parseArtifactRef: (await importOriginal<typeof import('../../../../../lib/forge.js')>()).parseArtifactRef,
}));

vi.mock('../../workspaces.js', () => ({
  completePendingOperation: mocks.completePendingOperation,
  getPendingOperation: vi.fn(() => null),
  getProjectPath: vi.fn(() => '/project'),
  getWorkspaceInfoForIssue: vi.fn(() => ({ isRemote: false, localPath: '/workspace/feature-pan-3668' })),
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
  manualMergeHeadMoved: actual.manualMergeHeadMoved,
  mergeHeadPin: actual.mergeHeadPin,
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
    number: 4251,
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

describe('triggerMerge with a stale stored merge-set artifact (PAN-4263)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.derivedState = 'ready';
    mocks.mergeRun = null;
    mocks.getCurrentMerge.mockReturnValue(null);
    mocks.storedUrl = STALE_URL;
    mocks.mergeGate.mockResolvedValue({ ready: true, facts: { headBranch: 'feature/pan-3668', headSha: HEAD_SHA, url: PR_URL } });
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
        return {
          stdout: JSON.stringify([{ url: PR_URL, state: 'OPEN' }, { url: STALE_URL, state: 'CLOSED' }]),
          stderr: '',
        };
      }
      if (file === 'git' && args[0] === 'merge-base') throw new Error('not rebased');
      return { stdout: '', stderr: '' };
    });
  });

  it('merges the freshly resolved open PR and rewrites the stale stored row', async () => {
    const result = await triggerMerge('PAN-3668');

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'merged' }));
    expect(result.error ?? '').not.toContain('the merge would land');
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledWith(expect.objectContaining({ url: PR_URL, id: '4251' }));
    expect(mocks.upsertMergeSet).toHaveBeenCalledWith(expect.objectContaining({
      repos: [expect.objectContaining({ repoKey: 'overdeck', artifactUrl: PR_URL, artifactId: '4251' })],
    }));
  });

  it('leaves a stored row alone when it already names the resolved PR', async () => {
    mocks.storedUrl = `${PR_URL}/`;

    const result = await triggerMerge('PAN-3668');

    expect(result).toEqual(expect.objectContaining({ success: true, outcome: 'merged' }));
    expect(mocks.mergeReviewArtifact).toHaveBeenCalledWith(expect.objectContaining({ url: PR_URL }));
    expect(mocks.upsertMergeSet).not.toHaveBeenCalled();
  });
});
