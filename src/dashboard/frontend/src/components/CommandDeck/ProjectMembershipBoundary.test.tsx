import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectMembershipBoundary } from './ProjectMembershipBoundary';
import { fetchProjectPipelineMembership, refreshProjectPipelineMembership } from './projectsData';

vi.mock('./projectsData', () => ({
  fetchProjectPipelineMembership: vi.fn(),
  refreshProjectPipelineMembership: vi.fn(),
  NO_PROJECT_KEY: '__no-project__',
}));

vi.mock('./styles/command-deck.module.css', () => ({
  default: {
    emptyProject: 'emptyProject',
    membershipStatus: 'membershipStatus',
    membershipError: 'membershipError',
    membershipErrorContent: 'membershipErrorContent',
    membershipErrorDetail: 'membershipErrorDetail',
    membershipErrorRetry: 'membershipErrorRetry',
    skeletonList: 'skeletonList',
    skeletonItem: 'skeletonItem',
  },
}));

const fetchMembership = vi.mocked(fetchProjectPipelineMembership);
const refreshMembership = vi.mocked(refreshProjectPipelineMembership);

function renderBoundary(children: ReactNode = <div data-testid="issue-tree">Issues</div>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <ProjectMembershipBoundary
        selectedProject="overdeck"
        projectKey="overdeck"
        projectName="Overdeck"
        loading={false}
        disabled={false}
      >
        {children}
      </ProjectMembershipBoundary>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

describe('ProjectMembershipBoundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMembership.mockReset();
    refreshMembership.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the issue tree while a cold membership snapshot is loading without interval polling', async () => {
    fetchMembership.mockImplementation(() => new Promise(() => undefined));
    const { queryClient } = renderBoundary();

    expect(screen.getByTestId('issue-tree')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing pipeline membership');

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMembership).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it('keeps the issue tree rendered on failure and retries only when requested', async () => {
    fetchMembership
      .mockRejectedValueOnce(new Error('Pipeline membership snapshot is loading'))
      .mockResolvedValueOnce(true);
    refreshMembership.mockResolvedValueOnce(true);
    const { queryClient } = renderBoundary();

    expect(screen.getByTestId('issue-tree')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('alert')).toHaveTextContent('Pipeline membership snapshot is loading');

    fireEvent.click(screen.getByRole('button', { name: 'Retry membership' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    expect(screen.getByTestId('issue-tree')).toBeInTheDocument();
    // PAN-2972: retry forces a server-side re-gather (POST), then refetches
    // the snapshot — a plain refetch of a cold snapshot can never succeed.
    expect(refreshMembership).toHaveBeenCalledTimes(1);
    expect(fetchMembership).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });

  it('PAN-2972: surfaces the refresh failure cause when the forced re-gather also fails', async () => {
    fetchMembership.mockRejectedValue(new Error('Pipeline membership snapshot is loading'));
    refreshMembership.mockRejectedValueOnce(
      new Error('Pipeline membership refresh failed: Linear 503 connection termination'),
    );
    const { queryClient } = renderBoundary();

    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Retry membership' }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pipeline membership refresh failed: Linear 503 connection termination',
    );
    expect(refreshMembership).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
});
