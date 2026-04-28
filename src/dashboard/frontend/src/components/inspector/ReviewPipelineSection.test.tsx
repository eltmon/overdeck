import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewPipelineSection } from './ReviewPipelineSection';
import type { ReviewStatus } from './types';

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

describe('ReviewPipelineSection', () => {
  it('shows review passed status', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ reviewStatus: 'passed' })} />);
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('shows review blocked status', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ reviewStatus: 'blocked' })} />);
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('shows test failed status', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ testStatus: 'failed' })} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows test skipped status', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ testStatus: 'skipped' })} />);
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('shows review notes behind details toggle', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ reviewNotes: 'Needs cleanup' })} />);
    expect(screen.queryByText('Needs cleanup')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText('Needs cleanup')).toBeInTheDocument();
  });

  it('shows cycle count when autoRequeueCount > 0', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ autoRequeueCount: 2 })} />);
    expect(screen.getByText('2/7')).toBeInTheDocument();
  });

  it('shows human review warning when cycle count >= 7', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ autoRequeueCount: 7 })} />);
    expect(screen.getByText('Human review')).toBeInTheDocument();
  });

  it('shows verification attempts against the configured max cycle count', () => {
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({
          verificationStatus: 'running',
          verificationCycleCount: 2,
          verificationMaxCycles: 10,
        })}
      />
    );
    expect(screen.getByText(/2\/10/)).toBeInTheDocument();
  });

  it('shows verification status when not pending', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ verificationStatus: 'passed' })} />);
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('shows stale warning for old updatedAt', () => {
    const staleDate = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ updatedAt: staleDate })} />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('shows 4 pipeline steps including Merge', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus()} />);
    expect(screen.getByText('Build Gate')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Tests')).toBeInTheDocument();
    expect(screen.getByText('Merge')).toBeInTheDocument();
  });

  it('shows merge pending when mergeStatus is undefined', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus()} />);
    expect(screen.getByText('Merge')).toBeInTheDocument();
    // All 4 steps show Pending when nothing has started
    const pendingLabels = screen.getAllByText('Pending');
    expect(pendingLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('shows merge queued as running', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'queued' })} />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('shows merge merging as running', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'merging' })} />);
    expect(screen.getByText('Merging...')).toBeInTheDocument();
  });

  it('shows merge verifying as running', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'verifying' })} />);
    expect(screen.getByText('Verifying...')).toBeInTheDocument();
  });

  it('shows merge merged as passed', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'merged' })} />);
    expect(screen.getByText('Merged')).toBeInTheDocument();
  });

  it('shows merge failed as failed', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'failed' })} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows merge notes behind details toggle', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeNotes: 'Merge conflict detected' })} />);
    expect(screen.queryByText('Merge conflict detected')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText('Merge conflict detected')).toBeInTheDocument();
  });
});
