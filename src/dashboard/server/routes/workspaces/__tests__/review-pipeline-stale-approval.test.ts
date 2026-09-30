/**
 * PAN-4384: the guarded review request is head-bound. GitHub does not dismiss
 * an approval on push in this repository, so an approval the forge proves
 * stale at the current head must not short-circuit a re-request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';

const routeMocks = vi.hoisted(() => ({
  getProjectPath: vi.fn(),
  getWorkspaceInfoForIssue: vi.fn(),
  completePendingOperation: vi.fn(),
  getDerivedIssueState: vi.fn(),
  spawnRun: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  readApprovalStandsAtHead: vi.fn(),
}));

vi.mock('../../workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workspaces.js')>();
  return {
    ...actual,
    getProjectPath: routeMocks.getProjectPath,
    getWorkspaceInfoForIssue: routeMocks.getWorkspaceInfoForIssue,
    completePendingOperation: routeMocks.completePendingOperation,
  };
});

vi.mock('../../../services/derived-issue-state.js', () => ({
  getDerivedIssueState: routeMocks.getDerivedIssueState,
}));

vi.mock('../../../../../lib/cloister/conflict-gate.js', () => ({
  getCachedConflictGateMergeability: vi.fn(() => null),
}));

vi.mock('../../../../../lib/cloister/merge-gate.js', () => ({
  readApprovalStandsAtHead: routeMocks.readApprovalStandsAtHead,
}));

vi.mock('../../../../../lib/agents.js', () => ({
  transitionIssueToInReview: vi.fn(async () => undefined),
  spawnRun: routeMocks.spawnRun,
}));

vi.mock('../../../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: routeMocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../../lib/cloister/review-branch-push.js', () => ({
  pushLocalReviewBranches: vi.fn(),
}));

vi.mock('../../../../../lib/cloister/verification-runner.js', () => ({
  runVerificationForIssue: vi.fn(),
}));

vi.mock('../../../../../lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: vi.fn(),
}));

// Same import-chain stubs as review-pipeline-route.test.ts.
vi.mock('../../../../../lib/remote-workspace.js', () => ({}));
vi.mock('../../../../../lib/remote/remote-agents.js', () => ({}));
vi.mock('../../../../../lib/overdeck/planning-promotion.js', () => ({}));
vi.mock('../../../../../lib/overdeck/conversation-retrospective.js', () => ({}));
vi.mock('../../../../../lib/cloister/flywheel.js', () => ({}));
vi.mock('../../../../../lib/agents/spawn.js', () => ({ spawnRun: vi.fn(), spawnAgent: vi.fn(), spawnRunPromise: vi.fn() }));

import { _resetAutoRequeueCountsForTests, requestReviewGuarded } from '../review-pipeline.js';

function approved(checks: 'green' | 'pending'): DerivedIssueState {
  return {
    issueId: 'PAN-4317',
    state: 'ready',
    pr: { url: 'https://github.com/eltmon/overdeck/pull/4317', number: 4317, reviewState: 'approved', checks, mergeable: true },
  };
}

beforeEach(() => {
  _resetAutoRequeueCountsForTests();
  for (const mock of Object.values(routeMocks)) mock.mockReset();
  routeMocks.getProjectPath.mockReturnValue('/repo');
  // No workspace: a request that reaches the pipeline stops at its first check.
  routeMocks.getWorkspaceInfoForIssue.mockReturnValue({ exists: false, isRemote: false });
  routeMocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo' });
  routeMocks.spawnRun.mockResolvedValue({ id: 'test-run' });
});

describe('requestReviewGuarded — head-bound approval (PAN-4384)', () => {
  it('starts the review pipeline when the approval is stale at the head', async () => {
    const approvalStandsAtHead = vi.fn(async () => false);
    const outcome = await requestReviewGuarded('PAN-4317', {
      source: 'conflict-repair',
      derived: approved('green'),
      approvalStandsAtHead,
    });

    expect(approvalStandsAtHead).toHaveBeenCalledWith('PAN-4317');
    expect(routeMocks.getWorkspaceInfoForIssue).toHaveBeenCalledWith('PAN-4317');
    expect(outcome).toEqual({ kind: 'no-workspace' });
  });

  it('stays a no-op when the approval stands at the head', async () => {
    const outcome = await requestReviewGuarded('PAN-4317', {
      source: 'pan-review-request',
      derived: approved('green'),
      approvalStandsAtHead: async () => true,
    });

    expect(outcome).toEqual({ kind: 'already-passed' });
    expect(routeMocks.getWorkspaceInfoForIssue).not.toHaveBeenCalled();
  });

  it('stays a no-op when the approval at head cannot be read', async () => {
    const outcome = await requestReviewGuarded('PAN-4317', {
      source: 'pan-done',
      derived: approved('green'),
      approvalStandsAtHead: async () => undefined,
    });

    expect(outcome).toEqual({ kind: 'already-passed' });
  });

  it('re-queues the tests for a standing approval whose checks are not green', async () => {
    const outcome = await requestReviewGuarded('PAN-4317', {
      source: 'pan-review-request',
      derived: approved('pending'),
      approvalStandsAtHead: async () => true,
    });

    expect(outcome).toEqual({ kind: 'tests-requeued' });
    expect(routeMocks.spawnRun).toHaveBeenCalledWith('PAN-4317', 'test', expect.objectContaining({
      workspace: '/repo/workspaces/feature-pan-4317',
    }));
  });

  it('reads the approval through the merge gate by default', async () => {
    routeMocks.readApprovalStandsAtHead.mockResolvedValue(false);
    const outcome = await requestReviewGuarded('pan-4317', { source: 'api', derived: approved('green') });

    expect(routeMocks.readApprovalStandsAtHead).toHaveBeenCalledWith('PAN-4317');
    expect(outcome).toEqual({ kind: 'no-workspace' });
  });
});
