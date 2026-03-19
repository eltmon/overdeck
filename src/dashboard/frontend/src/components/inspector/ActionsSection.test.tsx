import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionsSection } from './ActionsSection';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Agent } from '../../types';
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
  closeMutation: makeMutation(),
  reopenMutation: makeMutation(),
  resetReviewMutation: makeMutation(),
  startAgentMutation: makeMutation(),
  createWorkspaceMutation: makeMutation(),
  syncMainMutation: makeSyncMutation(),
  onMerge: vi.fn(),
  onReview: vi.fn(),
  onKill: vi.fn(),
  onClose: vi.fn(),
  onReopen: vi.fn(),
  onResetReview: vi.fn(),
  onDismissPending: vi.fn(),
  onStartAgent: vi.fn(),
  onCreateWorkspace: vi.fn(),
};

describe('ActionsSection', () => {
  it('shows Start Agent button when no agent', () => {
    render(<ActionsSection {...defaultProps} />);
    expect(screen.getByText('Start Agent')).toBeInTheDocument();
  });

  it('calls onStartAgent when Start Agent clicked', () => {
    const onStartAgent = vi.fn();
    render(<ActionsSection {...defaultProps} onStartAgent={onStartAgent} />);
    fireEvent.click(screen.getByText('Start Agent'));
    expect(onStartAgent).toHaveBeenCalledOnce();
  });

  it('hides Start Agent when agent is running', () => {
    render(<ActionsSection {...defaultProps} agent={makeAgent()} />);
    expect(screen.queryByText('Start Agent')).not.toBeInTheDocument();
  });

  it('shows Stop button when agent is active', () => {
    render(<ActionsSection {...defaultProps} agent={makeAgent()} />);
    expect(screen.getByText('Stop')).toBeInTheDocument();
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

  it('shows Review & Test button always', () => {
    render(<ActionsSection {...defaultProps} />);
    expect(screen.getByTestId('review-test-btn')).toBeInTheDocument();
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
