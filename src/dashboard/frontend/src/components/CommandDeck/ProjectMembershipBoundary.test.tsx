import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchBackendReconnected } from '../../lib/backendConnectionEvents';
import { installQueryRecovery } from '../../lib/queryRecovery';
import { membershipRetryDelayMs, ProjectMembershipBoundary } from './ProjectMembershipBoundary';
import { fetchProjectPipelineMembership, refreshProjectPipelineMembership } from './projectsData';

const { MembershipTransientError } = vi.hoisted(() => {
  class MembershipTransientError extends Error {
    readonly retryAfterMs: number | undefined;
    constructor(message: string, retryAfterMs?: number) {
      super(message);
      this.retryAfterMs = retryAfterMs;
    }
  }
  return { MembershipTransientError };
});

vi.mock('./projectsData', () => ({
  fetchProjectPipelineMembership: vi.fn(),
  refreshProjectPipelineMembership: vi.fn(),
  isMembershipTransientError: (error: unknown) => error instanceof MembershipTransientError,
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
      .mockRejectedValueOnce(new Error('HTTP 404 (forge_unavailable)'))
      .mockResolvedValueOnce(true);
    refreshMembership.mockResolvedValueOnce(true);
    const { queryClient } = renderBoundary();

    expect(screen.getByTestId('issue-tree')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 404 (forge_unavailable)');

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
    fetchMembership.mockRejectedValue(new Error('Pipeline membership refresh failed: HTTP 404 (forge_unavailable)'));
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

  it('PAN-3527: waits at least the Retry-After hint and backs off, capped at 30s', () => {
    const loading = new MembershipTransientError('Pipeline membership snapshot is loading', 5_000);
    expect([0, 1, 2, 3, 4, 5].map((n) => membershipRetryDelayMs(n, loading)))
      .toEqual([5_000, 5_000, 5_000, 8_000, 16_000, 30_000]);
    expect(membershipRetryDelayMs(0, new MembershipTransientError('Failed to fetch'))).toBe(1_000);
  });

  it('PAN-3527: retries a loading snapshot after a restart instead of latching the error banner', async () => {
    const loading = new MembershipTransientError('Pipeline membership snapshot is loading', 5_000);
    fetchMembership
      .mockRejectedValueOnce(loading)
      .mockRejectedValueOnce(loading)
      .mockResolvedValueOnce(true);
    const { queryClient } = renderBoundary();

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMembership).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Pipeline membership is temporarily unavailable (Pipeline membership snapshot is loading). Retrying automatically',
    );
    expect(screen.getByTestId('issue-tree')).toBeInTheDocument();
    // A wedged warm-up still has the manual forced re-gather.
    expect(screen.getByRole('button', { name: 'Retry membership' })).toBeInTheDocument();

    // Honors Retry-After (5s) rather than the 1s first backoff step.
    await act(() => vi.advanceTimersByTimeAsync(4_999));
    expect(fetchMembership).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMembership).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMembership).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('PAN-3527: keeps the last good result while a transient refetch failure retries', async () => {
    fetchMembership
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new MembershipTransientError('Failed to fetch'))
      .mockResolvedValueOnce(true);
    const { queryClient } = renderBoundary();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ['project-pipeline-membership'] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMembership).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(['project-pipeline-membership', 'overdeck'])).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('temporarily unavailable (Failed to fetch)');
    expect(screen.getByTestId('issue-tree')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(fetchMembership).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    queryClient.clear();
  });

  it('PAN-3527: refetches membership when the backend reconnects', async () => {
    fetchMembership
      .mockRejectedValueOnce(new Error('HTTP 404 (forge_unavailable)'))
      .mockResolvedValueOnce(true);
    const { queryClient } = renderBoundary();
    const uninstall = installQueryRecovery(queryClient);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await act(async () => {
      dispatchBackendReconnected();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMembership).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    uninstall();
    queryClient.clear();
  });
});
