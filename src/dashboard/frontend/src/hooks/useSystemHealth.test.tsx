import type { SystemHealthSnapshot } from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { fetchSystemHealth, useSystemHealth } from './useSystemHealth';

function createWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function HealthStateProbe() {
  const { data } = useSystemHealth();
  if (!data) return null;
  return <div>{data.state}:{data.agents[0]?.status ?? 'none'}</div>;
}

describe('fetchSystemHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes unknown future statuses to explicit unavailable values', async () => {
    const payload = {
      ...healthFixture(),
      state: 'future-health-state',
      agents: [{
        id: 'agent-future',
        status: 'future-agent-state',
        reasons: [],
      }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));

    const snapshot = await fetchSystemHealth();

    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.agents[0]?.status).toBe('unavailable');
  });

  it('lets consumers render unknown future statuses without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      ...healthFixture(),
      state: 'future-health-state',
      agents: [{
        id: 'agent-future',
        status: 'future-agent-state',
        reasons: [],
      }],
    })));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(<HealthStateProbe />, { wrapper: createWrapper(client) });

    expect(await screen.findByText('unavailable:unavailable')).toBeInTheDocument();
    client.clear();
  });

  it('returns a renderable unavailable snapshot when decoding fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'unavailable' }, 503)));

    const snapshot = await fetchSystemHealth();

    expect(snapshot).toMatchObject({
      version: 2,
      state: 'unavailable',
      nextPollMs: 15_000,
      host: {
        state: 'unavailable',
        platform: 'unsupported',
        metrics: {
          cpuPercent: null,
          availableMemoryBytes: null,
        },
      },
      admission: {
        state: 'unavailable',
        availableMemoryBytes: null,
        admittedWorkAgentCount: 0,
      },
      agents: [],
      services: [],
      topConsumers: [],
    });
    expect(snapshot.host.reasons[0]?.message).toContain('503');
  });
});

describe('useSystemHealth polling', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T04:00:00.000Z'));
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
        },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('polls measuring state every second, then honors nextPollMs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(healthFixture({
        state: 'measuring',
        host: {
          ...healthFixture().host,
          state: 'measuring',
        },
        nextPollMs: 60_000,
      })))
      .mockResolvedValueOnce(jsonResponse(healthFixture({ nextPollMs: 4_000 })))
      .mockResolvedValue(jsonResponse(healthFixture({ nextPollMs: 4_000 })));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useSystemHealth(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.state).toBe('measuring');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.runAllTicks();
      await Promise.resolve();
    });
    expect(
      queryClient.getQueryData<SystemHealthSnapshot>(['system-health'])?.state,
    ).toBe('healthy');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.runAllTicks();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    unmount();
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function healthFixture(
  overrides: Partial<SystemHealthSnapshot> = {},
): SystemHealthSnapshot {
  return {
    version: 2,
    state: 'healthy',
    updatedAt: '2026-07-17T04:00:00.000Z',
    nextPollMs: 15_000,
    host: {
      state: 'healthy',
      platform: 'linux',
      reasons: [],
      metrics: {
        cpuPercent: 12,
        loadAverage1m: 1.2,
        loadPerCore1m: 0.15,
        totalMemoryBytes: 16,
        usedMemoryBytes: 8,
        availableMemoryBytes: 8,
        memoryUsedPercent: 50,
        memoryPressureSomeAvg10: 0,
        memoryPressureFullAvg10: 0,
        memoryPressureFreePercent: null,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        swapUsedPercent: 0,
        swapActivityBytesPerMinute: 0,
        committedMemoryBytes: 8,
        commitLimitBytes: 24,
        virtualCommitmentPercent: 33.3,
      },
    },
    admission: {
      state: 'open',
      availableMemoryBytes: 8,
      admittedWorkAgentCount: 1,
      reasons: [],
    },
    agents: [],
    services: [],
    topConsumers: [],
    summary: {
      cpuPercent: 12,
      loadAverage1m: 1.2,
      loadPerCore1m: 0.15,
      totalMemoryBytes: 16,
      usedMemoryBytes: 8,
      availableMemoryBytes: 8,
      memoryUsedPercent: 50,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      committedMemoryBytes: 8,
      commitLimitBytes: 24,
      overcommitPercent: 33.3,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 0,
      overdeckMemoryPercent: 0,
      smeeRelay: {
        configured: false,
        running: false,
        status: 'unknown',
        message: 'Webhook relay health is unavailable.',
      },
    },
    ...overrides,
  };
}
