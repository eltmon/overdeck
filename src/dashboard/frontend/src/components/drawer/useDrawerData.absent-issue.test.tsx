import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS, type DomainEvent } from '@overdeck/contracts';

const wsTransportMock = vi.hoisted(() => ({
  subscribe: vi.fn(() => vi.fn()),
  request: vi.fn(),
}));

vi.mock('../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
}));

import { useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import { resetDrawerIssueSubscriptionForTest, useIssueData } from './useDrawerData';

const issue: Issue = {
  id: 'PAN-1',
  identifier: 'PAN-1',
  title: 'Unrelated issue',
  status: 'Todo',
  priority: 3,
  labels: [],
  url: 'https://example.com/PAN-1',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/tasks')) return Response.json({ tasks: [] });
    return Response.json({});
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useIssueData absent-issue hydration (PAN-4717)', () => {
  beforeEach(() => {
    resetDrawerIssueSubscriptionForTest();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch());
    wsTransportMock.subscribe.mockReset();
    wsTransportMock.subscribe.mockReturnValue(vi.fn());
    wsTransportMock.request.mockReset();
    useDashboardStore.setState({
      issuesRaw: [issue],
      agentsById: {},
      derivedIssueStateByIssueId: {},
      backendPanesById: {},
      recentActivity: [],
      detailedActivity: [],
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a null issue and subscribes to the issue-scoped stream for an issue absent from the snapshot', () => {
    const { result } = renderHook(() => useIssueData('PAN-3659'), { wrapper });

    expect(result.current.issue).toBeNull();
    expect(wsTransportMock.subscribe).toHaveBeenCalledTimes(1);
    const [connect] = wsTransportMock.subscribe.mock.calls[0]!;
    const subscribeIssueEvents = vi.fn(() => ({}));
    connect({ [WS_METHODS.subscribeIssueEvents]: subscribeIssueEvents });
    expect(subscribeIssueEvents).toHaveBeenCalledWith({ issueId: 'PAN-3659' });
  });

  it('hydrates the issue once a backfill issues.delta event adds its row', async () => {
    const { result } = renderHook(() => useIssueData('PAN-3659'), { wrapper });

    expect(result.current.issue).toBeNull();

    act(() => {
      useDashboardStore.getState().applyEvent({
        type: 'issues.delta',
        sequence: 2,
        timestamp: '2026-11-01T00:00:00.000Z',
        payload: {
          length: 2,
          changes: [{
            index: 1,
            issue: {
              id: 'PAN-3659',
              identifier: 'PAN-3659',
              title: 'Backfilled title',
              status: 'Done',
              priority: 3,
              labels: [],
              url: 'https://github.com/eltmon/overdeck/issues/3659',
              createdAt: '2026-05-18T00:00:00.000Z',
              updatedAt: '2026-05-18T00:00:00.000Z',
            },
          }],
        },
      } as DomainEvent);
    });

    await waitFor(() => expect(result.current.issue?.title).toBe('Backfilled title'));
  });
});
