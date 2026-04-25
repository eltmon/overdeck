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
});
