import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock socket.io-client before importing the hook
vi.mock('socket.io-client', () => {
  const handlers: Record<string, (data: unknown) => void> = {};
  const mockSocket = {
    on: vi.fn((event: string, handler: (data: unknown) => void) => {
      handlers[event] = handler;
    }),
    off: vi.fn((event: string) => {
      delete handlers[event];
    }),
    disconnect: vi.fn(),
    connected: true,
    _handlers: handlers,
    _emit: (event: string, data: unknown) => {
      if (handlers[event]) handlers[event](data);
    },
  };
  return {
    io: vi.fn(() => mockSocket),
    _mockSocket: mockSocket,
  };
});

import { useResourceStats } from './useResourceStats';
import * as socketIoClient from 'socket.io-client';

function createWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe('useResourceStats', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('subscribes to resources:updated event on mount', () => {
    const mockSocket = (socketIoClient as any)._mockSocket;
    renderHook(() => useResourceStats(), { wrapper: createWrapper(queryClient) });
    expect(mockSocket.on).toHaveBeenCalledWith('resources:updated', expect.any(Function));
  });

  it('injects snapshot data into TanStack Query cache', () => {
    const mockSocket = (socketIoClient as any)._mockSocket;
    renderHook(() => useResourceStats(), { wrapper: createWrapper(queryClient) });

    const snapshot = {
      containers: [],
      agents: [],
      updatedAt: '2026-03-06T00:00:00Z',
    };

    // Simulate server emitting resources:updated
    mockSocket._emit('resources:updated', snapshot);

    const cached = queryClient.getQueryData(['resources']);
    expect(cached).toEqual(snapshot);
  });

  it('unsubscribes on unmount', () => {
    const mockSocket = (socketIoClient as any)._mockSocket;
    const { unmount } = renderHook(() => useResourceStats(), { wrapper: createWrapper(queryClient) });
    unmount();
    expect(mockSocket.off).toHaveBeenCalledWith('resources:updated', expect.any(Function));
  });
});
