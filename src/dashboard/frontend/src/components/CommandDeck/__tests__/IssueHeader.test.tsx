import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../hooks/useCostStream', () => ({
  useIssueCostStream: () => ({
    issueCost: 0,
    issueEvents: [],
    isLoading: false,
    error: null,
  }),
}));

const planningSummaryResult = vi.hoisted(() => ({
  data: {
    hasPrd: true,
    hasState: true,
    transcriptCount: 1,
    discussionCount: 1,
    noteCount: 0,
    acceptanceProgress: { completed: 1, total: 2, percent: 50 },
    stashCount: 0,
  },
  isLoading: false,
}));

const activityResult = vi.hoisted(() => ({
  data: { issueId: 'PAN-895', sections: [], resolvedTotalCost: 4.2 },
  isLoading: false,
}));

const reviewStatusResult = vi.hoisted(() => ({
  data: {
    issueId: 'PAN-895',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    verificationStatus: 'pending',
    readyForMerge: false,
    updatedAt: '2026-04-28T00:00:00Z',
  },
  isLoading: false,
}));

vi.mock('../ZoneCOverviewTabs/queries', () => ({
  usePlanningSummaryWithOverridesQuery: () => planningSummaryResult,
  useActivityQuery: () => activityResult,
  useReviewStatusQuery: () => reviewStatusResult,
}));

import { IssueHeader } from '../SessionView/IssueHeader';

function renderHeader() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <IssueHeader issueId="PAN-895" title="Test issue" />
    </QueryClientProvider>,
  );
}

describe('IssueHeader', () => {
  beforeEach(() => {
    planningSummaryResult.data = {
      hasPrd: true,
      hasState: true,
      transcriptCount: 1,
      discussionCount: 1,
      noteCount: 0,
      acceptanceProgress: { completed: 1, total: 2, percent: 50 },
      stashCount: 0,
    };
    activityResult.data = { issueId: 'PAN-895', sections: [], resolvedTotalCost: 4.2 };
    reviewStatusResult.data = {
      issueId: 'PAN-895',
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-04-28T00:00:00Z',
    };
  });

  it('renders issue id, title, and cost', () => {
    renderHeader();

    expect(screen.getByText('PAN-895')).toBeInTheDocument();
    expect(screen.getByText('Test issue')).toBeInTheDocument();
    expect(screen.getByTestId('zone-a-cost')).toHaveTextContent('$4.20');
  });

  it('renders acceptance progress bar', () => {
    renderHeader();

    const ac = screen.getByTestId('zone-a-ac-progress');
    expect(ac).toBeInTheDocument();
    expect(ac).toHaveTextContent('50%');
  });

  it('renders stash warning when stashCount > 0', () => {
    planningSummaryResult.data = {
      ...planningSummaryResult.data,
      stashCount: 3,
    };
    renderHeader();

    const warning = screen.getByTestId('zone-a-stash-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent('3 stashes');
  });
});
