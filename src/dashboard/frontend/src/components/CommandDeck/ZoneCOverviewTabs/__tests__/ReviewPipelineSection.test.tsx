import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ReviewPipelineSection } from '../ReviewPipelineSection';
import type { ReviewStatusData, ReleaseSetData } from '../queries';

const releaseResult = vi.hoisted(() => ({
  data: undefined as ReleaseSetData | undefined,
  isLoading: false,
  isError: false,
}));

const prResult = vi.hoisted(() => ({
  data: undefined as { pr?: { statusCheckRollup?: unknown[] } | null } | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock('../queries', () => ({
  usePrQuery: () => prResult,
  useReleaseSetQuery: () => releaseResult,
}));

function makeReviewStatus(overrides: Partial<ReviewStatusData> = {}): ReviewStatusData {
  return {
    issueId: 'PAN-399',
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'merged',
    readyForMerge: false,
    updatedAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeReleaseSet(overrides: Partial<ReleaseSetData> = {}): ReleaseSetData {
  return {
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/repo/overdeck',
    workspaceType: 'polyrepo',
    status: 'passed',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    components: [
      { componentKey: 'api', trigger: 'auto', releaseOrder: 0, required: true, status: 'passed' },
      { componentKey: 'frontend', trigger: 'auto', releaseOrder: 1, required: true, status: 'passed' },
    ],
    ...overrides,
  };
}

describe('ReviewPipelineSection release indicator', () => {
  beforeEach(() => {
    releaseResult.data = undefined;
    releaseResult.isLoading = false;
    releaseResult.isError = false;
    prResult.data = undefined;
    prResult.isLoading = false;
    prResult.isError = false;
  });

  it('renders a release indicator when releaseStatus is releasing', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ releaseStatus: 'releasing' })} issueId="PAN-399" />);
    expect(screen.getByTestId('release-indicator')).toBeInTheDocument();
    expect(screen.getByText('Releasing...')).toBeInTheDocument();
  });

  it('renders a release indicator when releaseStatus is passed', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ releaseStatus: 'passed' })} issueId="PAN-399" />);
    const indicator = screen.getByTestId('release-indicator');
    expect(indicator).toBeInTheDocument();
    expect(within(indicator).getByText('Passed')).toBeInTheDocument();
  });

  it('does not render a release indicator when releaseStatus is pending', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ releaseStatus: 'pending' })} issueId="PAN-399" />);
    expect(screen.queryByTestId('release-indicator')).not.toBeInTheDocument();
  });

  it('does not render a release indicator when releaseStatus is skipped', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({ releaseStatus: 'skipped' })} issueId="PAN-399" />);
    expect(screen.queryByTestId('release-indicator')).not.toBeInTheDocument();
  });

  it('does not render a release indicator when releaseStatus is absent', () => {
    render(<ReviewPipelineSection reviewStatus={makeReviewStatus({})} issueId="PAN-399" />);
    expect(screen.queryByTestId('release-indicator')).not.toBeInTheDocument();
  });

  it('renders the failing component key and notes on partial release', () => {
    releaseResult.data = makeReleaseSet({
      status: 'partial',
      components: [
        { componentKey: 'api', trigger: 'auto', releaseOrder: 0, required: true, status: 'passed' },
        { componentKey: 'frontend', trigger: 'auto', releaseOrder: 1, required: true, status: 'failed', notes: 'Smoke test failed for frontend.' },
      ],
    });
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ releaseStatus: 'partial', releaseNotes: 'Release halted at frontend.' })}
        issueId="PAN-399"
      />
    );
    expect(screen.getByTestId('release-failure-details')).toHaveTextContent('frontend: Smoke test failed for frontend.');
  });

  it('renders the failing component key and notes on rolled_back release', () => {
    releaseResult.data = makeReleaseSet({
      status: 'rolled_back',
      components: [
        { componentKey: 'api', trigger: 'auto', releaseOrder: 0, required: true, status: 'rolled_back', notes: 'Rollback completed.' },
      ],
    });
    render(
      <ReviewPipelineSection
        reviewStatus={makeReviewStatus({ releaseStatus: 'rolled_back', releaseNotes: 'Release halted at api.' })}
        issueId="PAN-399"
      />
    );
    expect(screen.getByTestId('release-failure-details')).toHaveTextContent('api: Rollback completed.');
  });
});
