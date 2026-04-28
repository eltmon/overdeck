import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewPipelineSection } from './ReviewPipelineSection';
import type { ReviewStatus } from './types';
import type { PrEndpointResponse } from '../CommandDeck/ZoneCOverviewTabs/queries';

const prResult = vi.hoisted(() => ({
  data: undefined as undefined | PrEndpointResponse,
  isLoading: false,
  isError: false,
}));

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  usePrQuery: () => prResult,
}));

vi.mock('../CommandDeck/ZoneCOverviewTabs/PrDiffTab', () => ({
  statusColor: (check: { state?: string; conclusion?: string; status?: string }) => {
    const verdict = (check.conclusion || check.state || check.status || '').toUpperCase();
    if (verdict === 'SUCCESS') return { bg: 'green', fg: 'green', label: 'pass' };
    if (verdict === 'FAILURE') return { bg: 'red', fg: 'red', label: 'fail' };
    if (verdict === 'PENDING') return { bg: 'blue', fg: 'blue', label: 'run' };
    return { bg: 'gray', fg: 'gray', label: 'unknown' };
  },
}));

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

function makePrResponse(overrides: Partial<PrEndpointResponse['pr']> = {}): PrEndpointResponse {
  return {
    issueId: 'PAN-331',
    pr: {
      number: 42,
      title: 'Test PR',
      url: 'https://github.com/test/pull/42',
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'feature/pan-331',
      author: { login: 'test' },
      createdAt: '2026-04-28T00:00:00Z',
      updatedAt: '2026-04-28T00:00:00Z',
      reviewDecision: null,
      reviewRequests: [],
      statusCheckRollup: [],
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      files: [],
      labels: [],
      mergeable: null,
      body: '',
      ...overrides,
    } as PrEndpointResponse['pr'],
  };
}

describe('ReviewPipelineSection', () => {
  beforeEach(() => {
    prResult.data = undefined;
    prResult.isLoading = false;
    prResult.isError = false;
  });

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

  it('shows merge retry count when mergeRetryCount > 0', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeRetryCount: 1 })} />);
    expect(screen.getByText('Attempt 1/3')).toBeInTheDocument();
  });

  it('shows merge retry count in destructive color when saturated', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeRetryCount: 3 })} />);
    expect(screen.getByText('Attempt 3/3')).toBeInTheDocument();
  });

  it('shows merge queue position when queued and activeSpecialist is merge', () => {
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ mergeStatus: 'queued', queuePosition: 2, activeSpecialist: 'merge' })}
      />
    );
    expect(screen.getByText('Queue position')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does not show queue position when queuePosition is 0 (actively processing)', () => {
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ mergeStatus: 'merging', queuePosition: 0, activeSpecialist: 'merge' })}
      />
    );
    expect(screen.queryByText('Queue position')).not.toBeInTheDocument();
  });

  it('does not show queue position when activeSpecialist is not merge', () => {
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ queuePosition: 2, activeSpecialist: 'review' })}
      />
    );
    expect(screen.queryByText('Queue position')).not.toBeInTheDocument();
  });

  it('shows live specialist log link when merge is queued and onViewLog is provided', () => {
    const onViewLog = vi.fn();
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ mergeStatus: 'queued' })}
        onViewLog={onViewLog}
      />
    );
    const link = screen.getByTestId('merge-live-log-link');
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(onViewLog).toHaveBeenCalledTimes(1);
  });

  it('shows live specialist log link when merge is merging', () => {
    const onViewLog = vi.fn();
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ mergeStatus: 'merging' })}
        onViewLog={onViewLog}
      />
    );
    expect(screen.getByTestId('merge-live-log-link')).toBeInTheDocument();
  });

  it('does not show live log link when merge is pending', () => {
    const onViewLog = vi.fn();
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ mergeStatus: 'pending' })}
        onViewLog={onViewLog}
      />
    );
    expect(screen.queryByTestId('merge-live-log-link')).not.toBeInTheDocument();
  });

  it('does not show live log link when onViewLog is not provided', () => {
    render(
      <ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'queued' })} />
    );
    expect(screen.queryByTestId('merge-live-log-link')).not.toBeInTheDocument();
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

  it('shows CI check pills when merge is queued and PR has checks', () => {
    prResult.data = makePrResponse({
      statusCheckRollup: [
        { name: 'lint', conclusion: 'SUCCESS' },
        { name: 'test', conclusion: 'FAILURE' },
        { name: 'build', status: 'PENDING' },
      ],
    });
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'queued' })} issueId="PAN-331" />);
    expect(screen.getByText('lint')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('build')).toBeInTheDocument();
  });

  it('shows CI check pills when merge is failed and PR has checks', () => {
    prResult.data = makePrResponse({
      statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }],
    });
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'failed' })} issueId="PAN-331" />);
    expect(screen.getByText('ci')).toBeInTheDocument();
  });

  it('does not show CI checks when merge is pending', () => {
    prResult.data = makePrResponse({
      statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
    });
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'pending' })} issueId="PAN-331" />);
    expect(screen.queryByText('ci')).not.toBeInTheDocument();
  });

  it('does not show CI checks when no issueId is provided', () => {
    prResult.data = makePrResponse({
      statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
    });
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ mergeStatus: 'queued' })} />);
    expect(screen.queryByText('ci')).not.toBeInTheDocument();
  });
});
