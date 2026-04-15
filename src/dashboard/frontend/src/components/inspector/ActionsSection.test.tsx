import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionsSection } from './ActionsSection';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Agent, WorkAgentLifecycle } from '../../types';
import type { ReviewStatus, WorkspaceInfo } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMutation(overrides: Partial<UseMutationResult<any, Error, any, unknown>> = {}): UseMutationResult<any, Error, any, unknown> {
  return {
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    status: 'idle',
    data: undefined,
    error: null,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    context: undefined,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    submittedAt: 0,
    variables: undefined,
    ...overrides,
  } as UseMutationResult<any, Error, void, unknown>;
}

function makeSyncMutation(overrides = {}) {
  return makeMutation(overrides) as UseMutationResult<{ alreadyUpToDate?: boolean; commitCount?: number }, Error, void, unknown>;
}

function makeLifecycle(overrides: Partial<WorkAgentLifecycle> = {}): WorkAgentLifecycle {
  return {
    agentId: 'agent-1',
    hasAgentState: true,
    hasLiveTmuxSession: false,
    hasSavedSession: true,
    hasWorkspace: true,
    isPlaceholder: false,
    isOrphaned: false,
    isRunning: false,
    isStopped: true,
    isCompleted: false,
    isCrashed: false,
    runtimeState: 'idle',
    agentStatus: 'stopped',
    canStartFresh: false,
    canResumeSession: true,
    canRestartWithContext: true,
    canResetSession: true,
    requiresSessionResetBeforeFreshStart: true,
    recommendedAction: 'resume',
    reason: 'Agent agent-1 has a resumable Claude session.',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'healthy',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function makeReviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-331',
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: new Date().toISOString(),
    readyForMerge: false,
    ...overrides,
  };
}

const defaultProps = {
  mergeMutation: makeMutation(),
  reviewMutation: makeMutation(),
  killMutation: makeMutation(),
  cancelMutation: makeMutation(),
  reopenMutation: makeMutation(),
  resetReviewMutation: makeMutation(),
  startAgentMutation: makeMutation(),
  createWorkspaceMutation: makeMutation(),
  syncMainMutation: makeSyncMutation(),
  resetSessionMutation: makeMutation(),
  onMerge: vi.fn(),
  onReview: vi.fn(),
  onKill: vi.fn(),
  onCancel: vi.fn(),
  onReopen: vi.fn(),
  onResetReview: vi.fn(),
  onResetSession: vi.fn(),
  onDismissPending: vi.fn(),
  onStartAgent: vi.fn(),
  onCreateWorkspace: vi.fn(),
};

describe('ActionsSection', () => {
  it('shows loading skeleton when reviewStatusLoading is true', () => {
    const { container } = render(<ActionsSection {...defaultProps} reviewStatusLoading={true} />);
    expect(screen.getByText('Actions')).toBeInTheDocument();
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('review-test-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('Start Agent')).not.toBeInTheDocument();
  });

  it('shows Start Agent button when no agent', () => {
    render(<ActionsSection {...defaultProps} />);
    expect(screen.getByText('Start Agent')).toBeInTheDocument();
  });

  it('shows Resume Session and Reset Session when stopped agent has resumable lifecycle', () => {
    render(
      <ActionsSection
        {...defaultProps}
        agent={makeAgent({ status: 'stopped' })}
        lifecycle={makeLifecycle()}
      />
    );
    expect(screen.getByText('Resume Session')).toBeInTheDocument();
    expect(screen.getByText('Reset Session')).toBeInTheDocument();
  });

  it('shows lifecycle reason for stopped agent actions', () => {
    render(
      <ActionsSection
        {...defaultProps}
        agent={makeAgent({ status: 'stopped' })}
        lifecycle={makeLifecycle({ reason: 'Use pan resume PAN-331 first.' })}
      />
    );
    expect(screen.getByText('Use pan resume PAN-331 first.')).toBeInTheDocument();
  });

  it('calls onStartAgent when Start Agent clicked', () => {
    const onStartAgent = vi.fn();
    render(<ActionsSection {...defaultProps} onStartAgent={onStartAgent} />);
    fireEvent.click(screen.getByText('Start Agent'));
    expect(onStartAgent).toHaveBeenCalledOnce();
  });

  it('shows Starting... while launching a fresh agent', () => {
    render(<ActionsSection {...defaultProps} agentLaunchState="starting" />);
    expect(screen.getByText('Starting...')).toBeInTheDocument();
  });

  it('shows Resuming... while resuming a stopped agent', () => {
    render(
      <ActionsSection
        {...defaultProps}
        agent={makeAgent({ status: 'stopped' })}
        lifecycle={makeLifecycle()}
        agentLaunchState="resuming"
      />
    );
    expect(screen.getByText('Resuming...')).toBeInTheDocument();
  });

  it('shows Start Agent instead of Resume Session for orphaned stopped agents', () => {
    render(
      <ActionsSection
        {...defaultProps}
        agent={makeAgent({ status: 'stopped' })}
        lifecycle={makeLifecycle({
          hasSavedSession: true,
          hasWorkspace: false,
          isOrphaned: true,
          canStartFresh: true,
          canResumeSession: false,
          canResetSession: false,
          requiresSessionResetBeforeFreshStart: false,
          recommendedAction: 'start',
          reason: 'Agent agent-1 has stale/orphaned session metadata without a resumable workspace-backed agent state. Start Agent should create a fresh session.',
        })}
      />
    );
    expect(screen.getByText('Start Agent')).toBeInTheDocument();
    expect(screen.queryByText('Resume Session')).not.toBeInTheDocument();
  });

  it('hides Start Agent when agent is running', () => {
    render(<ActionsSection {...defaultProps} agent={makeAgent()} />);
    expect(screen.queryByText('Start Agent')).not.toBeInTheDocument();
  });

  it('shows Stop button when agent is active', () => {
    render(<ActionsSection {...defaultProps} agent={makeAgent()} />);
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });

  it('shows Cancel Issue button for non-merged issues', () => {
    render(<ActionsSection {...defaultProps} reviewStatus={makeReviewStatus()} />);
    expect(screen.getByText('Cancel Issue')).toBeInTheDocument();
  });

  it('calls onKill when Stop clicked', () => {
    const onKill = vi.fn();
    render(<ActionsSection {...defaultProps} agent={makeAgent()} onKill={onKill} />);
    fireEvent.click(screen.getByText('Stop'));
    expect(onKill).toHaveBeenCalledOnce();
  });

  it('shows Merge button when ready for merge', () => {
    const reviewStatus = makeReviewStatus({ readyForMerge: true });
    render(<ActionsSection {...defaultProps} reviewStatus={reviewStatus} />);
    expect(screen.getByTestId('merge-btn')).toBeInTheDocument();
  });

  it('calls onMerge when Merge clicked', () => {
    const onMerge = vi.fn();
    const reviewStatus = makeReviewStatus({ readyForMerge: true });
    render(<ActionsSection {...defaultProps} reviewStatus={reviewStatus} onMerge={onMerge} />);
    fireEvent.click(screen.getByTestId('merge-btn'));
    expect(onMerge).toHaveBeenCalledOnce();
  });

  it('shows MERGED badge when mergeStatus is merged', () => {
    const reviewStatus = makeReviewStatus({ mergeStatus: 'merged' });
    render(<ActionsSection {...defaultProps} reviewStatus={reviewStatus} />);
    expect(screen.getByText('MERGED')).toBeInTheDocument();
  });

  it('shows Reopen button when review has a terminal status', () => {
    const reviewStatus = makeReviewStatus({ reviewStatus: 'passed' });
    render(<ActionsSection {...defaultProps} reviewStatus={reviewStatus} />);
    expect(screen.getByTestId('reopen-btn')).toBeInTheDocument();
  });

  it('shows Recover instead of Reset Pipeline when the pipeline is stuck', () => {
    const reviewStatus = makeReviewStatus({ mergeStatus: 'failed', verificationStatus: 'failed' });
    render(<ActionsSection {...defaultProps} reviewStatus={reviewStatus} />);
    expect(screen.getByText('Recover')).toBeInTheDocument();
    expect(screen.queryByText('Reset Pipeline')).not.toBeInTheDocument();
  });

  it('shows Review & Test button always', () => {
    render(<ActionsSection {...defaultProps} />);
    expect(screen.getByTestId('review-test-btn')).toBeInTheDocument();
  });

  it('shows Re-Review label when merge failed after review and test passed', () => {
    render(
      <ActionsSection
        {...defaultProps}
        reviewStatus={makeReviewStatus({ reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'failed', readyForMerge: false })}
      />
    );
    expect(screen.getByText('Re-Review')).toBeInTheDocument();
  });

  it('shows pipeline section for verification-only failure states', () => {
    render(
      <ActionsSection
        {...defaultProps}
        reviewStatus={makeReviewStatus({ reviewStatus: 'pending', testStatus: 'pending', verificationStatus: 'failed', verificationNotes: 'frontend-typecheck failed' })}
      />
    );
    expect(screen.getByText('Verify:')).toBeInTheDocument();
    expect(screen.getAllByText('frontend-typecheck failed')).toHaveLength(2);
  });

  it('promotes Review & Test when verification failed and rerun is the next step', () => {
    render(
      <ActionsSection
        {...defaultProps}
        reviewStatus={makeReviewStatus({ reviewStatus: 'pending', testStatus: 'pending', verificationStatus: 'failed' })}
      />
    );
    const button = screen.getByTestId('review-test-btn');
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('text-primary-foreground');
  });

  it('shows next-step hint for verification failure in workspace detail pane', () => {
    render(
      <ActionsSection
        {...defaultProps}
        reviewStatus={makeReviewStatus({ reviewStatus: 'pending', testStatus: 'pending', verificationStatus: 'failed', verificationNotes: 'frontend-typecheck failed' })}
      />
    );
    expect(screen.getByText('Next: Review & Test')).toBeInTheDocument();
    expect(screen.getAllByText('frontend-typecheck failed')).toHaveLength(2);
  });

  it('shows next-step hint for merge failure in workspace detail pane', () => {
    render(
      <ActionsSection
        {...defaultProps}
        reviewStatus={makeReviewStatus({ reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'failed', readyForMerge: false })}
      />
    );
    expect(screen.getByText('Next: Re-Review')).toBeInTheDocument();
    expect(screen.getByText('Merge did not complete.')).toBeInTheDocument();
  });

  it('shows Create Workspace button when workspace does not exist and no agent', () => {
    const workspace: WorkspaceInfo = { exists: false, issueId: 'PAN-331' };
    render(<ActionsSection {...defaultProps} workspace={workspace} />);
    expect(screen.getByText('Create Workspace')).toBeInTheDocument();
  });

  it('shows sync error message when syncMainMutation fails', () => {
    render(
      <ActionsSection
        {...defaultProps}
        syncMainMutation={makeSyncMutation({ isError: true, error: new Error('Network error') })}
      />
    );
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('shows pending operation failure with dismiss button', () => {
    const workspace: WorkspaceInfo = {
      exists: true,
      issueId: 'PAN-331',
      pendingOperation: {
        type: 'approve',
        issueId: 'PAN-331',
        startedAt: new Date().toISOString(),
        status: 'failed',
        error: 'Merge conflict detected',
      },
    };
    const onDismissPending = vi.fn();
    render(<ActionsSection {...defaultProps} workspace={workspace} onDismissPending={onDismissPending} />);
    expect(screen.getByText('Merge conflict detected')).toBeInTheDocument();
    expect(screen.getByText('Operation failed')).toBeInTheDocument();
  });
});
