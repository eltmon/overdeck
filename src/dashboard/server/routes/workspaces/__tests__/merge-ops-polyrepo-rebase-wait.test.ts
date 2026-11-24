/**
 * PAN-5652: the polyrepo rebase wait asks the liveness oracle whether the work
 * agent is still there. It used tmux `has-session`, which is false for every
 * Herdr agent, so the wait gave up after its first 5-second poll while the
 * agent was alive and rebasing.
 */
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  isAlive: vi.fn(),
  prepareWorkAgentForRebase: vi.fn(),
  tmuxSessionExists: vi.fn(),
  heads: new Map<string, string>(),
}));

// PAN-3917: config-yaml's defaults import lib/agents/tier-table, which still
// reaches the record plane W3 is deleting. Stub the one constant it needs.
// lib/agents pulls agents/spawn, which imports the removed `state-home`.
vi.mock('../../../../../lib/agents.js', () => ({
  getAgentState: vi.fn(),
  messageAgent: vi.fn(),
  spawnAgent: vi.fn(),
}));
vi.mock('../../../../../lib/git-activity.js', () => ({ listGitOperations: vi.fn(() => []) }));
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
  findProjectByTeam: vi.fn(() => ({
    workspace: {
      type: 'polyrepo',
      repos: [
        { name: 'repo-a', path: 'repo-a' },
        { name: 'repo-b', path: 'repo-b' },
      ],
    },
    quality_gates: {},
  })),
  findProjectByPath: vi.fn(() => null),
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
  listSessions: () => Effect.succeed([]),
  listPaneValuesSync: () => [],
  listPaneValues: async () => [],
  sessionExists: mocks.tmuxSessionExists,
}));

vi.mock('../../../../../lib/agents/liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/agents/liveness.js')>()),
  isAlive: mocks.isAlive,
}));

// Both repos have an open PR with unmerged commits, so both need the rebase.
vi.mock('../../../../../lib/cloister/merge-completeness.js', () => ({
  assessRepoMergeCompleteness: vi.fn(async () => ({ repoKey: 'repo', state: 'unmerged', reason: 'unmerged' })),
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
  prepareWorkAgentForRebase: mocks.prepareWorkAgentForRebase,
  automaticMergeHead: vi.fn(() => null),
  automaticMergePin: vi.fn(() => ({})),
  manualMergeHeadMoved: vi.fn(() => null),
  mergeHeadPin: vi.fn(() => ({})),
  automaticMergeStartRefusal: vi.fn(async () => null),
  busyMergeRefusal: vi.fn(() => null),
  forgeMergeGate: vi.fn(async () => ({ refusal: null, facts: { headBranch: 'feature/pan-1', url: null } })),
  forgeMergeGateRefusal: vi.fn(async () => null),
  mergeTargetRefusal: vi.fn(() => null),
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
  ensureMergeSetForIssue: vi.fn(() => mocks.mergeSet),
  getMergeSet: vi.fn(() => mocks.mergeSet),
  upsertMergeSet: (mergeSet: any) => {
    mocks.mergeSet = mergeSet;
    mocks.upsertMergeSet(mergeSet);
  },
  withRepoArtifactUrl: vi.fn((mergeSet: any, repoKey: string, artifactUrl: string, artifactId?: string) => ({
    ...mergeSet,
    repos: mergeSet.repos.map((repo: any) => (
      repo.repoKey === repoKey ? { ...repo, artifactUrl, artifactId } : repo
    )),
  })),
  withRepoState: vi.fn((mergeSet: any, repoKey: string, patch: Record<string, unknown>) => ({
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

const POLL_MS = 5_000;
const REBASE_TIMEOUT_MS = 30 * 60 * 1000;

function repo(repoKey: string) {
  return {
    repoKey,
    repoPath: `/project/${repoKey}`,
    forge: 'github',
    sourceBranch: 'feature/pan-5652',
    targetBranch: 'main',
    artifactUrl: `https://github.com/org/${repoKey}/pull/1`,
    artifactId: '1',
    repoReview: 'passed',
    repoTests: 'passed',
    rebaseStatus: 'pending',
    repoVerification: 'pending',
    repoMerge: 'pending',
    mergeOrder: repoKey === 'repo-a' ? 0 : 1,
    required: true,
  };
}

function cwdRepo(options: { cwd?: string } | undefined): string {
  return options?.cwd?.endsWith('repo-b') ? 'repo-b' : 'repo-a';
}

/** Resolves once the merge has asked the work agent to rebase and entered the wait. */
function waitEntered(): Promise<void> {
  return new Promise((resolve) => {
    mocks.prepareWorkAgentForRebase.mockImplementation(async () => {
      resolve();
      return { ok: true, detail: 'Work agent is running.' };
    });
  });
}

describe('polyrepo rebase wait on a Herdr-backed work agent (PAN-5652)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.mergeSet = {
      issueId: 'PAN-5652',
      projectKey: 'overdeck',
      projectPath: '/project',
      workspaceType: 'polyrepo',
      status: 'ready',
      createdAt: '2026-11-23T00:00:00Z',
      updatedAt: '2026-11-23T00:00:00Z',
      repos: [repo('repo-a'), repo('repo-b')],
    };
    mocks.heads = new Map([['repo-a', 'old-a'], ['repo-b', 'old-b']]);
    // Herdr host: tmux knows nothing about the agent.
    mocks.tmuxSessionExists.mockReturnValue(Effect.succeed(false));
    mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true, backendState: 'working' });
    mocks.discoverArtifact.mockResolvedValue(null);
    mocks.findMergedArtifact.mockResolvedValue(null);
    mocks.mergeReviewArtifact.mockResolvedValue(undefined);
    mocks.exec.mockImplementation(async (command, options) => {
      // Neither branch contains origin/main yet, so both need the agent's rebase.
      if (command.includes('merge-base --is-ancestor')) throw Object.assign(new Error('not ancestor'), { stdout: '', stderr: '' });
      if (command.includes('rev-parse origin/')) return { stdout: `${mocks.heads.get(cwdRepo(options))}\n`, stderr: '' };
      return { stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps polling a live agent that tmux cannot see, then proceeds once both branches move', async () => {
    const entered = waitEntered();
    let settled = false;
    const result = triggerMerge('PAN-5652').finally(() => { settled = true; });
    await entered;

    await vi.advanceTimersByTimeAsync(POLL_MS * 6);
    expect(settled).toBe(false);
    expect(mocks.isAlive).toHaveBeenCalledWith('agent-pan-5652');

    mocks.heads.set('repo-a', 'new-a');
    mocks.heads.set('repo-b', 'new-b');
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mocks.mergeSet.repos).toEqual([
      expect.objectContaining({ repoKey: 'repo-a', rebaseStatus: 'passed' }),
      expect.objectContaining({ repoKey: 'repo-b', rebaseStatus: 'passed' }),
    ]);
    expect(mocks.setMergeRun).toHaveBeenCalledWith('PAN-5652', expect.objectContaining({ phase: 'verifying' }));
    expect(mocks.setMergeRun).not.toHaveBeenCalledWith('PAN-5652', expect.objectContaining({
      notes: expect.stringContaining('stopped before completing polyrepo rebases'),
    }));
    await vi.runAllTimersAsync();
    await result;
  });

  it('waits the full 30 minutes for a live agent and reports the timeout, not a stop', async () => {
    const entered = waitEntered();
    let settled = false;
    const result = triggerMerge('PAN-5652').finally(() => { settled = true; });
    await entered;

    await vi.advanceTimersByTimeAsync(REBASE_TIMEOUT_MS - POLL_MS);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    await expect(result).resolves.toEqual(expect.objectContaining({
      success: false,
      error: 'Work agent did not push rebased branches for repo-a, repo-b within 30 minutes',
    }));
  });

  it('keeps waiting while the liveness probe is indeterminate', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
    const entered = waitEntered();
    let settled = false;
    const result = triggerMerge('PAN-5652').finally(() => { settled = true; });
    await entered;

    await vi.advanceTimersByTimeAsync(POLL_MS * 6);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(REBASE_TIMEOUT_MS);
    await expect(result).resolves.toEqual(expect.objectContaining({
      error: expect.stringContaining('within 30 minutes'),
    }));
  });

  it('stops waiting and says so once the agent is confirmed gone', async () => {
    const entered = waitEntered();
    const result = triggerMerge('PAN-5652');
    await entered;

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
    await vi.advanceTimersByTimeAsync(POLL_MS);

    await expect(result).resolves.toEqual(expect.objectContaining({
      success: false,
      error: 'Work agent agent-pan-5652 stopped before completing polyrepo rebases for repo-a, repo-b',
    }));
  });
});
