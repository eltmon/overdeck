import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReviewPipelineSection } from '../ReviewPipelineSection';
import type { ReviewStatus } from '../../../../lib/workspace-types';

vi.mock('../queries', () => ({
  usePrQuery: () => ({ data: undefined }),
}));

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-399',
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'merged',
    readyForMerge: true,
    updatedAt: '2026-07-04T12:00:00.000Z',
    ...overrides,
  };
}

describe('ReviewPipelineSection release status', () => {
  it("renders a release indicator when releaseStatus is 'releasing'", () => {
    render(<ReviewPipelineSection reviewStatus={reviewStatus({ releaseStatus: 'releasing' })} />);

    expect(screen.getByText('Release')).toBeInTheDocument();
    expect(screen.getByText('Releasing...')).toBeInTheDocument();
  });

  it.each(['failed', 'partial', 'rolled_back'] as const)(
    "renders failing component context when releaseStatus is '%s'",
    (releaseStatus) => {
      render(<ReviewPipelineSection reviewStatus={reviewStatus({
        releaseStatus,
        releaseComponents: [
          {
            componentKey: 'api',
            provider: 'kubernetes',
            trigger: 'auto',
            releaseOrder: 0,
            required: true,
            status: 'failed',
            healthStatus: 'failed',
            versionStatus: 'pending',
            smokeStatus: 'pending',
            rollbackStatus: 'pending',
            notes: 'health check returned 503',
          },
        ],
      })} />);

      expect(screen.getByText('Release')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Failure details'));
      expect(screen.getByText('api: health check returned 503')).toBeInTheDocument();
    },
  );

  it.each([undefined, 'pending', 'skipped'] as const)(
    "omits the release indicator when releaseStatus is '%s'",
    (releaseStatus) => {
      render(<ReviewPipelineSection reviewStatus={reviewStatus({ releaseStatus })} />);

      expect(screen.queryByText('Release')).not.toBeInTheDocument();
    },
  );
});
