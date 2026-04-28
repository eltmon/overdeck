import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const alertSpy = vi.fn(async () => undefined);

vi.mock('../../DialogProvider', () => ({
  useAlert: () => alertSpy,
}));

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
    alertSpy.mockClear();
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

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/command-deck/planning/PAN-895') {
          return {
            ok: true,
            json: async () => ({
              prd: 'PRD body',
              state: 'STATE body',
              discussions: [{ filename: 'discussion.md', content: 'Discussion body', syncedAt: '2026-04-28T01:00:00Z' }],
              transcripts: [{ filename: 'transcript.md', content: 'Transcript body', uploadedAt: '2026-04-28T01:05:00Z' }],
            }),
          };
        }
        if (url === '/api/command-deck/planning/PAN-895/sync-discussions') {
          return { ok: true, json: async () => ({ success: true }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('renders artifact buttons from summary counts without fetching the full planning payload', () => {
    renderHeader();

    expect(screen.getByText('PRD')).toBeInTheDocument();
    expect(screen.getByText('STATE')).toBeInTheDocument();
    expect(screen.getByText('Discussions')).toBeInTheDocument();
    expect(screen.getByText('Transcripts')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith('/api/command-deck/planning/PAN-895');
  });

  it('lazy-loads the full planning payload when opening an artifact', async () => {
    renderHeader();

    fireEvent.click(screen.getByText('PRD'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/command-deck/planning/PAN-895');
    });
    expect(alertSpy).toHaveBeenCalledWith({
      title: 'PRD',
      message: 'PRD\n\nPRD body',
    });
  });
});
