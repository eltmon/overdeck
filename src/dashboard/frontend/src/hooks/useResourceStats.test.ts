import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useResourceStats } from './useResourceStats';
import { useDashboardStore } from '../lib/store';

function createWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe('useResourceStats', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useDashboardStore.setState({ resources: null });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('syncs store resources into TanStack Query cache', () => {
    const resources = { containers: [{ name: 'test', cpu: '10%', mem: '256M', status: 'running' }] };

    renderHook(() => useResourceStats(), { wrapper: createWrapper(queryClient) });

    act(() => {
      useDashboardStore.setState({ resources });
    });

    const cached = queryClient.getQueryData(['resources']);
    expect(cached).toEqual(resources);
  });

  it('does not set cache when resources is null', () => {
    renderHook(() => useResourceStats(), { wrapper: createWrapper(queryClient) });

    const cached = queryClient.getQueryData(['resources']);
    expect(cached).toBeUndefined();
  });
});
