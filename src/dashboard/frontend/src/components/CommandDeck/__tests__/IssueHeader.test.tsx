import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { useDashboardStore } from '../../../lib/store';

let fetchControl: ReturnType<typeof installStrictFetchMock>;

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

vi.mock('../ZoneCOverviewTabs/queries', () => ({
  usePlanningSummaryWithOverridesQuery: () => planningSummaryResult,
  useActivityQuery: () => activityResult,
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
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method !== 'GET') return undefined;
      if (url === '/api/review/PAN-895/config') return Response.json({});
      if (url === '/api/issues/PAN-895/staffing') return Response.json({});
      if (url === '/api/issues/PAN-895/swarm-policy') return Response.json({});
      if (url === '/api/settings/available-models') return Response.json({ models: [] });
      if (url === '/api/merge-train/config') return Response.json({});
      if (url === '/api/merge-train/auto-merge') return Response.json({ issues: [] });
      return undefined;
    });
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
    useDashboardStore.setState({
      derivedIssueStateByIssueId: { 'PAN-895': { issueId: 'PAN-895', state: 'working' } },
    });
  });

  afterEach(async () => {
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
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
