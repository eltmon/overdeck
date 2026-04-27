/**
 * Route-level regression tests for merge timeout reconciliation (PAN-349).
 *
 * Verifies that a transient forge timeout does not leave the dashboard in a
 * permanently failed merge state when the PR has actually merged, and that the
 * workspace refresh path can reconcile stale merge state from GitHub.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPullRequestState = vi.fn();
const mockIsGitHubAppConfigured = vi.fn();
const mockExec = vi.fn();

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: (...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      const cmdArgs = args.slice(0, -1);
      const result = mockExec(...cmdArgs);
      Promise.resolve(result).then(
        (val: any) => cb(null, val ?? { stdout: '', stderr: '' }),
        (err: Error) => cb(err),
      );
      return { unref: vi.fn() };
    },
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      Promise.resolve({ stdout: '', stderr: '' }).then(
        (val: any) => cb(null, val),
        (err: Error) => cb(err),
      );
      return { unref: vi.fn() };
    },
    spawn: vi.fn(() => ({ on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } })),
  };
});

vi.mock('../../../../../src/lib/github-app.js', () => ({
  getPullRequestState: (...args: unknown[]) => mockGetPullRequestState(...args),
  isGitHubAppConfigured: (...args: unknown[]) => mockIsGitHubAppConfigured(...args),
  reportCommitStatus: vi.fn(),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(),
  listProjects: vi.fn(() => []),
  findProjectByTeam: vi.fn(),
  extractTeamPrefix: vi.fn(),
}));
vi.mock('../../../../../src/lib/tracker-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/tracker-utils.js')>();
  return {
    ...actual,
    resolveGitHubIssue: vi.fn(),
  };
});
vi.mock('../../../../../src/lib/agents.js', () => ({
  messageAgent: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  transitionIssueToInReview: vi.fn(),
  getAgentState: vi.fn(),
  getAgentStateAsync: vi.fn(),
  spawnAgent: vi.fn(),
}));
vi.mock('../../../../../src/lib/git/operations.js', () => ({
  gitPush: vi.fn(),
  MainDivergedError: class MainDivergedError extends Error {},
}));
vi.mock('../../../../../src/lib/git-activity.js', () => ({ listGitOperations: vi.fn(() => []) }));
vi.mock('../../../../../src/lib/queue-position.js', () => ({
  computeQueuePositionFromStatus: vi.fn(),
  findPositionInQueue: vi.fn(),
}));
vi.mock('../../../../../src/lib/cost-parsers/jsonl-parser.js', () => ({ getActiveSessionModel: vi.fn() }));
vi.mock('../../../../../src/lib/vbrief/io.js', () => ({ findPlan: vi.fn(), readPlan: vi.fn(), readWorkspacePlan: vi.fn() }));
vi.mock('../../../../../src/lib/vbrief/dag.js', () => ({ criticalPath: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/merge-agent.js', () => ({ syncMainIntoWorkspace: vi.fn() }));
vi.mock('../../../../../src/lib/tmux.js', () => ({ capturePaneAsync: vi.fn(), killSessionAsync: vi.fn(), listSessionNamesAsync: vi.fn(() => Promise.resolve([])) }));
vi.mock('../../../../../src/lib/vbrief/beads.js', () => ({ syncBeadStatusToVBrief: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/task-readiness.js', () => ({ getUnblockedItems: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/verification-runner.js', () => ({ runVerificationForIssue: vi.fn() }));
vi.mock('../../../../../src/lib/tldr-daemon.js', () => ({ getTldrDaemonService: vi.fn() }));
vi.mock('../../../../../src/lib/remote/workspace-metadata.js', () => ({ loadWorkspaceMetadata: vi.fn() }));
vi.mock('../../../../../src/dashboard/server/services/merge-queue-service.js', () => ({ setMergeQueueTriggerHandler: vi.fn() }));
vi.mock('../../../../../src/lib/work-agent-lifecycle.js', () => ({ getWorkAgentLifecycleState: vi.fn() }));
vi.mock('../../../../../src/lib/review-status-enrichment.js', () => ({ enrichReviewStatusFromSessions: vi.fn((s) => s) }));
vi.mock('../../../../../src/dashboard/server/services/domain-services.js', () => ({ EventStoreService: {} }));
vi.mock('../../../../../src/dashboard/server/services/tracker-config.js', () => ({ getGitHubConfig: vi.fn() }));

const reviewStatusStore = new Map<string, any>();
vi.mock('../../../../../src/lib/review-status.js', () => ({
  getReviewStatus: vi.fn((issueId: string) => reviewStatusStore.get(issueId.toUpperCase()) ?? null),
  setReviewStatus: vi.fn((issueId: string, update: Record<string, unknown>) => {
    const key = issueId.toUpperCase();
    const previous = reviewStatusStore.get(key) ?? { issueId: key };
    const next = { ...previous, ...update, issueId: key };
    reviewStatusStore.set(key, next);
    return next;
  }),
  clearReviewStatus: vi.fn((issueId: string) => {
    reviewStatusStore.delete(issueId.toUpperCase());
  }),
  markWorkspaceStuck: vi.fn(),
  setDeaconIgnored: vi.fn(),
}));

import { clearReviewStatus, getReviewStatus, setReviewStatus } from '../../../../../src/lib/review-status.js';
import { reconcileGitHubMergeStatus } from '../../../../../src/dashboard/server/routes/workspaces.js';

describe('reconcileGitHubMergeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGitHubAppConfigured.mockReturnValue(true);
    clearReviewStatus('PAN-349');
  });

  it('marks the issue merged when GitHub says the PR already merged', async () => {
    setReviewStatus('PAN-349', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      mergeStatus: 'verifying',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/349',
    });
    mockGetPullRequestState.mockResolvedValue({ merged: true });

    const reconciled = await reconcileGitHubMergeStatus('PAN-349', getReviewStatus('PAN-349'));

    expect(reconciled).toBe(true);
    const status = getReviewStatus('PAN-349');
    expect(status?.mergeStatus).toBe('merged');
    expect(status?.readyForMerge).toBe(false);
    expect(status?.mergeNotes).toBeUndefined();
  });

  it('leaves the issue unchanged when the PR is still open', async () => {
    setReviewStatus('PAN-349', {
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      mergeStatus: 'verifying',
      mergeNotes: 'Timed out waiting for GitHub PR #349 to become mergeable',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/349',
    });
    mockGetPullRequestState.mockResolvedValue({ merged: false, state: 'OPEN' });

    const reconciled = await reconcileGitHubMergeStatus('PAN-349', getReviewStatus('PAN-349'));

    expect(reconciled).toBe(false);
    const status = getReviewStatus('PAN-349');
    expect(status?.mergeStatus).toBe('verifying');
    expect(status?.readyForMerge).toBe(true);
    expect(status?.mergeNotes).toContain('Timed out');
  });
});
